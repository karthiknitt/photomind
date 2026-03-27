import { spawnSync } from "node:child_process";
import { type NextRequest, NextResponse } from "next/server";

// ─── Types ────────────────────────────────────────────────────────────────────

type OAuthProvider = "drive" | "dropbox" | "onedrive";

const SUPPORTED_PROVIDERS: OAuthProvider[] = ["drive", "dropbox", "onedrive"];

function isSupportedProvider(value: string): value is OAuthProvider {
  return SUPPORTED_PROVIDERS.includes(value as OAuthProvider);
}

// ─── GET /api/sources/oauth-auth ─────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");

  if (!provider) {
    return NextResponse.json({ error: "Missing required query param: provider" }, { status: 400 });
  }

  if (!isSupportedProvider(provider)) {
    return NextResponse.json(
      {
        error: `Unsupported provider: '${provider}'. Must be one of: ${SUPPORTED_PROVIDERS.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const result = spawnSync("rclone", ["authorize", provider, "--auth-no-open-browser"], {
    encoding: "buffer",
  });

  const stdout = result.stdout.toString("utf-8");
  const stderr = result.stderr.toString("utf-8");
  const combined = `${stdout}\n${stderr}`;

  // Extract https:// URL from combined output
  const urlMatch = /https:\/\/\S+/.exec(combined);
  if (!urlMatch) {
    console.error("[GET /api/sources/oauth-auth] No URL found in rclone output:", combined);
    return NextResponse.json(
      { error: "Could not extract authorization URL from rclone output" },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: urlMatch[0] }, { status: 200 });
}
