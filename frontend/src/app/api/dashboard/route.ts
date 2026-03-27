import { count, desc, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { actionLog, faceClusters, faces, photos } from "@/lib/db/schema";

// ─── Response types ───────────────────────────────────────────────────────────

interface DashboardStats {
  total: number;
  done: number;
  queued: number;
  processing: number;
  error: number;
  memes: number;
  faces: number;
  faceClusters: number;
  clipIndexed: number;
  totalSizeBytes: number | null;
}

interface ActivityEntry {
  id: string;
  photoId: string | null;
  action: string;
  detail: string | null;
  timestamp: number;
}

interface DashboardResponse {
  stats: DashboardStats;
  recentActivity: ActivityEntry[];
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    // Run all queries in parallel for performance
    const [photoAgg, faceCount, faceClusterCount, recentActivityRows] = await Promise.all([
      // Single aggregation query for all photo stats
      db
        .select({
          total: sql<number>`count(*)`,
          done: sql<number>`count(case when ${photos.status} = 'DONE' then 1 end)`,
          queued: sql<number>`count(case when ${photos.status} = 'QUEUED' then 1 end)`,
          processing: sql<number>`count(case when ${photos.status} = 'PROCESSING' then 1 end)`,
          error: sql<number>`count(case when ${photos.status} = 'ERROR' then 1 end)`,
          memes: sql<number>`count(case when ${photos.isMeme} = 1 then 1 end)`,
          clipIndexed: sql<number>`count(case when ${photos.clipIndexed} = 1 then 1 end)`,
          totalSizeBytes: sql<number | null>`sum(${photos.fileSize})`,
        })
        .from(photos),

      // Face count from faces table
      db.select({ value: count() }).from(faces),

      // Face cluster count
      db.select({ value: count() }).from(faceClusters),

      // Recent activity (last 20, newest first)
      db
        .select({
          id: actionLog.id,
          photoId: actionLog.photoId,
          action: actionLog.action,
          detail: actionLog.detail,
          timestamp: actionLog.timestamp,
        })
        .from(actionLog)
        .orderBy(desc(actionLog.timestamp))
        .limit(20),
    ]);

    const agg = photoAgg[0];

    const stats: DashboardStats = {
      total: Number(agg?.total ?? 0),
      done: Number(agg?.done ?? 0),
      queued: Number(agg?.queued ?? 0),
      processing: Number(agg?.processing ?? 0),
      error: Number(agg?.error ?? 0),
      memes: Number(agg?.memes ?? 0),
      clipIndexed: Number(agg?.clipIndexed ?? 0),
      totalSizeBytes: agg?.totalSizeBytes ?? null,
      faces: Number(faceCount[0]?.value ?? 0),
      faceClusters: Number(faceClusterCount[0]?.value ?? 0),
    };

    const recentActivity: ActivityEntry[] = recentActivityRows.map((row) => ({
      id: row.id,
      photoId: row.photoId ?? null,
      action: row.action,
      detail: row.detail ?? null,
      timestamp: row.timestamp,
    }));

    const response: DashboardResponse = { stats, recentActivity };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[GET /api/dashboard] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
