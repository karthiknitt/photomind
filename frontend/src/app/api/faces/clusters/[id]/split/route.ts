import { countDistinct, eq, inArray } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { faceClusters, faces } from "@/lib/db/schema";

// ─── Response shapes ──────────────────────────────────────────────────────────

interface NewClusterRow {
  id: string;
  label: string | null;
  photoCount: number;
  createdAt: number;
}

interface SplitResponse {
  newCluster: NewClusterRow;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  // 1. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const { faceIds, label } = body as { faceIds: unknown; label?: unknown };

  if (!Array.isArray(faceIds)) {
    return NextResponse.json({ error: "faceIds must be an array" }, { status: 400 });
  }

  if (faceIds.length === 0) {
    return NextResponse.json({ error: "faceIds must not be empty" }, { status: 400 });
  }

  const newLabel = typeof label === "string" && label.trim() !== "" ? label.trim() : null;

  try {
    // 2. Check source cluster exists
    const [sourceCluster] = await db.select().from(faceClusters).where(eq(faceClusters.id, id));

    if (!sourceCluster) {
      return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
    }

    // 3. Verify all faceIds belong to this cluster
    const claimedFaces = await db
      .select({ id: faces.id, clusterId: faces.clusterId })
      .from(faces)
      .where(inArray(faces.id, faceIds as string[]));

    const outsiders = claimedFaces.filter((f) => f.clusterId !== id);
    if (outsiders.length > 0) {
      return NextResponse.json(
        {
          error: `${outsiders.length} face(s) do not belong to cluster ${id}`,
        },
        { status: 400 }
      );
    }

    // faces not found in DB at all
    if (claimedFaces.length !== faceIds.length) {
      return NextResponse.json({ error: "One or more faceIds not found" }, { status: 400 });
    }

    // 4. Create the new cluster
    const newClusterId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await db.insert(faceClusters).values({
      id: newClusterId,
      label: newLabel,
      photoCount: 0,
      createdAt: now,
    });

    // 5. Move faces to the new cluster
    await db
      .update(faces)
      .set({ clusterId: newClusterId })
      .where(inArray(faces.id, faceIds as string[]));

    // 6. Recalculate photoCount for BOTH clusters using COUNT(DISTINCT photo_id)
    const [srcCount] = await db
      .select({ count: countDistinct(faces.photoId) })
      .from(faces)
      .where(eq(faces.clusterId, id));

    const [newCount] = await db
      .select({ count: countDistinct(faces.photoId) })
      .from(faces)
      .where(eq(faces.clusterId, newClusterId));

    await db
      .update(faceClusters)
      .set({ photoCount: srcCount.count })
      .where(eq(faceClusters.id, id));

    await db
      .update(faceClusters)
      .set({ photoCount: newCount.count })
      .where(eq(faceClusters.id, newClusterId));

    // 7. Return new cluster
    const [newCluster] = await db
      .select()
      .from(faceClusters)
      .where(eq(faceClusters.id, newClusterId));

    const response: SplitResponse = {
      newCluster: {
        id: newCluster.id,
        label: newCluster.label ?? null,
        photoCount: newCluster.photoCount ?? 0,
        createdAt: newCluster.createdAt,
      },
    };

    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    console.error("[POST /api/faces/clusters/[id]/split] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
