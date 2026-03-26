/**
 * Tests for GET /api/thumbnails/[id]
 *
 * Strategy:
 * - Mock node:fs/promises via bun:test mock.module with a mutable cell.
 *   The cell's `impl` is swapped per-test in beforeEach so each test controls
 *   what readFile returns without needing vi.resetModules().
 * - THUMBNAILS_PATH env var is read inside the handler (not at module load),
 *   so env changes take effect per-request with no module reload.
 *
 * Coverage:
 * - Returns 200 + image/jpeg for existing thumbnail
 * - Returns 404 when file not found (ENOENT)
 * - Returns 400 for path-traversal or slash-containing ids
 * - Uses THUMBNAILS_PATH env var to locate files
 * - Returns 500 for unexpected filesystem errors
 */

import { mock } from "bun:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ─── Mutable cell for readFile behaviour ──────────────────────────────────────

type ReadFileFn = (p: string) => Promise<Buffer>;

const _readFileCell: { impl: ReadFileFn } = {
  impl: async () => {
    throw Object.assign(new Error("not configured"), { code: "ENOENT" });
  },
};

// Install mock before any import of node:fs/promises happens.
mock.module("node:fs/promises", () => ({
  readFile: (p: string) => _readFileCell.impl(p),
}));

// ─── Helper ───────────────────────────────────────────────────────────────────

async function makeRequest(id: string): Promise<Response> {
  const { GET } = await import("@/app/api/thumbnails/[id]/route");
  const url = `http://localhost/api/thumbnails/${id}`;
  const req = new Request(url);
  const params = Promise.resolve({ id });
  return GET(req, { params });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/thumbnails/[id]", () => {
  beforeEach(() => {
    process.env.THUMBNAILS_PATH = "/tmp/test-thumbnails";
    // Default: ENOENT so any test that forgets to set impl gets a clear signal
    _readFileCell.impl = async () => {
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    };
  });

  afterEach(() => {
    delete process.env.THUMBNAILS_PATH;
  });

  it("returns 200 with image/jpeg for an existing thumbnail", async () => {
    const fakeBytes = Buffer.from([0xff, 0xd8, 0xff]); // JPEG magic bytes
    _readFileCell.impl = async () => fakeBytes;

    const res = await makeRequest("abc-123");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body[0]).toBe(0xff);
    expect(body[1]).toBe(0xd8);
  });

  it("returns 404 when thumbnail file does not exist", async () => {
    // default impl already throws ENOENT

    const res = await makeRequest("missing-id");

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data).toHaveProperty("error");
  });

  it("returns 400 for id containing path traversal sequences", async () => {
    const res = await makeRequest("../../../etc/passwd");
    expect(res.status).toBe(400);
  });

  it("returns 400 for id containing slashes", async () => {
    const res = await makeRequest("some/nested/path");
    expect(res.status).toBe(400);
  });

  it("reads from THUMBNAILS_PATH env var", async () => {
    process.env.THUMBNAILS_PATH = "/custom/thumb/dir";
    let calledPath = "";
    _readFileCell.impl = async (p) => {
      calledPath = p;
      return Buffer.from([0xff, 0xd8]);
    };

    await makeRequest("photo-id");

    expect(calledPath).toContain("/custom/thumb/dir");
    expect(calledPath).toContain("photo-id");
  });

  it("returns 500 for unexpected filesystem errors", async () => {
    _readFileCell.impl = async () => {
      throw new Error("disk error");
    };

    const res = await makeRequest("some-id");

    expect(res.status).toBe(500);
  });
});
