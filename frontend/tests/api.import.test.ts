/**
 * Tests for /api/import (list + create) and /api/import/[id] (status poll).
 *
 * Strategy:
 * - Mock `@/lib/db/client` to replace the Drizzle db instance with a cell-backed fake.
 * - Mock `node:fs` for existsSync / statSync calls used in POST validation.
 * - Mock `node:child_process` to intercept spawn calls.
 *
 * Coverage:
 * - GET /api/import returns jobs list ordered by createdAt desc
 * - POST /api/import with valid path inserts job and spawns subprocess with correct args
 * - POST /api/import with path outside safe roots returns 403
 * - POST /api/import with non-existent path returns 400
 * - POST /api/import with a file (not dir) path returns 400
 * - GET /api/import/[id] returns single job
 * - GET /api/import/[id] with unknown id returns 404
 */

import { mock } from "bun:test";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

// ─── Capture real node:fs BEFORE mocking ──────────────────────────────────────
const _realRequire = createRequire(import.meta.url);
const _realFs = _realRequire("node:fs") as typeof import("node:fs");

// ─── Mutable cells ────────────────────────────────────────────────────────────

interface ImportJobRow {
  id: string;
  status: string;
  localPath: string;
  label: string | null;
  totalCount: number | null;
  processedCount: number;
  errorCount: number;
  createdAt: number;
  finishedAt: number | null;
}

const _dbCell: {
  jobs: ImportJobRow[];
  inserted: ImportJobRow[];
} = {
  jobs: [],
  inserted: [],
};

interface SpawnResult {
  unref: () => void;
}

const _spawnCell: {
  calls: Array<{ cmd: string; args: string[]; opts: object }>;
  result: SpawnResult;
} = {
  calls: [],
  result: { unref: () => {} },
};

// When null, falls through to real fs — prevents breaking drizzle migration reads
// in other test files sharing the same bun:test worker.
const _fsCell: {
  existsSync: ((p: string) => boolean) | null;
  statSync: ((p: string) => { isDirectory: () => boolean }) | null;
} = {
  existsSync: null,
  statSync: null,
};

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock Drizzle db — intercept all chained calls with a tiny query builder stub.
// The route uses: db.select(...).from(...).orderBy(...).limit(...) for GET list
//                 db.select(...).from(...).where(...) for GET [id]
//                 db.insert(...).values(...) for POST
mock.module("@/lib/db/client", () => ({
  db: {
    select: (_fields: unknown) => ({
      from: (_table: unknown) => ({
        orderBy: (_col: unknown) => ({
          limit: (_n: number) => Promise.resolve(_dbCell.jobs),
        }),
        where: (_cond: unknown) =>
          Promise.resolve(
            _dbCell.jobs.filter((j) => {
              // The where condition uses eq(importJobs.id, id) — simulate by returning
              // the first job whose id matches _dbCell._whereId. We use a side-channel.
              return j.id === (_dbCell as unknown as { _whereId?: string })._whereId;
            })
          ),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (row: ImportJobRow) => {
        _dbCell.inserted.push(row);
        return Promise.resolve();
      },
    }),
  } as unknown,
}));

// Extend the cell type to include the side-channel for `where` filtering
interface DbCell {
  jobs: ImportJobRow[];
  inserted: ImportJobRow[];
  _whereId?: string;
}
// Patch type retroactively
const dbCell = _dbCell as DbCell;

// Mock node:fs — expose full union of exports used across all test files to avoid
// mock.module collision when tests run in the same bun:test worker.
// Falls through to real node:fs for functions not overridden by the cell.
// Also include a `default` export so CJS-style `import fs from 'node:fs'` works.
mock.module("node:fs", () => {
  const mod = {
    existsSync: (p: string) => (_fsCell.existsSync ? _fsCell.existsSync(p) : _realFs.existsSync(p)),
    statSync: (p: string) =>
      _fsCell.statSync
        ? _fsCell.statSync(p)
        : // biome-ignore lint/suspicious/noExplicitAny: pass-through
          (_realFs.statSync as any)(p),
    // Pass-through stubs for exports used by other routes
    readFileSync: (...args: Parameters<typeof _realFs.readFileSync>) =>
      // biome-ignore lint/suspicious/noExplicitAny: pass-through
      (_realFs.readFileSync as any)(...args),
    writeFileSync: (...args: Parameters<typeof _realFs.writeFileSync>) =>
      // biome-ignore lint/suspicious/noExplicitAny: pass-through
      (_realFs.writeFileSync as any)(...args),
    readdirSync: (...args: Parameters<typeof _realFs.readdirSync>) =>
      // biome-ignore lint/suspicious/noExplicitAny: pass-through
      (_realFs.readdirSync as any)(...args),
  };
  return { ...mod, default: mod };
});

// Mock node:child_process — expose full union of exports (spawn + spawnSync)
mock.module("node:child_process", () => ({
  spawn: (cmd: string, args: string[], opts: object): SpawnResult => {
    _spawnCell.calls.push({ cmd, args, opts });
    return _spawnCell.result;
  },
  // Stub for spawnSync used by sources/route.ts
  spawnSync: () => ({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") }),
}));

// ─── Global reset ─────────────────────────────────────────────────────────────
// Reset cells to null/empty before each test so other test files' code falls
// through to real node:fs (e.g. drizzle migration reads are unaffected).
beforeEach(() => {
  _fsCell.existsSync = null;
  _fsCell.statSync = null;
  _dbCell.jobs = [];
  _dbCell.inserted = [];
  _spawnCell.calls = [];
  _spawnCell.result = { unref: () => {} };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function callGetList(): Promise<Response> {
  const { GET } = await import("@/app/api/import/route");
  const req = new Request("http://localhost/api/import") as Parameters<typeof GET>[0];
  return GET(req);
}

async function callPost(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/import/route");
  const req = new Request("http://localhost/api/import", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as Parameters<typeof POST>[0];
  return POST(req);
}

async function callGetById(id: string): Promise<Response> {
  const { GET } = await import("@/app/api/import/[id]/route");
  const req = new Request(`http://localhost/api/import/${id}`) as Parameters<typeof GET>[0];
  return GET(req, { params: Promise.resolve({ id }) });
}

// ─── GET /api/import (list) ───────────────────────────────────────────────────

describe("GET /api/import", () => {
  beforeEach(() => {
    dbCell.jobs = [];
    dbCell.inserted = [];
    _spawnCell.calls = [];
  });

  it("returns 200 with jobs array", async () => {
    dbCell.jobs = [
      {
        id: "abc",
        status: "DONE",
        localPath: "/media/usb",
        label: "USB Import",
        totalCount: 10,
        processedCount: 10,
        errorCount: 0,
        createdAt: 1700000002,
        finishedAt: 1700000099,
      },
      {
        id: "xyz",
        status: "RUNNING",
        localPath: "/home/user/pics",
        label: null,
        totalCount: null,
        processedCount: 0,
        errorCount: 0,
        createdAt: 1700000001,
        finishedAt: null,
      },
    ];

    const res = await callGetList();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("jobs");
    expect(Array.isArray(data.jobs)).toBe(true);
    expect(data.jobs).toHaveLength(2);
  });

  it("returns jobs with correct shape", async () => {
    dbCell.jobs = [
      {
        id: "job1",
        status: "DONE",
        localPath: "/media/photos",
        label: "My Photos",
        totalCount: 5,
        processedCount: 5,
        errorCount: 1,
        createdAt: 1700000000,
        finishedAt: 1700000500,
      },
    ];

    const res = await callGetList();
    const data = await res.json();
    const job = data.jobs[0];
    expect(job).toHaveProperty("id", "job1");
    expect(job).toHaveProperty("status", "DONE");
    expect(job).toHaveProperty("localPath", "/media/photos");
    expect(job).toHaveProperty("label", "My Photos");
    expect(job).toHaveProperty("totalCount", 5);
    expect(job).toHaveProperty("processedCount", 5);
    expect(job).toHaveProperty("errorCount", 1);
    expect(job).toHaveProperty("createdAt", 1700000000);
    expect(job).toHaveProperty("finishedAt", 1700000500);
  });

  it("returns empty jobs array when no jobs exist", async () => {
    dbCell.jobs = [];
    const res = await callGetList();
    const data = await res.json();
    expect(data.jobs).toHaveLength(0);
  });
});

// ─── POST /api/import ─────────────────────────────────────────────────────────

describe("POST /api/import — valid path", () => {
  beforeEach(() => {
    dbCell.jobs = [];
    dbCell.inserted = [];
    _spawnCell.calls = [];
    // Default: path exists and is a directory
    _fsCell.existsSync = () => true;
    _fsCell.statSync = () => ({ isDirectory: () => true });
  });

  it("returns 201 with jobId on success", async () => {
    const res = await callPost({ localPath: "/media/usb/photos", label: "USB" });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty("jobId");
    expect(typeof data.jobId).toBe("string");
    expect(data.jobId.length).toBeGreaterThan(0);
  });

  it("inserts a job row into the DB", async () => {
    await callPost({ localPath: "/media/usb/photos", label: "USB" });
    expect(dbCell.inserted).toHaveLength(1);
    const row = dbCell.inserted[0];
    expect(row.status).toBe("RUNNING");
    expect(row.localPath).toBe("/media/usb/photos");
    expect(row.label).toBe("USB");
    expect(typeof row.id).toBe("string");
    expect(row.createdAt).toBeGreaterThan(0);
  });

  it("spawns the python subprocess with correct args", async () => {
    const res = await callPost({ localPath: "/media/usb/photos" });
    const data = await res.json();
    const jobId = data.jobId as string;

    expect(_spawnCell.calls).toHaveLength(1);
    const { cmd, args } = _spawnCell.calls[0];
    expect(cmd).toBe("uv");

    // Args must include: run, --project <backendDir>, python, -c, <script>, jobId, localPath, dbPath
    const allArgs = args.join(" ");
    expect(allArgs).toContain("run");
    expect(allArgs).toContain(jobId);
    expect(allArgs).toContain("/media/usb/photos");
  });

  it("spawns subprocess with detached: true", async () => {
    await callPost({ localPath: "/media/usb/photos" });
    const { opts } = _spawnCell.calls[0];
    expect((opts as Record<string, unknown>).detached).toBe(true);
  });

  it("spawns subprocess with stdio: ignore", async () => {
    await callPost({ localPath: "/media/usb/photos" });
    const { opts } = _spawnCell.calls[0];
    expect((opts as Record<string, unknown>).stdio).toBe("ignore");
  });

  it("calls unref() on the child process to detach it", async () => {
    let unrefCalled = false;
    _spawnCell.result = {
      unref: () => {
        unrefCalled = true;
      },
    };
    await callPost({ localPath: "/media/usb/photos" });
    expect(unrefCalled).toBe(true);
  });

  it("works without optional label field", async () => {
    const res = await callPost({ localPath: "/home/user/pics" });
    expect(res.status).toBe(201);
    expect(dbCell.inserted[0].label).toBeNull();
  });
});

describe("POST /api/import — path validation errors", () => {
  beforeEach(() => {
    dbCell.inserted = [];
    _spawnCell.calls = [];
  });

  it("returns 400 when localPath is missing", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.statSync = () => ({ isDirectory: () => true });
    const res = await callPost({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when localPath is not a string", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.statSync = () => ({ isDirectory: () => true });
    const res = await callPost({ localPath: 42 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when path does not exist", async () => {
    _fsCell.existsSync = () => false;
    _fsCell.statSync = () => ({ isDirectory: () => false });
    const res = await callPost({ localPath: "/media/nonexistent" });
    expect(res.status).toBe(400);
    // Should not have spawned anything
    expect(_spawnCell.calls).toHaveLength(0);
  });

  it("returns 400 when path is a file, not a directory", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.statSync = () => ({ isDirectory: () => false });
    const res = await callPost({ localPath: "/media/usb/photo.jpg" });
    expect(res.status).toBe(400);
    expect(_spawnCell.calls).toHaveLength(0);
  });

  it("returns 403 when path is outside safe roots (/tmp)", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.statSync = () => ({ isDirectory: () => true });
    const res = await callPost({ localPath: "/tmp/photos" });
    expect(res.status).toBe(403);
    expect(_spawnCell.calls).toHaveLength(0);
  });

  it("returns 403 when path is /etc", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.statSync = () => ({ isDirectory: () => true });
    const res = await callPost({ localPath: "/etc/passwd" });
    expect(res.status).toBe(403);
    expect(_spawnCell.calls).toHaveLength(0);
  });

  it("returns 403 when path tries directory traversal outside safe roots", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.statSync = () => ({ isDirectory: () => true });
    const res = await callPost({ localPath: "/media/../../../etc" });
    expect(res.status).toBe(403);
    expect(_spawnCell.calls).toHaveLength(0);
  });

  it("accepts /media path", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.statSync = () => ({ isDirectory: () => true });
    dbCell.inserted = [];
    const res = await callPost({ localPath: "/media/usb/photos" });
    expect(res.status).toBe(201);
  });

  it("accepts /mnt path", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.statSync = () => ({ isDirectory: () => true });
    dbCell.inserted = [];
    const res = await callPost({ localPath: "/mnt/nas/photos" });
    expect(res.status).toBe(201);
  });

  it("accepts /home path", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.statSync = () => ({ isDirectory: () => true });
    dbCell.inserted = [];
    const res = await callPost({ localPath: "/home/user/photos" });
    expect(res.status).toBe(201);
  });
});

// ─── GET /api/import/[id] ─────────────────────────────────────────────────────

describe("GET /api/import/[id]", () => {
  beforeEach(() => {
    dbCell.jobs = [];
    dbCell._whereId = undefined;
  });

  it("returns 200 with the job when found", async () => {
    const job: ImportJobRow = {
      id: "job-abc-123",
      status: "RUNNING",
      localPath: "/media/usb/photos",
      label: "USB Import",
      totalCount: 100,
      processedCount: 42,
      errorCount: 2,
      createdAt: 1700000000,
      finishedAt: null,
    };
    dbCell.jobs = [job];
    dbCell._whereId = "job-abc-123";

    const res = await callGetById("job-abc-123");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("id", "job-abc-123");
    expect(data).toHaveProperty("status", "RUNNING");
    expect(data).toHaveProperty("processedCount", 42);
  });

  it("returns job with correct shape", async () => {
    const job: ImportJobRow = {
      id: "job-xyz-456",
      status: "DONE",
      localPath: "/home/user/pics",
      label: null,
      totalCount: 50,
      processedCount: 50,
      errorCount: 0,
      createdAt: 1700001000,
      finishedAt: 1700002000,
    };
    dbCell.jobs = [job];
    dbCell._whereId = "job-xyz-456";

    const res = await callGetById("job-xyz-456");
    const data = await res.json();
    expect(data).toHaveProperty("id");
    expect(data).toHaveProperty("status");
    expect(data).toHaveProperty("localPath");
    expect(data).toHaveProperty("label");
    expect(data).toHaveProperty("totalCount");
    expect(data).toHaveProperty("processedCount");
    expect(data).toHaveProperty("errorCount");
    expect(data).toHaveProperty("createdAt");
    expect(data).toHaveProperty("finishedAt");
  });

  it("returns 404 when job id is not found", async () => {
    dbCell.jobs = [];
    dbCell._whereId = "nonexistent-id";

    const res = await callGetById("nonexistent-id");
    expect(res.status).toBe(404);
  });

  it("returns 404 when DB has jobs but id does not match", async () => {
    dbCell.jobs = [
      {
        id: "other-id",
        status: "DONE",
        localPath: "/media/photos",
        label: null,
        totalCount: 5,
        processedCount: 5,
        errorCount: 0,
        createdAt: 1700000000,
        finishedAt: 1700000500,
      },
    ];
    dbCell._whereId = "missing-id";

    const res = await callGetById("missing-id");
    expect(res.status).toBe(404);
  });
});
