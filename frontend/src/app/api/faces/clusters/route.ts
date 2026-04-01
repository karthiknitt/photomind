import { and, count, desc, gt, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    // label=null  → only unlabeled, label=set → only labeled, omit → all
    const labelFilter = searchParams.get("label");
    const limit = Number(searchParams.get("limit")) || undefined;
    // exclude=id1,id2,... → skip specific cluster IDs (used by the identify wizard)
    const excludeParam = searchParams.get("exclude");
    const excludeIds = excludeParam ? excludeParam.split(",").filter(Boolean) : [];

    // Build label condition
    const labelCondition =
      labelFilter === "null"
        ? isNull(faceClusters.label)
        : labelFilter === "set"
          ? isNotNull(faceClusters.label)
          : undefined;

    const conditions = [
      gt(faceClusters.photoCount, 0),
      labelCondition,
      excludeIds.length > 0 ? notInArray(faceClusters.id, excludeIds) : undefined,
    ].filter((c) => c !== undefined);

    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

    // Get all clusters with photoCount > 0, ordered by photoCount desc.
    // For each cluster, find one representative face's photoId via a raw subquery.
    let query = db
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
      .where(whereClause)
      .orderBy(desc(faceClusters.photoCount))
      .$dynamic();

    if (limit) {
      query = query.limit(limit);
    }

    const [rows, [countRow]] = await Promise.all([
      query,
      db.select({ total: count() }).from(faceClusters).where(whereClause),
    ]);

    const clusters: ClusterRow[] = rows.map((row) => ({
      id: row.id,
      label: row.label ?? null,
      photoCount: row.photoCount ?? 0,
      createdAt: row.createdAt,
      representativePhotoId: row.representativePhotoId ?? null,
    }));

    const response: ClustersResponse = {
      clusters,
      total: countRow.total,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[GET /api/faces/clusters] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
