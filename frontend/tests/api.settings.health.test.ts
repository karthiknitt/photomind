/**
 * Tests for GET /api/settings/health
 *
 * Strategy:
 * - Mock globalThis.fetch with bun:test mock to simulate bridge responses.
 * - Test both success (bridge reachable) and failure (fetch throws) cases.
 *
 * Coverage:
 * - Returns { bridge: { status: "ok", url, latencyMs } } when bridge responds
 * - Returns { bridge: { status: "error", url, error } } when fetch fails
 * - Uses CLIP_BRIDGE_URL env var for the bridge URL
 * - latencyMs is a non-negative number when bridge is ok
 */

import { mock } from "bun:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ─── Mutable cell for fetch behaviour ────────────────────────────────────────

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const _fetchCell: { impl: FetchFn } = {
  impl: async () => {
    throw new Error("fetch not configured");
  },
};

// Install mock before any import of the route happens.
mock.module("node:module", () => ({})); // no-op to ensure mock.module is loaded

// Override globalThis.fetch before route import
const mockFetch = mock((url: string, init?: RequestInit) => _fetchCell.impl(url, init));
globalThis.fetch = mockFetch as unknown as typeof fetch;

// ─── Helper: call GET handler ─────────────────────────────────────────────────

async function callGet(): Promise<Response> {
  const { GET } = await import("@/app/api/settings/health/route");
  const req = new Request("http://localhost/api/settings/health") as Parameters<typeof GET>[0];
  return GET(req);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/settings/health", () => {
  beforeEach(() => {
    process.env.CLIP_BRIDGE_URL = "http://localhost:9999";
    mockFetch.mockClear();
  });

  afterEach(() => {
    delete process.env.CLIP_BRIDGE_URL;
  });

  it("returns status ok with latencyMs when bridge responds", async () => {
    _fetchCell.impl = async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 });

    const res = await callGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.bridge.status).toBe("ok");
    expect(data.bridge.url).toBe("http://localhost:9999");
    expect(typeof data.bridge.latencyMs).toBe("number");
    expect(data.bridge.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns status error with error message when fetch fails", async () => {
    _fetchCell.impl = async () => {
      throw new Error("ECONNREFUSED");
    };

    const res = await callGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.bridge.status).toBe("error");
    expect(data.bridge.url).toBe("http://localhost:9999");
    expect(data.bridge.error).toContain("ECONNREFUSED");
  });

  it("uses CLIP_BRIDGE_URL env var for the bridge URL", async () => {
    process.env.CLIP_BRIDGE_URL = "http://custom-bridge:1234";
    let calledUrl = "";
    _fetchCell.impl = async (url) => {
      calledUrl = url;
      return new Response("{}", { status: 200 });
    };

    await callGet();
    expect(calledUrl).toBe("http://custom-bridge:1234/health");
  });

  it("uses default CLIP_BRIDGE_URL when env var is not set", async () => {
    delete process.env.CLIP_BRIDGE_URL;
    let calledUrl = "";
    _fetchCell.impl = async (url) => {
      calledUrl = url;
      return new Response("{}", { status: 200 });
    };

    await callGet();
    expect(calledUrl).toBe("http://localhost:8765/health");
  });

  it("returns status error when bridge returns non-ok HTTP status", async () => {
    _fetchCell.impl = async () => new Response("Service Unavailable", { status: 503 });

    const res = await callGet();
    const data = await res.json();
    expect(data.bridge.status).toBe("error");
    expect(data.bridge.url).toBe("http://localhost:9999");
    expect(data.bridge).toHaveProperty("error");
  });
});
