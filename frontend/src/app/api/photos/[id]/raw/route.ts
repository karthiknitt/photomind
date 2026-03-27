import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { photos } from "@/lib/db/schema";

// Map file extension to MIME type
function mimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    gif: "image/gif",
    tiff: "image/tiff",
    tif: "image/tiff",
    bmp: "image/bmp",
  };
  return map[ext] ?? "application/octet-stream";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  // Validate id to prevent injection
  if (!/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // Look up library_path
  const rows = await db
    .select({ libraryPath: photos.libraryPath, filenameFinal: photos.filenameFinal })
    .from(photos)
    .where(eq(photos.id, id))
    .limit(1);

  if (rows.length === 0 || !rows[0].libraryPath) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const { libraryPath, filenameFinal } = rows[0];
  const remote = process.env.RCLONE_OUTPUT_REMOTE ?? "onedrive";
  const remotePath = `${remote}:${libraryPath}`;

  // Stream file via rclone cat
  return new Promise<Response>((resolve) => {
    const chunks: Buffer[] = [];
    const proc = spawn("rclone", ["cat", remotePath]);

    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

    proc.on("close", (code) => {
      if (code !== 0 || chunks.length === 0) {
        resolve(NextResponse.json({ error: "Failed to fetch from OneDrive" }, { status: 502 }));
        return;
      }
      const buffer = Buffer.concat(chunks);
      const filename = filenameFinal ?? libraryPath.split("/").pop() ?? "photo.jpg";
      resolve(
        new Response(buffer, {
          status: 200,
          headers: {
            "content-type": mimeType(filename),
            "content-disposition": `inline; filename="${filename}"`,
            "content-length": String(buffer.length),
            "cache-control": "private, max-age=3600",
          },
        })
      );
    });

    proc.on("error", () => {
      resolve(NextResponse.json({ error: "rclone not available" }, { status: 503 }));
    });
  });
}
