import { spawn } from "node:child_process";
import { type NextRequest, NextResponse } from "next/server";

// ─── Types ────────────────────────────────────────────────────────────────────

type OAuthProvider = "drive" | "dropbox" | "onedrive";

const SUPPORTED_PROVIDERS: OAuthProvider[] = ["drive", "dropbox", "onedrive"];

function isSupportedProvider(value: string): value is OAuthProvider {
  return SUPPORTED_PROVIDERS.includes(value as OAuthProvider);
}

const OAUTH_URL_TIMEOUT_MS = 30_000;

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

  // Use spawn (non-blocking) instead of spawnSync — rclone authorize does NOT
  // exit after printing the URL; it waits for the full OAuth flow to complete.
  // spawnSync would block the Node.js event loop indefinitely.
  return new Promise<NextResponse>((resolve) => {
    // spawn uses argv array — no shell, no injection risk
    const proc = spawn("rclone", ["authorize", provider, "--auth-no-open-browser"]);

    let combined = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      console.error("[GET /api/sources/oauth-auth] Timed out waiting for rclone OAuth URL");
      resolve(
        NextResponse.json({ error: "Timeout waiting for authorization URL" }, { status: 500 })
      );
    }, OAUTH_URL_TIMEOUT_MS);

    function tryExtract() {
      if (settled) return;
      // rclone outputs http:// URLs (localhost OAuth callback) or https:// URLs
      const urlMatch = /https?:\/\/\S+/.exec(combined);
      if (urlMatch) {
        settled = true;
        clearTimeout(timeout);
        proc.kill();
        resolve(NextResponse.json({ url: urlMatch[0] }, { status: 200 }));
      }
    }

    proc.stdout?.on("data", (chunk: Buffer) => {
      combined += chunk.toString("utf-8");
      tryExtract();
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      combined += chunk.toString("utf-8");
      tryExtract();
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      console.error("[GET /api/sources/oauth-auth] rclone spawn error:", err.message);
      resolve(NextResponse.json({ error: err.message }, { status: 500 }));
    });

    proc.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      console.error(
        "[GET /api/sources/oauth-auth] rclone exited without emitting a URL:",
        combined
      );
      resolve(
        NextResponse.json(
          { error: "Could not extract authorization URL from rclone output" },
          { status: 500 }
        )
      );
    });
  });
}
