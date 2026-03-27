import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { photos } from "@/lib/db/schema";

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_STATUSES = ["QUEUED", "PROCESSING", "DONE", "SKIPPED", "ERROR"] as const;
type PhotoStatus = (typeof VALID_STATUSES)[number];

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// ─── Response shape ───────────────────────────────────────────────────────────

interface PhotoRow {
  id: string;
  filenameFinal: string | null;
  libraryPath: string | null;
  dateTaken: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  width: number | null;
  height: number | null;
  fileSize: number | null;
  isMeme: boolean;
  faceCount: number;
  clipIndexed: boolean;
  status: PhotoStatus;
  createdAt: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

interface PhotosResponse {
  photos: PhotoRow[];
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
  const statusParam = searchParams.get("status") ?? "DONE";
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const pageResult = parseIntParam(pageParam, "page", DEFAULT_PAGE);
  if (pageResult.error) return badRequest(pageResult.error);
  if (pageResult.value < 1) return badRequest("Invalid page: must be >= 1");

  const limitResult = parseIntParam(limitParam, "limit", DEFAULT_LIMIT);
  if (limitResult.error) return badRequest(limitResult.error);
  if (limitResult.value < 1) return badRequest("Invalid limit: must be >= 1");

  const page = pageResult.value;
  const limit = Math.min(limitResult.value, MAX_LIMIT);

  if (!VALID_STATUSES.includes(statusParam as PhotoStatus)) {
    return badRequest(`Invalid status: must be one of ${VALID_STATUSES.join(", ")}`);
  }
  const status = statusParam as PhotoStatus;

  let fromTs: number | null = null;
  let toTs: number | null = null;

  if (fromParam !== null) {
    const fromResult = parseIntParam(fromParam, "from", 0);
    if (fromResult.error) return badRequest(fromResult.error);
    fromTs = fromResult.value;
  }
  if (toParam !== null) {
    const toResult = parseIntParam(toParam, "to", 0);
    if (toResult.error) return badRequest(toResult.error);
    toTs = toResult.value;
  }

  // 2. Build where conditions
  // For DONE status, also require library_path IS NOT NULL to exclude memes/duplicates
  // that were bailed out before reaching the upload stage.
  const conditions = [
    eq(photos.status, status),
    ...(status === "DONE" ? [isNotNull(photos.libraryPath)] : []),
    ...(fromTs !== null ? [gte(photos.dateTaken, fromTs)] : []),
    ...(toTs !== null ? [lte(photos.dateTaken, toTs)] : []),
  ];

  const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

  const offset = (page - 1) * limit;

  try {
    // 3. Run count + data queries in parallel
    const [countResult, rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(photos).where(whereClause),
      db
        .select({
          id: photos.id,
          filenameFinal: photos.filenameFinal,
          libraryPath: photos.libraryPath,
          dateTaken: photos.dateTaken,
          city: photos.city,
          state: photos.state,
          country: photos.country,
          cameraMake: photos.cameraMake,
          cameraModel: photos.cameraModel,
          width: photos.width,
          height: photos.height,
          fileSize: photos.fileSize,
          isMeme: photos.isMeme,
          faceCount: photos.faceCount,
          clipIndexed: photos.clipIndexed,
          status: photos.status,
          createdAt: photos.createdAt,
        })
        .from(photos)
        .where(whereClause)
        .orderBy(desc(photos.dateTaken), desc(photos.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    // Normalise boolean fields — SQLite stores them as 0/1 integers
    const photoRows: PhotoRow[] = rows.map((row) => ({
      ...row,
      isMeme: Boolean(row.isMeme),
      clipIndexed: Boolean(row.clipIndexed),
      faceCount: row.faceCount ?? 0,
      status: (row.status ?? "QUEUED") as PhotoStatus,
    }));

    const hasMore = offset + photoRows.length < total;

    const response: PhotosResponse = {
      photos: photoRows,
      pagination: { page, limit, total, hasMore },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[GET /api/photos] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
