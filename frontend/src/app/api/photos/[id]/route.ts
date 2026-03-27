import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { faceClusters, faces, photos } from "@/lib/db/schema";

// ─── Response shapes ──────────────────────────────────────────────────────────

interface FaceRow {
  id: string;
  clusterId: string | null;
  clusterLabel: string | null;
  bboxX: number | null;
  bboxY: number | null;
  bboxW: number | null;
  bboxH: number | null;
  detScore: number | null;
}

interface PhotoDetail {
  id: string;
  filenameFinal: string | null;
  dateTaken: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  width: number | null;
  height: number | null;
  fileSize: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
  isMeme: boolean;
  faceCount: number;
  clipIndexed: boolean;
  status: string;
  createdAt: number;
}

interface PhotoDetailResponse {
  photo: PhotoDetail;
  faces: FaceRow[];
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  try {
    // 1. Fetch the photo
    const photoRows = await db
      .select({
        id: photos.id,
        filenameFinal: photos.filenameFinal,
        dateTaken: photos.dateTaken,
        city: photos.city,
        state: photos.state,
        country: photos.country,
        cameraMake: photos.cameraMake,
        cameraModel: photos.cameraModel,
        width: photos.width,
        height: photos.height,
        fileSize: photos.fileSize,
        gpsLat: photos.gpsLat,
        gpsLon: photos.gpsLon,
        isMeme: photos.isMeme,
        faceCount: photos.faceCount,
        clipIndexed: photos.clipIndexed,
        status: photos.status,
        createdAt: photos.createdAt,
      })
      .from(photos)
      .where(eq(photos.id, id))
      .limit(1);

    if (photoRows.length === 0) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    const row = photoRows[0];
    const photo: PhotoDetail = {
      ...row,
      isMeme: Boolean(row.isMeme),
      clipIndexed: Boolean(row.clipIndexed),
      faceCount: row.faceCount ?? 0,
      status: row.status ?? "QUEUED",
    };

    // 2. Fetch faces with left-joined cluster labels
    const faceRows = await db
      .select({
        id: faces.id,
        clusterId: faces.clusterId,
        clusterLabel: faceClusters.label,
        bboxX: faces.bboxX,
        bboxY: faces.bboxY,
        bboxW: faces.bboxW,
        bboxH: faces.bboxH,
        detScore: faces.detScore,
      })
      .from(faces)
      .leftJoin(faceClusters, eq(faces.clusterId, faceClusters.id))
      .where(eq(faces.photoId, id));

    const faceData: FaceRow[] = faceRows.map((f) => ({
      id: f.id,
      clusterId: f.clusterId ?? null,
      clusterLabel: f.clusterLabel ?? null,
      bboxX: f.bboxX ?? null,
      bboxY: f.bboxY ?? null,
      bboxW: f.bboxW ?? null,
      bboxH: f.bboxH ?? null,
      detScore: f.detScore ?? null,
    }));

    const response: PhotoDetailResponse = { photo, faces: faceData };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/photos/${id}] DB error:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
