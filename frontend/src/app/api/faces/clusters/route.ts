import { desc, gt, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { faceClusters } from "@/lib/db/schema";

// ─── Response shapes ──────────────────────────────────────────────────────────

interface ClusterRow {
  id: string;
  label: string | null;
  photoCount: number;
  createdAt: number;
  representativePhotoId: string | null;
}

interface ClustersResponse {
  clusters: ClusterRow[];
  total: number;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    // Get all clusters with photoCount > 0, ordered by photoCount desc.
    // For each cluster, find one representative face's photoId via a raw subquery.
    const rows = await db
      .select({
        id: faceClusters.id,
        label: faceClusters.label,
        photoCount: faceClusters.photoCount,
        createdAt: faceClusters.createdAt,
        representativePhotoId: sql<string | null>`(
          SELECT photo_id FROM faces WHERE cluster_id = face_clusters.id LIMIT 1
        )`,
      })
      .from(faceClusters)
      .where(gt(faceClusters.photoCount, 0))
      .orderBy(desc(faceClusters.photoCount));

    const clusters: ClusterRow[] = rows.map((row) => ({
      id: row.id,
      label: row.label ?? null,
      photoCount: row.photoCount ?? 0,
      createdAt: row.createdAt,
      representativePhotoId: row.representativePhotoId ?? null,
    }));

    const response: ClustersResponse = {
      clusters,
      total: clusters.length,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[GET /api/faces/clusters] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
