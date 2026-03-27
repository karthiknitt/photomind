import { type NextRequest, NextResponse } from "next/server";

// ─── Response shape ───────────────────────────────────────────────────────────

interface BridgeOk {
  status: "ok";
  url: string;
  latencyMs: number;
}

interface BridgeError {
  status: "error";
  url: string;
  error: string;
}

type BridgeStatus = BridgeOk | BridgeError;

interface HealthResponse {
  bridge: BridgeStatus;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const bridgeUrl = process.env.CLIP_BRIDGE_URL ?? "http://localhost:8765";
  const healthUrl = `${bridgeUrl}/health`;

  const start = Date.now();

  try {
    const res = await fetch(healthUrl, {
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      const response: HealthResponse = {
        bridge: {
          status: "error",
          url: bridgeUrl,
          error: `HTTP ${res.status}: ${res.statusText}`,
        },
      };
      return NextResponse.json(response, { status: 200 });
    }

    const latencyMs = Date.now() - start;
    const response: HealthResponse = {
      bridge: {
        status: "ok",
        url: bridgeUrl,
        latencyMs,
      },
    };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const response: HealthResponse = {
      bridge: {
        status: "error",
        url: bridgeUrl,
        error: errorMessage,
      },
    };
    return NextResponse.json(response, { status: 200 });
  }
}
