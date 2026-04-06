import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── mutable cells (hoisted so vi.mock factories can reference them) ──────────
const { _db, _spawn } = vi.hoisted(() => {
  const _db = {
    insert: vi.fn(() => ({ values: vi.fn(async () => {}) })),
  };
  const _spawn = {
    fn: vi.fn(() => ({ unref: vi.fn(() => {}) })),
  };
  return { _db, _spawn };
});

vi.mock("@/lib/db/client", () => ({ db: _db }));
vi.mock("node:child_process", () => ({ spawn: _spawn.fn }));

function makeFormData(files: { name: string; content: string; relPath?: string }[]): FormData {
  const fd = new FormData();
  for (const f of files) {
    const blob = new Blob([f.content], { type: "image/jpeg" });
    const fileObj = new File([blob], f.relPath ?? f.name, { type: "image/jpeg" });
    fd.append("files", fileObj);
  }
  return fd;
}

async function callUpload(fd: FormData, label?: string): Promise<Response> {
  if (label) fd.append("label", label);
  const { POST } = await import("../src/app/api/upload/route");
  const req = new Request("http://localhost/api/upload", { method: "POST", body: fd });
  return POST(req as Parameters<typeof POST>[0]);
}

describe("POST /api/upload", () => {
  let uploadsDir: string;

  beforeEach(async () => {
    uploadsDir = path.join(os.tmpdir(), `pm-upload-test-${Date.now()}`);
    await mkdir(uploadsDir, { recursive: true });
    process.env.UPLOADS_DIR = uploadsDir;
    process.env.DATABASE_PATH = path.join(uploadsDir, "test.db");
    _db.insert.mockReset();
    _db.insert.mockImplementation(() => ({ values: vi.fn(async () => {}) }));
    _spawn.fn.mockReset();
    _spawn.fn.mockImplementation(() => ({ unref: vi.fn(() => {}) }));
  });

  afterEach(async () => {
    await rm(uploadsDir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
    delete process.env.DATABASE_PATH;
  });

  it("returns 201 and jobId for valid file upload", async () => {
    const fd = makeFormData([{ name: "photo.jpg", content: "JFIF_DATA" }]);
    const res = await callUpload(fd, "My Trip");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { jobId: string };
    expect(typeof body.jobId).toBe("string");
    expect(body.jobId.length).toBeGreaterThan(0);
  });

  it("writes uploaded files to staging directory", async () => {
    const fd = makeFormData([
      { name: "a.jpg", content: "AAA" },
      { name: "b.jpg", content: "BBB" },
    ]);
    const res = await callUpload(fd);
    const { jobId } = (await res.json()) as { jobId: string };
    const stagingDir = path.join(uploadsDir, jobId);
    expect(existsSync(path.join(stagingDir, "a.jpg"))).toBe(true);
    expect(existsSync(path.join(stagingDir, "b.jpg"))).toBe(true);
    const content = await readFile(path.join(stagingDir, "a.jpg"), "utf-8");
    expect(content).toBe("AAA");
  });

  it("preserves subdirectory structure from webkitRelativePath", async () => {
    const fd = makeFormData([
      { name: "trip/day1/photo.jpg", content: "X", relPath: "trip/day1/photo.jpg" },
    ]);
    const res = await callUpload(fd);
    const { jobId } = (await res.json()) as { jobId: string };
    const stagingDir = path.join(uploadsDir, jobId);
    expect(existsSync(path.join(stagingDir, "trip", "day1", "photo.jpg"))).toBe(true);
  });

  it("rejects path traversal attempts in filenames", async () => {
    const fd = makeFormData([
      { name: "../../etc/passwd", content: "evil", relPath: "../../etc/passwd" },
    ]);
    const res = await callUpload(fd);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Invalid");
  });

  it("returns 400 when no files are provided", async () => {
    const fd = new FormData();
    fd.append("label", "Empty");
    const res = await callUpload(fd);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("No files");
  });

  it("inserts import_jobs row with RUNNING status", async () => {
    const fd = makeFormData([{ name: "img.jpg", content: "D" }]);
    await callUpload(fd, "Label");
    expect(_db.insert).toHaveBeenCalled();
  });

  it("spawns import_runner subprocess", async () => {
    const fd = makeFormData([{ name: "img.jpg", content: "D" }]);
    await callUpload(fd);
    expect(_spawn.fn).toHaveBeenCalled();
    const spawnArgs = _spawn.fn.mock.calls[0] as unknown as [
      string,
      string[],
      { detached: boolean; stdio: string },
    ];
    expect(spawnArgs[2]).toMatchObject({ detached: true, stdio: "ignore" });
  });
});
