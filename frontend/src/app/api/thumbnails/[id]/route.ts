import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

// Guard against path traversal: id must be a plain UUID-like string (no slashes, no dots-dot)
function isValidId(id: string): boolean {
  return /^[\w-]+$/.test(id);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  if (!isValidId(id)) {
    return NextResponse.json({ error: "Invalid thumbnail id" }, { status: 400 });
  }

  const thumbnailsDir = process.env.THUMBNAILS_PATH ?? `${process.env.HOME}/photomind/thumbnails`;
  const filePath = path.join(thumbnailsDir, `${id}.jpg`);

  try {
    const data = await readFile(filePath);
    return new Response(data, {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });
    }
    console.error("[thumbnails] read error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
