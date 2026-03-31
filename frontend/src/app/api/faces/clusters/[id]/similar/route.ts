import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { faceClusterPairs, faceClusters, faces } from "@/lib/db/schema";

// ─── Response shapes ──────────────────────────────────────────────────────────

interface SimilarCluster {
  id: string;
  avgSimilarity: number; // 0–100, round((1 - avgDistance) * 100)
  photoCount: number;
  representativeFaceId: string; // face with lowest distance (most similar)
}

interface SimilarResponse {
  clusters: SimilarCluster[];
  bridgeUnavailable?: true;
}

// ─── Route handler ────────────────────────────────────────────────────────────

const BRIDGE_URL =
  process.env.FACE_IDENTIFY_BRIDGE_URL ??
  process.env.CLIP_BRIDGE_URL ??
  "http://127.0.0.1:8765";

const MAX_SUGGESTIONS = 5;
const MAX_DISTANCE = 0.65; // cosine distance threshold (similarity > 35%)

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  try {
    // 1. Check cluster exists
    const [cluster] = await db
      .select()
      .from(faceClusters)
      .where(eq(faceClusters.id, id));

    if (!cluster) {
      return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
    }

    // 2. Fetch embedding IDs for this cluster
    const clusterFaces = await db
      .select({ id: faces.id, embeddingId: faces.embeddingId })
      .from(faces)
      .where(eq(faces.clusterId, id));

    const embeddingIds = clusterFaces
      .map((f) => f.embeddingId)
      .filter((e): e is string => e !== null);

    if (embeddingIds.length === 0) {
      const response: SimilarResponse = { clusters: [] };
      return NextResponse.json(response, { status: 200 });
    }

    // 3. Fetch already-paired cluster IDs to exclude
    const existingPairs = await db
      .select({ clusterIdA: faceClusterPairs.clusterIdA, clusterIdB: faceClusterPairs.clusterIdB })
      .from(faceClusterPairs)
      .where(
        or(
          eq(faceClusterPairs.clusterIdA, id),
          eq(faceClusterPairs.clusterIdB, id)
        )
      );

    const pairedIds = new Set<string>();
    for (const pair of existingPairs) {
      pairedIds.add(pair.clusterIdA);
      pairedIds.add(pair.clusterIdB);
    }
    pairedIds.delete(id); // don't exclude self here — handled below

    // 4. Query bridge for similar faces
    let bridgeResults: { id: string; distance: number }[];
    try {
      const resp = await fetch(`${BRIDGE_URL}/faces/centroid-similar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embedding_ids: embeddingIds,
          exclude_ids: clusterFaces.map((f) => f.id), // exclude own faces
          n_results: 200,
        }),
      });

      if (!resp.ok) {
        throw new Error(`Bridge error ${resp.status}`);
      }

      const data = (await resp.json()) as { results: { id: string; distance: number }[] };
      bridgeResults = data.results;
    } catch {
      const response: SimilarResponse = { clusters: [], bridgeUnavailable: true };
      return NextResponse.json(response, { status: 200 });
    }

    if (bridgeResults.length === 0) {
      return NextResponse.json({ clusters: [] } satisfies SimilarResponse, { status: 200 });
    }

    // 5. Map face IDs → cluster IDs via SQLite
    const resultFaceIds = bridgeResults.map((r) => r.id);
    const faceRows = await db
      .select({ id: faces.id, clusterId: faces.clusterId })
      .from(faces)
      .where(and(inArray(faces.id, resultFaceIds), isNotNull(faces.clusterId)));

    const faceToCluster = new Map<string, string>();
    for (const row of faceRows) {
      if (row.clusterId) faceToCluster.set(row.id, row.clusterId);
    }

    // 6. Group by cluster_id, compute avg distance, pick representative face
    const distanceByFace = new Map(bridgeResults.map((r) => [r.id, r.distance]));
    const clusterGroups = new Map<string, { totalDist: number; count: number; bestFaceId: string; bestDist: number }>();

    for (const faceId of resultFaceIds) {
      const cid = faceToCluster.get(faceId);
      if (!cid || cid === id) continue; // skip unclustered or self
      if (pairedIds.has(cid)) continue; // skip already-paired

      const dist = distanceByFace.get(faceId) ?? 1;
      if (dist > MAX_DISTANCE) continue;

      const existing = clusterGroups.get(cid);
      if (!existing) {
        clusterGroups.set(cid, { totalDist: dist, count: 1, bestFaceId: faceId, bestDist: dist });
      } else {
        existing.totalDist += dist;
        existing.count += 1;
        if (dist < existing.bestDist) {
          existing.bestDist = dist;
          existing.bestFaceId = faceId;
        }
      }
    }

    // 7. Fetch cluster metadata and filter to unlabeled only
    const candidateIds = [...clusterGroups.keys()];
    if (candidateIds.length === 0) {
      return NextResponse.json({ clusters: [] } satisfies SimilarResponse, { status: 200 });
    }

    const clusterMeta = await db
      .select({ id: faceClusters.id, label: faceClusters.label, photoCount: faceClusters.photoCount })
      .from(faceClusters)
      .where(and(inArray(faceClusters.id, candidateIds), isNull(faceClusters.label)));

    // 8. Build response, sort by avgSimilarity desc, top 5
    const results: SimilarCluster[] = clusterMeta
      .map((c) => {
        const group = clusterGroups.get(c.id)!;
        const avgDist = group.totalDist / group.count;
        return {
          id: c.id,
          avgSimilarity: Math.round((1 - avgDist) * 100),
          photoCount: c.photoCount ?? 0,
          representativeFaceId: group.bestFaceId,
        };
      })
      .sort((a, b) => b.avgSimilarity - a.avgSimilarity)
      .slice(0, MAX_SUGGESTIONS);

    const response: SimilarResponse = { clusters: results };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[GET /api/faces/clusters/[id]/similar] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
