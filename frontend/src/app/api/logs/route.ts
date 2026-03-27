import { and, desc, eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { actionLog } from "@/lib/db/schema";

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ACTIONS = [
  "COPIED",
  "SKIPPED_DUPLICATE",
  "SKIPPED_MEME",
  "SKIPPED_ERROR",
  "INDEXED",
  "FACE_DETECTED",
  "CLUSTER_UPDATED",
] as const;

type ActionEnum = (typeof VALID_ACTIONS)[number];

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ─── Response shapes ──────────────────────────────────────────────────────────

interface LogRow {
  id: string;
  photoId: string | null;
  action: ActionEnum;
  detail: string | null;
  timestamp: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

interface LogsResponse {
  logs: LogRow[];
  pagination: Pagination;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

function parseIntParam(
  value: string | null,
  name: string,
  defaultValue: number
): { value: number; error: string | null } {
  if (value === null) return { value: defaultValue, error: null };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || Number.isNaN(parsed)) {
    return { value: 0, error: `Invalid ${name}: must be an integer` };
  }
  return { value: parsed, error: null };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl ?? new URL(request.url);

  // 1. Parse and validate query params
  const pageParam = searchParams.get("page");
  const limitParam = searchParams.get("limit");
  const actionParam = searchParams.get("action");

  const pageResult = parseIntParam(pageParam, "page", DEFAULT_PAGE);
  if (pageResult.error) return badRequest(pageResult.error);
  if (pageResult.value < 1) return badRequest("Invalid page: must be >= 1");

  const limitResult = parseIntParam(limitParam, "limit", DEFAULT_LIMIT);
  if (limitResult.error) return badRequest(limitResult.error);
  if (limitResult.value < 1) return badRequest("Invalid limit: must be >= 1");

  const page = pageResult.value;
  const limit = Math.min(limitResult.value, MAX_LIMIT);
  const offset = (page - 1) * limit;

  // Validate action filter if provided
  if (actionParam !== null && !VALID_ACTIONS.includes(actionParam as ActionEnum)) {
    return badRequest(`Invalid action: must be one of ${VALID_ACTIONS.join(", ")}`);
  }
  const actionFilter = actionParam as ActionEnum | null;

  // 2. Build where conditions
  const conditions = actionFilter !== null ? [eq(actionLog.action, actionFilter)] : [];
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  try {
    // 3. Run count + data queries in parallel
    const [countResult, rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(actionLog).where(whereClause),
      db
        .select({
          id: actionLog.id,
          photoId: actionLog.photoId,
          action: actionLog.action,
          detail: actionLog.detail,
          timestamp: actionLog.timestamp,
        })
        .from(actionLog)
        .where(whereClause)
        .orderBy(desc(actionLog.timestamp))
        .limit(limit)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    const logRows: LogRow[] = rows.map((row) => ({
      id: row.id,
      photoId: row.photoId ?? null,
      action: row.action as ActionEnum,
      detail: row.detail ?? null,
      timestamp: row.timestamp,
    }));

    const hasMore = offset + logRows.length < total;

    const response: LogsResponse = {
      logs: logRows,
      pagination: { page, limit, total, hasMore },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[GET /api/logs] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
