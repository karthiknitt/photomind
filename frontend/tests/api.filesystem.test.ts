/**
 * Tests for GET /api/filesystem
 *
 * Strategy:
 * - Mock `node:fs` to simulate filesystem reads without touching disk.
 * - Use mutable cell pattern (bun:test mock.module + cell).
 *
 * Coverage:
 * - No path param → returns safe roots that exist
 * - Valid path under /media → returns subdirectories
 * - Path outside safe roots (/etc, /tmp, /) → returns 403
 * - Path traversal attempt (/media/../etc) → returns 403 (after path.resolve)
 * - Non-existent path → returns 404
 * - Hidden dirs (starting with `.`) are excluded from results
 * - Files are excluded, only dirs returned
 * - Response includes correct `parent` path
 * - Results are sorted alphabetically
 */

import { mock } from "bun:test";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

// ─── Capture real node:fs BEFORE mocking ──────────────────────────────────────
const _realRequire = createRequire(import.meta.url);
const _realFs = _realRequire("node:fs") as typeof import("node:fs");

// ─── Mutable cell ─────────────────────────────────────────────────────────────

interface DirentLike {
  name: string;
  isDirectory: () => boolean;
}

// When null, falls through to the real fs — prevents breaking drizzle migration
// reads in other test files that share the same bun:test worker.
const _fsCell: {
  existsSync: ((p: string) => boolean) | null;
  readdirSync: ((p: string, opts: { withFileTypes: true }) => DirentLike[]) | null;
} = {
  existsSync: null,
  readdirSync: null,
};

// Mock node:fs — expose full union of exports used across all test files to avoid
// mock.module collision when tests run in the same bun:test worker.
// Falls through to real node:fs for functions not overridden by the cell.
// Also include a `default` export so CJS-style `import fs from 'node:fs'` works.
mock.module("node:fs", () => {
  const mod = {
    existsSync: (p: string) =>
      _fsCell.existsSync ? _fsCell.existsSync(p) : _realFs.existsSync(p),
    readdirSync: (p: string, opts: { withFileTypes: true }) =>
      _fsCell.readdirSync
        ? _fsCell.readdirSync(p, opts)
        : // biome-ignore lint/suspicious/noExplicitAny: pass-through
          (_realFs.readdirSync as any)(p, opts),
    // Pass-through stubs for exports used by other routes
    readFileSync: (...args: Parameters<typeof _realFs.readFileSync>) =>
      // biome-ignore lint/suspicious/noExplicitAny: pass-through
      (_realFs.readFileSync as any)(...args),
    writeFileSync: (...args: Parameters<typeof _realFs.writeFileSync>) =>
      // biome-ignore lint/suspicious/noExplicitAny: pass-through
      (_realFs.writeFileSync as any)(...args),
    statSync: (...args: Parameters<typeof _realFs.statSync>) =>
      // biome-ignore lint/suspicious/noExplicitAny: pass-through
      (_realFs.statSync as any)(...args),
  };
  return { ...mod, default: mod };
});

// Stub node:child_process to avoid collision with sources/import test files
mock.module("node:child_process", () => ({
  spawnSync: () => ({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") }),
  spawn: () => ({ unref: () => {} }),
}));

// ─── Global reset ─────────────────────────────────────────────────────────────
// Reset cells to null before each test so other test files' code falls through
// to real node:fs (e.g. drizzle migration reads are unaffected).
beforeEach(() => {
  _fsCell.existsSync = null;
  _fsCell.readdirSync = null;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDirent(name: string, isDir: boolean): DirentLike {
  return { name, isDirectory: () => isDir };
}

async function callGet(searchParams?: string): Promise<Response> {
  const { GET } = await import("@/app/api/filesystem/route");
  const url = searchParams
    ? `http://localhost/api/filesystem?${searchParams}`
    : "http://localhost/api/filesystem";
  const req = new Request(url) as Parameters<typeof GET>[0];
  return GET(req);
}

// ─── No path param → return safe roots ───────────────────────────────────────

describe("GET /api/filesystem — no path param", () => {
  it("returns 200 with existing safe roots when no path param", async () => {
    _fsCell.existsSync = (p: string) => p === "/media" || p === "/mnt";

    const res = await callGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("path");
    expect(data).toHaveProperty("entries");
    expect(data).toHaveProperty("parent");
  });

  it("returns only roots that exist on the filesystem", async () => {
    // Only /media exists, /mnt and /home do not
    _fsCell.existsSync = (p: string) => p === "/media";

    const res = await callGet();
    const data = await res.json();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].path).toBe("/media");
  });

  it("returns all three roots when all exist", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.readdirSync = () => [];

    const res = await callGet();
    const data = await res.json();
    expect(data.entries).toHaveLength(3);
    const paths = data.entries.map((e: { path: string }) => e.path);
    expect(paths).toContain("/media");
    expect(paths).toContain("/mnt");
    expect(paths).toContain("/home");
  });

  it("returns parent=null at root level", async () => {
    _fsCell.existsSync = (p: string) => p === "/media";

    const res = await callGet();
    const data = await res.json();
    expect(data.parent).toBeNull();
  });

  it("each root entry has correct shape", async () => {
    _fsCell.existsSync = (p: string) => p === "/media";

    const res = await callGet();
    const data = await res.json();
    const entry = data.entries[0];
    expect(entry).toHaveProperty("name");
    expect(entry).toHaveProperty("path");
    expect(entry).toHaveProperty("is_dir");
    expect(entry.is_dir).toBe(true);
    expect(entry.name).toBe("media");
    expect(entry.path).toBe("/media");
  });

  it("returns empty entries when no safe roots exist", async () => {
    _fsCell.existsSync = () => false;

    const res = await callGet();
    const data = await res.json();
    expect(data.entries).toHaveLength(0);
    expect(data.parent).toBeNull();
  });
});

// ─── path=/ → same as no path param ──────────────────────────────────────────

describe("GET /api/filesystem — path=/", () => {
  it("returns safe roots when path is /", async () => {
    _fsCell.existsSync = (p: string) => p === "/media";

    const res = await callGet("path=/");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries.length).toBe(1);
    expect(data.entries[0].path).toBe("/media");
    expect(data.parent).toBeNull();
  });
});

// ─── Valid path browsing ───────────────────────────────────────────────────────

describe("GET /api/filesystem — valid paths", () => {
  beforeEach(() => {
    _fsCell.existsSync = () => true;
  });

  it("returns subdirectories under /media", async () => {
    _fsCell.readdirSync = () => [makeDirent("usb", true), makeDirent("cdrom", true)];

    const res = await callGet("path=/media");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.path).toBe("/media");
    expect(data.entries).toHaveLength(2);
    expect(data.entries[0].name).toBe("cdrom");
    expect(data.entries[0].path).toBe("/media/cdrom");
    expect(data.entries[0].is_dir).toBe(true);
    expect(data.entries[1].name).toBe("usb");
    expect(data.entries[1].path).toBe("/media/usb");
  });

  it("returns subdirectories under /mnt/hdd", async () => {
    _fsCell.readdirSync = () => [makeDirent("photos", true), makeDirent("videos", true)];

    const res = await callGet("path=/mnt/hdd");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.path).toBe("/mnt/hdd");
    expect(data.entries).toHaveLength(2);
  });

  it("returns subdirectories under /home/karthik", async () => {
    _fsCell.readdirSync = () => [makeDirent("Pictures", true)];

    const res = await callGet("path=/home/karthik");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries[0].path).toBe("/home/karthik/Pictures");
  });

  it("returns correct parent for /media/usb", async () => {
    _fsCell.readdirSync = () => [];

    const res = await callGet("path=/media/usb");
    const data = await res.json();
    expect(data.parent).toBe("/media");
  });

  it("returns correct parent for /media (safe root)", async () => {
    _fsCell.readdirSync = () => [];

    const res = await callGet("path=/media");
    const data = await res.json();
    // Parent of /media is /, which is outside safe roots → null
    expect(data.parent).toBeNull();
  });

  it("returns correct parent for /mnt/hdd/photos", async () => {
    _fsCell.readdirSync = () => [];

    const res = await callGet("path=/mnt/hdd/photos");
    const data = await res.json();
    expect(data.parent).toBe("/mnt/hdd");
  });

  it("entries are sorted alphabetically", async () => {
    _fsCell.readdirSync = () => [
      makeDirent("zebra", true),
      makeDirent("alpha", true),
      makeDirent("mango", true),
    ];

    const res = await callGet("path=/media");
    const data = await res.json();
    const names = data.entries.map((e: { name: string }) => e.name);
    expect(names).toEqual(["alpha", "mango", "zebra"]);
  });
});

// ─── Security: forbidden paths ────────────────────────────────────────────────

describe("GET /api/filesystem — 403 for unsafe paths", () => {
  it("returns 403 for /etc", async () => {
    const res = await callGet("path=/etc");
    expect(res.status).toBe(403);
  });

  it("returns 403 for /tmp", async () => {
    const res = await callGet("path=/tmp");
    expect(res.status).toBe(403);
  });

  it("returns 403 for /var", async () => {
    const res = await callGet("path=/var");
    expect(res.status).toBe(403);
  });

  it("returns 403 for /root", async () => {
    const res = await callGet("path=/root");
    expect(res.status).toBe(403);
  });

  it("returns 403 for /usr", async () => {
    const res = await callGet("path=/usr");
    expect(res.status).toBe(403);
  });

  it("returns 403 for path traversal /media/../etc", async () => {
    const res = await callGet("path=/media/../etc");
    expect(res.status).toBe(403);
  });

  it("returns 403 for path traversal /mnt/../etc/passwd", async () => {
    const res = await callGet("path=/mnt/../etc/passwd");
    expect(res.status).toBe(403);
  });

  it("returns 403 for /home/../etc (traversal out of safe root)", async () => {
    const res = await callGet("path=/home/../etc");
    expect(res.status).toBe(403);
  });
});

// ─── 404 for non-existent paths ───────────────────────────────────────────────

describe("GET /api/filesystem — 404 for non-existent path", () => {
  it("returns 404 when path does not exist", async () => {
    _fsCell.existsSync = () => false;

    const res = await callGet("path=/media/nonexistent");
    expect(res.status).toBe(404);
  });

  it("returns 404 when readdirSync throws ENOENT", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.readdirSync = () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };

    const res = await callGet("path=/media/broken");
    expect(res.status).toBe(404);
  });

  it("returns 404 when readdirSync throws EACCES (permission denied)", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.readdirSync = () => {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    };

    const res = await callGet("path=/media/locked");
    expect(res.status).toBe(404);
  });
});

// ─── Filtering ────────────────────────────────────────────────────────────────

describe("GET /api/filesystem — filtering", () => {
  beforeEach(() => {
    _fsCell.existsSync = () => true;
  });

  it("excludes hidden directories (starting with .)", async () => {
    _fsCell.readdirSync = () => [
      makeDirent(".hidden", true),
      makeDirent("visible", true),
      makeDirent(".config", true),
    ];

    const res = await callGet("path=/media");
    const data = await res.json();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].name).toBe("visible");
  });

  it("excludes files (non-directories)", async () => {
    _fsCell.readdirSync = () => [
      makeDirent("folder", true),
      makeDirent("image.jpg", false),
      makeDirent("notes.txt", false),
    ];

    const res = await callGet("path=/media");
    const data = await res.json();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].name).toBe("folder");
  });

  it("excludes both hidden dirs and files simultaneously", async () => {
    _fsCell.readdirSync = () => [
      makeDirent(".hidden_dir", true),
      makeDirent("good_dir", true),
      makeDirent("file.png", false),
      makeDirent(".hidden_file", false),
    ];

    const res = await callGet("path=/media");
    const data = await res.json();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].name).toBe("good_dir");
  });

  it("returns empty entries when directory has no visible subdirs", async () => {
    _fsCell.readdirSync = () => [makeDirent("photo.jpg", false), makeDirent(".dotfolder", true)];

    const res = await callGet("path=/media/usb");
    const data = await res.json();
    expect(data.entries).toHaveLength(0);
  });
});
