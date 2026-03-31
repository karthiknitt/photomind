import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { faceClusterPairs, faceClusters } from "@/lib/db/schema";

// ─── Response shapes ──────────────────────────────────────────────────────────

interface PairRow {
  id: string;
  clusterIdA: string;
  clusterIdB: string;
  isSame: boolean;
  createdAt: number;
}

interface PairsResponse {
  pair: PairRow;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const { clusterIdA, clusterIdB, isSame } = body as Record<string, unknown>;

  if (typeof clusterIdA !== "string") {
    return NextResponse.json({ error: "clusterIdA is required" }, { status: 400 });
  }
  if (typeof clusterIdB !== "string") {
    return NextResponse.json({ error: "clusterIdB is required" }, { status: 400 });
  }
  if (typeof isSame !== "boolean") {
    return NextResponse.json({ error: "isSame must be a boolean" }, { status: 400 });
  }
  if (clusterIdA === clusterIdB) {
    return NextResponse.json({ error: "clusterIdA and clusterIdB must be different" }, { status: 400 });
  }

  try {
    // Validate both clusters exist
    const [clusterA] = await db
      .select({ id: faceClusters.id })
      .from(faceClusters)
      .where(eq(faceClusters.id, clusterIdA));

    if (!clusterA) {
      return NextResponse.json({ error: "Cluster A not found" }, { status: 404 });
    }

    const [clusterB] = await db
      .select({ id: faceClusters.id })
      .from(faceClusters)
      .where(eq(faceClusters.id, clusterIdB));

    if (!clusterB) {
      return NextResponse.json({ error: "Cluster B not found" }, { status: 404 });
    }

    // Normalise order: smaller UUID in clusterIdA
    const [normA, normB] = [clusterIdA, clusterIdB].sort();
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await db.insert(faceClusterPairs).values({
      id,
      clusterIdA: normA,
      clusterIdB: normB,
      isSame,
      createdAt: now,
    });

    const response: PairsResponse = {
      pair: {
        id,
        clusterIdA: normA,
        clusterIdB: normB,
        isSame,
        createdAt: now,
      },
    };

    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    console.error("[POST /api/faces/pairs] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
