import { countDistinct, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { faceClusterPairs, faceClusters, faces } from "@/lib/db/schema";

// ─── Response shapes ──────────────────────────────────────────────────────────

interface ClusterRow {
  id: string;
  label: string | null;
  photoCount: number;
  createdAt: number;
}

interface MergeResponse {
  cluster: ClusterRow;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: targetId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const { sourceClusterId } = body as Record<string, unknown>;

  if (typeof sourceClusterId !== "string") {
    return NextResponse.json({ error: "sourceClusterId is required" }, { status: 400 });
  }
  if (sourceClusterId === targetId) {
    return NextResponse.json(
      { error: "sourceClusterId and target id must be different (same cluster)" },
      { status: 400 }
    );
  }

  try {
    // 1. Validate both clusters exist
    const [targetCluster] = await db
      .select()
      .from(faceClusters)
      .where(eq(faceClusters.id, targetId));

    if (!targetCluster) {
      return NextResponse.json({ error: "Target cluster not found" }, { status: 404 });
    }

    const [sourceCluster] = await db
      .select()
      .from(faceClusters)
      .where(eq(faceClusters.id, sourceClusterId));

    if (!sourceCluster) {
      return NextResponse.json({ error: "Source cluster not found" }, { status: 404 });
    }

    // 2. Move all faces from source to target
    await db
      .update(faces)
      .set({ clusterId: targetId })
      .where(eq(faces.clusterId, sourceClusterId));

    // 3. Recount photoCount on target
    const [countRow] = await db
      .select({ count: countDistinct(faces.photoId) })
      .from(faces)
      .where(eq(faces.clusterId, targetId));

    await db
      .update(faceClusters)
      .set({ photoCount: countRow.count })
      .where(eq(faceClusters.id, targetId));

    // 4. Delete source cluster
    await db.delete(faceClusters).where(eq(faceClusters.id, sourceClusterId));

    // 5. Record positive pair (normalised order: smaller UUID first)
    const [normA, normB] = [targetId, sourceClusterId].sort();
    await db.insert(faceClusterPairs).values({
      id: crypto.randomUUID(),
      clusterIdA: normA,
      clusterIdB: normB,
      isSame: true,
      createdAt: Math.floor(Date.now() / 1000),
    });

    // 6. Return updated target cluster
    const [updated] = await db
      .select()
      .from(faceClusters)
      .where(eq(faceClusters.id, targetId));

    const response: MergeResponse = {
      cluster: {
        id: updated.id,
        label: updated.label ?? null,
        photoCount: updated.photoCount ?? 0,
        createdAt: updated.createdAt,
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[POST /api/faces/clusters/[id]/merge] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
