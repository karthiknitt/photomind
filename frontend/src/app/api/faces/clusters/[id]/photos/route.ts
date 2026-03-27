import { and, desc, eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { faceClusters, faces, photos } from "@/lib/db/schema";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 100;

// ─── Response shapes ──────────────────────────────────────────────────────────

interface PhotoRow {
  id: string;
  filenameFinal: string | null;
  dateTaken: number | null;
  city: string | null;
  country: string | null;
  width: number | null;
  height: number | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

interface ClusterPhotosResponse {
  photos: PhotoRow[];
  pagination: Pagination;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseIntParam(value: string | null, defaultValue: number): number {
  if (value === null) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || Number.isNaN(parsed) || parsed < 1) {
    return defaultValue;
  }
  return parsed;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const { searchParams } = request.nextUrl ?? new URL(request.url);

  const page = parseIntParam(searchParams.get("page"), DEFAULT_PAGE);
  const limit = Math.min(parseIntParam(searchParams.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);
  const offset = (page - 1) * limit;

  try {
    // 1. Check cluster exists
    const clusterRows = await db.select().from(faceClusters).where(eq(faceClusters.id, id));

    if (clusterRows.length === 0) {
      return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
    }

    // 2. Count total photos in cluster with status DONE
    const whereCondition = and(eq(faces.clusterId, id), eq(photos.status, "DONE"));

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(faces)
      .innerJoin(photos, eq(faces.photoId, photos.id))
      .where(whereCondition);

    const total = Number(countResult?.count ?? 0);

    // 3. Fetch paginated photos
    const rows = await db
      .select({
        id: photos.id,
        filenameFinal: photos.filenameFinal,
        dateTaken: photos.dateTaken,
        city: photos.city,
        country: photos.country,
        width: photos.width,
        height: photos.height,
      })
      .from(faces)
      .innerJoin(photos, eq(faces.photoId, photos.id))
      .where(whereCondition)
      .orderBy(desc(photos.dateTaken), desc(photos.createdAt))
      .limit(limit)
      .offset(offset);

    const photoRows: PhotoRow[] = rows.map((row) => ({
      id: row.id,
      filenameFinal: row.filenameFinal ?? null,
      dateTaken: row.dateTaken ?? null,
      city: row.city ?? null,
      country: row.country ?? null,
      width: row.width ?? null,
      height: row.height ?? null,
    }));

    const hasMore = offset + photoRows.length < total;

    const response: ClusterPhotosResponse = {
      photos: photoRows,
      pagination: { page, limit, total, hasMore },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[GET /api/faces/clusters/[id]/photos] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
