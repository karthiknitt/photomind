import { spawnSync } from "node:child_process";
import { type NextRequest, NextResponse } from "next/server";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestOkResponse {
  ok: true;
}

interface TestErrorResponse {
  ok: false;
  error: string;
}

// ─── POST /api/sources/test ───────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { name?: string };
  try {
    body = (await request.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name } = body;
  if (!name) {
    return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
  }

  const result = spawnSync("rclone", ["lsd", `${name}:`], {
    encoding: "buffer",
  });

  if (result.error) {
    const response: TestErrorResponse = {
      ok: false,
      error: result.error.message,
    };
    return NextResponse.json(response, { status: 200 });
  }

  if (result.status !== 0) {
    const stderr = result.stderr.toString("utf-8");
    const response: TestErrorResponse = {
      ok: false,
      error: stderr || "rclone exited with non-zero status",
    };
    return NextResponse.json(response, { status: 200 });
  }

  const response: TestOkResponse = { ok: true };
  return NextResponse.json(response, { status: 200 });
}
