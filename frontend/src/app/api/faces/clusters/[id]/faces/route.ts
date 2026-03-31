import { desc, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { faceClusters, faces, photos } from "@/lib/db/schema";

// ─── Response shapes ──────────────────────────────────────────────────────────

interface FaceRow {
  id: string;
  photoId: string;
  bboxX: number | null;
  bboxY: number | null;
  bboxW: number | null;
  bboxH: number | null;
  detScore: number | null;
  photoWidth: number | null;
  photoHeight: number | null;
}

interface FacesResponse {
  faces: FaceRow[];
  total: number;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  try {
    // 1. Check cluster exists
    const cluster = await db.select().from(faceClusters).where(eq(faceClusters.id, id));

    if (cluster.length === 0) {
      return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
    }

    // 2. Fetch faces joined with photo dimensions for client-side bbox rendering
    const rows = await db
      .select({
        id: faces.id,
        photoId: faces.photoId,
        bboxX: faces.bboxX,
        bboxY: faces.bboxY,
        bboxW: faces.bboxW,
        bboxH: faces.bboxH,
        detScore: faces.detScore,
        photoWidth: photos.width,
        photoHeight: photos.height,
      })
      .from(faces)
      .innerJoin(photos, eq(faces.photoId, photos.id))
      .where(eq(faces.clusterId, id))
      .orderBy(desc(faces.detScore));

    const response: FacesResponse = {
      faces: rows,
      total: rows.length,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[GET /api/faces/clusters/[id]/faces] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
