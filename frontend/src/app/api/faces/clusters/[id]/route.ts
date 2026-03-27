import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { faceClusters } from "@/lib/db/schema";

// ─── Response shapes ──────────────────────────────────────────────────────────

interface ClusterRow {
  id: string;
  label: string | null;
  photoCount: number;
  createdAt: number;
}

interface PatchClusterResponse {
  cluster: ClusterRow;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  // 1. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  // 2. Validate label field
  if (typeof body !== "object" || body === null || !("label" in body)) {
    return badRequest("Missing required field: label");
  }

  const { label } = body as { label: unknown };

  if (typeof label !== "string") {
    return badRequest("label must be a string");
  }

  if (label.length > 100) {
    return badRequest("label must be 100 characters or fewer");
  }

  try {
    // 3. Check cluster exists
    const existing = await db.select().from(faceClusters).where(eq(faceClusters.id, id));

    if (existing.length === 0) {
      return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
    }

    // 4. Update label — empty string clears to null
    const newLabel = label === "" ? null : label;

    await db.update(faceClusters).set({ label: newLabel }).where(eq(faceClusters.id, id));

    // 5. Fetch updated cluster
    const [updated] = await db.select().from(faceClusters).where(eq(faceClusters.id, id));

    const response: PatchClusterResponse = {
      cluster: {
        id: updated.id,
        label: updated.label ?? null,
        photoCount: updated.photoCount ?? 0,
        createdAt: updated.createdAt,
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[PATCH /api/faces/clusters/[id]] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
