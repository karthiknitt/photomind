import { asc } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { sources } from "@/lib/db/schema";

// ─── Response shape ───────────────────────────────────────────────────────────

interface SystemConfig {
  databasePath: string;
  thumbnailsPath: string;
  clipBridgeUrl: string;
}

interface SourceRow {
  id: string;
  remoteName: string;
  displayName: string;
  scanPath: string;
  lastScannedAt: number | null;
  enabled: boolean;
}

interface SettingsResponse {
  system: SystemConfig;
  sources: SourceRow[];
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const system: SystemConfig = {
    databasePath: process.env.DATABASE_PATH ?? "~/photomind/photomind.db",
    thumbnailsPath: process.env.THUMBNAILS_PATH ?? "~/photomind/thumbnails",
    clipBridgeUrl: process.env.CLIP_BRIDGE_URL ?? "http://localhost:8765",
  };

  try {
    const rows = await db
      .select({
        id: sources.id,
        remoteName: sources.remoteName,
        displayName: sources.displayName,
        scanPath: sources.scanPath,
        lastScannedAt: sources.lastScannedAt,
        enabled: sources.enabled,
      })
      .from(sources)
      .orderBy(asc(sources.displayName));

    const sourceRows: SourceRow[] = rows.map((row) => ({
      ...row,
      enabled: Boolean(row.enabled),
    }));

    const response: SettingsResponse = { system, sources: sourceRows };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[GET /api/settings] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
