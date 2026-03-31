/**
 * Tests for /api/sources, /api/sources/test, and /api/sources/oauth-auth
 *
 * Strategy:
 * - Mock `node:fs` to simulate config.yaml reads/writes without touching disk.
 * - Mock `node:child_process` to simulate rclone subprocess calls.
 * - Each test group uses a mutable cell pattern (bun:test mock.module + cell).
 *
 * Coverage:
 * - GET /api/sources — returns sources list from config.yaml
 * - POST /api/sources (apikey) — creates rclone remote with correct args
 * - POST /api/sources (oauth) — creates rclone remote with token
 * - DELETE /api/sources — removes source from config.yaml + deletes rclone remote
 * - POST /api/sources/test — returns {ok:true} when rclone exits 0
 * - POST /api/sources/test — returns {ok:false, error} when rclone exits non-zero
 * - GET /api/sources/oauth-auth — returns {url} from rclone authorize output
 */

import { mock } from "bun:test";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

// ─── Capture real node:fs BEFORE mocking ──────────────────────────────────────
// This allows the mock to forward non-config-yaml calls (e.g. drizzle migration
// JSON reads) to the real fs, preventing cross-file test pollution.
const _realRequire = createRequire(import.meta.url);
const _realFs = _realRequire("node:fs") as typeof import("node:fs");

// ─── Mutable cells ────────────────────────────────────────────────────────────

interface SpawnSyncResult {
  status: number | null;
  stdout: Buffer;
  stderr: Buffer;
  error?: Error;
}

interface FakeChildProcess {
  stdout: { on: (event: string, cb: (data: Buffer) => void) => void };
  stderr: { on: (event: string, cb: (data: Buffer) => void) => void };
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  kill: () => void;
}

// When null, the mock falls through to the real fs function.
const _fsCell: {
  existsSync: ((p: string) => boolean) | null;
  readFileSync: ((p: string, enc: BufferEncoding) => string) | null;
  writeFileSync: ((p: string, data: string) => void) | null;
  appendFileSync: ((p: string, data: string) => void) | null;
  mkdirSync: ((p: string, opts?: { recursive?: boolean }) => void) | null;
} = {
  existsSync: null,
  readFileSync: null,
  writeFileSync: null,
  appendFileSync: null,
  mkdirSync: null,
};

const _cpCell: {
  spawnSync: (cmd: string, args: string[], opts?: object) => SpawnSyncResult;
  spawn: (cmd: string, args: string[]) => FakeChildProcess;
} = {
  spawnSync: () => ({
    status: 0,
    stdout: Buffer.from(""),
    stderr: Buffer.from(""),
  }),
  spawn: (_cmd, _args) => {
    const cbMap: Record<string, ((...a: unknown[]) => void)[]> = {};
    setTimeout(() => {
      cbMap.close?.forEach((cb) => {
        cb(0);
      });
    }, 5);
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, cb) => {
        if (!cbMap[event]) cbMap[event] = [];
        cbMap[event].push(cb);
      },
      kill: () => {},
    };
  },
};

// Mock node:fs — expose full union of exports used across all test files to avoid
// mock.module collision when tests run in the same bun:test worker.
// Falls through to real node:fs for any function not overridden by a cell,
// so drizzle migration reads and other internal node:fs uses are unaffected.
// Also include a `default` export so CJS-style `import fs from 'node:fs'` works.
mock.module("node:fs", () => {
  const mod = {
    existsSync: (p: string) => (_fsCell.existsSync ? _fsCell.existsSync(p) : _realFs.existsSync(p)),
    readFileSync: (p: string, enc: BufferEncoding) =>
      _fsCell.readFileSync
        ? _fsCell.readFileSync(p, enc)
        : (_realFs.readFileSync(p, enc) as string),
    writeFileSync: (p: string, data: string) =>
      _fsCell.writeFileSync ? _fsCell.writeFileSync(p, data) : _realFs.writeFileSync(p, data),
    appendFileSync: (p: string, data: string) =>
      _fsCell.appendFileSync ? _fsCell.appendFileSync(p, data) : _realFs.appendFileSync(p, data),
    mkdirSync: (p: string, opts?: { recursive?: boolean }) =>
      _fsCell.mkdirSync
        ? _fsCell.mkdirSync(p, opts)
        : // biome-ignore lint/suspicious/noExplicitAny: pass-through
          (_realFs.mkdirSync as any)(p, opts),
    // Stubs for exports used by filesystem/route.ts and import/route.ts
    readdirSync: (...args: Parameters<typeof _realFs.readdirSync>) =>
      // biome-ignore lint/suspicious/noExplicitAny: pass-through
      (_realFs.readdirSync as any)(...args),
    realpathSync: (...args: Parameters<typeof _realFs.realpathSync>) =>
      // biome-ignore lint/suspicious/noExplicitAny: pass-through
      (_realFs.realpathSync as any)(...args),
    statSync: (...args: Parameters<typeof _realFs.statSync>) =>
      // biome-ignore lint/suspicious/noExplicitAny: pass-through
      (_realFs.statSync as any)(...args),
  };
  return { ...mod, default: mod };
});

// Mock node:child_process — expose full union of exports (spawnSync + spawn)
mock.module("node:child_process", () => ({
  spawnSync: (cmd: string, args: string[], opts?: object) => _cpCell.spawnSync(cmd, args, opts),
  spawn: (cmd: string, args: string[]) => _cpCell.spawn(cmd, args),
}));

// ─── Global reset ─────────────────────────────────────────────────────────────
// Reset cells to null before each test so unrelated tests fall through to the
// real node:fs (e.g. drizzle migration reads in other test files are unaffected).

beforeEach(() => {
  _fsCell.existsSync = null;
  _fsCell.readFileSync = null;
  _fsCell.writeFileSync = null;
  _fsCell.appendFileSync = null;
  _fsCell.mkdirSync = null;
  _cpCell.spawnSync = () => ({
    status: 0,
    stdout: Buffer.from(""),
    stderr: Buffer.from(""),
  });
  _cpCell.spawn = (_cmd, _args) => {
    const cbMap: Record<string, ((...a: unknown[]) => void)[]> = {};
    setTimeout(() => {
      cbMap.close?.forEach((cb) => {
        cb(0);
      });
    }, 5);
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, cb) => {
        if (!cbMap[event]) cbMap[event] = [];
        cbMap[event].push(cb);
      },
      kill: () => {},
    };
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MINIMAL_CONFIG_YAML = `
sources:
  - remote: onedrive_karthik
    scan_path: /Pictures
    label: Karthik OneDrive
  - remote: gdrive_family
    scan_path: /Photos
    label: Family Drive
`.trim();

const EMPTY_CONFIG_YAML = `
sources: []
`.trim();

// Helper: call GET /api/sources
async function callGet(): Promise<Response> {
  const { GET } = await import("@/app/api/sources/route");
  const req = new Request("http://localhost/api/sources") as Parameters<typeof GET>[0];
  return GET(req);
}

// Helper: call POST /api/sources
async function callPost(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/sources/route");
  const req = new Request("http://localhost/api/sources", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as Parameters<typeof POST>[0];
  return POST(req);
}

// Helper: call DELETE /api/sources
async function callDelete(body: unknown): Promise<Response> {
  const { DELETE } = await import("@/app/api/sources/route");
  const req = new Request("http://localhost/api/sources", {
    method: "DELETE",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as Parameters<typeof DELETE>[0];
  return DELETE(req);
}

// Helper: call POST /api/sources/test
async function callTest(body: unknown): Promise<Response> {
  const { POST: testPOST } = await import("@/app/api/sources/test/route");
  const req = new Request("http://localhost/api/sources/test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as Parameters<typeof testPOST>[0];
  return testPOST(req);
}

// Helper: call GET /api/sources/oauth-auth
async function callOauthAuth(provider: string): Promise<Response> {
  const { GET: oauthGET } = await import("@/app/api/sources/oauth-auth/route");
  const req = new Request(
    `http://localhost/api/sources/oauth-auth?provider=${provider}`
  ) as Parameters<typeof oauthGET>[0];
  return oauthGET(req);
}

// ─── GET /api/sources ─────────────────────────────────────────────────────────

describe("GET /api/sources", () => {
  beforeEach(() => {
    _cpCell.spawnSync = () => ({
      status: 0,
      stdout: Buffer.from("type = onedrive\n"),
      stderr: Buffer.from(""),
    });
  });

  it("returns 200 with sources array", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.readFileSync = () => MINIMAL_CONFIG_YAML;

    const res = await callGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("sources");
    expect(Array.isArray(data.sources)).toBe(true);
    expect(data.sources).toHaveLength(2);
  });

  it("returns correct shape for each source", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.readFileSync = () => MINIMAL_CONFIG_YAML;
    _cpCell.spawnSync = (_cmd: string, args: string[]) => {
      const remoteName = args[2] ?? "";
      if (remoteName.startsWith("onedrive")) {
        return {
          status: 0,
          stdout: Buffer.from("type = onedrive\n"),
          stderr: Buffer.from(""),
        };
      }
      return {
        status: 0,
        stdout: Buffer.from("type = drive\n"),
        stderr: Buffer.from(""),
      };
    };

    const res = await callGet();
    const data = await res.json();
    const s = data.sources[0];
    expect(s).toHaveProperty("remote");
    expect(s).toHaveProperty("label");
    expect(s).toHaveProperty("scan_path");
    expect(s).toHaveProperty("provider");
    expect(s).toHaveProperty("status");
    expect(s.status).toBe("active");
  });

  it("returns empty sources when config has no sources", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.readFileSync = () => EMPTY_CONFIG_YAML;

    const res = await callGet();
    const data = await res.json();
    expect(data.sources).toHaveLength(0);
  });

  it("returns empty sources when config.yaml does not exist", async () => {
    _fsCell.existsSync = () => false;

    const res = await callGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sources).toHaveLength(0);
  });

  it("maps rclone type=drive to provider Google Drive", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.readFileSync = () =>
      `sources:\n  - remote: gdrive_test\n    scan_path: /Photos\n    label: Test Drive`;
    _cpCell.spawnSync = () => ({
      status: 0,
      stdout: Buffer.from("type = drive\n"),
      stderr: Buffer.from(""),
    });

    const res = await callGet();
    const data = await res.json();
    expect(data.sources[0].provider).toBe("Google Drive");
  });

  it("maps rclone type=onedrive to provider OneDrive", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.readFileSync = () =>
      `sources:\n  - remote: onedrive_test\n    scan_path: /Pictures\n    label: Test OD`;
    _cpCell.spawnSync = () => ({
      status: 0,
      stdout: Buffer.from("type = onedrive\n"),
      stderr: Buffer.from(""),
    });

    const res = await callGet();
    const data = await res.json();
    expect(data.sources[0].provider).toBe("OneDrive");
  });

  it("maps rclone type=dropbox to provider Dropbox", async () => {
    _fsCell.existsSync = () => true;
    _fsCell.readFileSync = () =>
      `sources:\n  - remote: dropbox_test\n    scan_path: /\n    label: Test DB`;
    _cpCell.spawnSync = () => ({
      status: 0,
      stdout: Buffer.from("type = dropbox\n"),
      stderr: Buffer.from(""),
    });

    const res = await callGet();
    const data = await res.json();
    expect(data.sources[0].provider).toBe("Dropbox");
  });
});

// ─── POST /api/sources (apikey) ───────────────────────────────────────────────

describe("POST /api/sources — apikey provider", () => {
  let capturedSpawnArgs: string[][] = [];
  let writtenYaml = "";

  beforeEach(() => {
    capturedSpawnArgs = [];
    writtenYaml = "";
    _fsCell.existsSync = () => true;
    _fsCell.readFileSync = () => EMPTY_CONFIG_YAML;
    _fsCell.writeFileSync = (_p: string, data: string) => {
      writtenYaml = data;
    };
    _cpCell.spawnSync = (_cmd: string, args: string[]) => {
      capturedSpawnArgs.push(args);
      return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };
  });

  it("returns 201 on success", async () => {
    const res = await callPost({
      type: "apikey",
      provider: "r2",
      name: "my_r2",
      scan_path: "/bucket",
      label: "My R2",
      params: {
        access_key_id: "AKIA123",
        secret_access_key: "secret",
        account_id: "abc123",
      },
    });
    expect(res.status).toBe(201);
  });

  it("calls rclone config create with correct type for R2", async () => {
    await callPost({
      type: "apikey",
      provider: "r2",
      name: "my_r2",
      scan_path: "/bucket",
      label: "My R2",
      params: {
        access_key_id: "AKIA123",
        secret_access_key: "secret",
        account_id: "abc123",
      },
    });
    expect(capturedSpawnArgs.length).toBeGreaterThan(0);
    const configCreateArgs = capturedSpawnArgs[0];
    expect(configCreateArgs[0]).toBe("config");
    expect(configCreateArgs[1]).toBe("create");
    expect(configCreateArgs[2]).toBe("my_r2");
    expect(configCreateArgs[3]).toBe("s3");
  });

  it("calls rclone config create with type s3 for AWS S3", async () => {
    await callPost({
      type: "apikey",
      provider: "s3",
      name: "my_s3",
      scan_path: "/bucket",
      label: "My S3",
      params: { access_key_id: "AK", secret_access_key: "SK", region: "us-east-1" },
    });
    const configCreateArgs = capturedSpawnArgs[0];
    expect(configCreateArgs[3]).toBe("s3");
  });

  it("appends new source to config.yaml after rclone create", async () => {
    await callPost({
      type: "apikey",
      provider: "r2",
      name: "my_r2",
      scan_path: "/bucket",
      label: "My R2",
      params: {
        access_key_id: "AKIA123",
        secret_access_key: "secret",
        account_id: "abc123",
      },
    });
    expect(writtenYaml).toContain("my_r2");
    expect(writtenYaml).toContain("My R2");
    expect(writtenYaml).toContain("/bucket");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await callPost({ type: "apikey", provider: "r2" });
    expect(res.status).toBe(400);
  });

  it("returns 500 when rclone config create fails", async () => {
    _cpCell.spawnSync = () => ({
      status: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("rclone: bad config"),
    });

    const res = await callPost({
      type: "apikey",
      provider: "r2",
      name: "fail_r2",
      scan_path: "/bucket",
      label: "Fail R2",
      params: { access_key_id: "X", secret_access_key: "Y", account_id: "Z" },
    });
    expect(res.status).toBe(500);
  });
});

// ─── POST /api/sources (oauth) ────────────────────────────────────────────────

// OAuth POST now writes the rclone config directly via appendFileSync (INI section)
// instead of passing the token as a cmdline arg to `rclone config create`.
// spawnSync is still used for `config file` (get path) and `config delete` (cleanup).

describe("POST /api/sources — oauth provider", () => {
  const RCLONE_CONF_PATH = "/home/test/.config/rclone/rclone.conf";
  let appendedContent = "";
  let writtenYaml = "";

  beforeEach(() => {
    appendedContent = "";
    writtenYaml = "";
    _fsCell.existsSync = () => true;
    _fsCell.readFileSync = () => EMPTY_CONFIG_YAML;
    _fsCell.writeFileSync = (_p: string, data: string) => {
      writtenYaml = data;
    };
    _fsCell.appendFileSync = (_p: string, data: string) => {
      appendedContent += data;
    };
    _fsCell.mkdirSync = () => {};
    // spawnSync: return config file path on `config file`, success on everything else
    _cpCell.spawnSync = (_cmd: string, args: string[]) => {
      if (args[0] === "config" && args[1] === "file") {
        return {
          status: 0,
          stdout: Buffer.from(`${RCLONE_CONF_PATH}\n`),
          stderr: Buffer.from(""),
        };
      }
      return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };
  });

  it("returns 201 on success with oauth token", async () => {
    const res = await callPost({
      type: "oauth",
      provider: "drive",
      name: "my_drive",
      scan_path: "/Photos",
      label: "My Drive",
      token: '{"access_token":"tok123"}',
    });
    expect(res.status).toBe(201);
  });

  it("writes rclone config section with type=drive for drive provider", async () => {
    await callPost({
      type: "oauth",
      provider: "drive",
      name: "my_drive",
      scan_path: "/Photos",
      label: "My Drive",
      token: '{"access_token":"tok123"}',
    });
    expect(appendedContent).toContain("[my_drive]");
    expect(appendedContent).toContain("type = drive");
  });

  it("writes rclone config section with type=dropbox for dropbox provider", async () => {
    await callPost({
      type: "oauth",
      provider: "dropbox",
      name: "my_dropbox",
      scan_path: "/",
      label: "Dropbox",
      token: '{"access_token":"dbtok"}',
    });
    expect(appendedContent).toContain("[my_dropbox]");
    expect(appendedContent).toContain("type = dropbox");
  });

  it("writes rclone config section with type=onedrive for onedrive provider", async () => {
    await callPost({
      type: "oauth",
      provider: "onedrive",
      name: "my_od",
      scan_path: "/Pictures",
      label: "OneDrive",
      token: '{"access_token":"odtok"}',
    });
    expect(appendedContent).toContain("[my_od]");
    expect(appendedContent).toContain("type = onedrive");
  });

  it("writes token value to rclone config file (not cmdline args)", async () => {
    const token = '{"access_token":"tok999"}';
    await callPost({
      type: "oauth",
      provider: "drive",
      name: "drive_tok",
      scan_path: "/",
      label: "Drive",
      token,
    });
    // Token written to config file, not exposed as a cmdline argument
    expect(appendedContent).toContain(`token = ${token}`);
  });

  it("appends source to config.yaml", async () => {
    await callPost({
      type: "oauth",
      provider: "drive",
      name: "drive_oauth",
      scan_path: "/Photos",
      label: "OAuth Drive",
      token: '{"access_token":"t"}',
    });
    expect(writtenYaml).toContain("drive_oauth");
    expect(writtenYaml).toContain("OAuth Drive");
  });
});

// ─── DELETE /api/sources ──────────────────────────────────────────────────────

describe("DELETE /api/sources", () => {
  let capturedSpawnArgs: string[][] = [];
  let writtenYaml = "";

  beforeEach(() => {
    capturedSpawnArgs = [];
    writtenYaml = "";
    _fsCell.existsSync = () => true;
    _fsCell.readFileSync = () => MINIMAL_CONFIG_YAML;
    _fsCell.writeFileSync = (_p: string, data: string) => {
      writtenYaml = data;
    };
    _cpCell.spawnSync = (_cmd: string, args: string[]) => {
      capturedSpawnArgs.push(args);
      return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };
  });

  it("returns 200 on successful deletion", async () => {
    const res = await callDelete({ name: "onedrive_karthik" });
    expect(res.status).toBe(200);
  });

  it("calls rclone config delete with the remote name", async () => {
    await callDelete({ name: "onedrive_karthik" });
    const deleteArgs = capturedSpawnArgs.find(
      (args) => args[0] === "config" && args[1] === "delete"
    );
    expect(deleteArgs).toBeDefined();
    expect(deleteArgs?.[2]).toBe("onedrive_karthik");
  });

  it("removes the source entry from config.yaml", async () => {
    await callDelete({ name: "onedrive_karthik" });
    expect(writtenYaml).not.toContain("onedrive_karthik");
    // The other source should remain
    expect(writtenYaml).toContain("gdrive_family");
  });

  it("returns 400 when name is missing", async () => {
    const res = await callDelete({});
    expect(res.status).toBe(400);
  });

  it("returns 404 when source is not found in config.yaml", async () => {
    const res = await callDelete({ name: "nonexistent_remote" });
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/sources/test ───────────────────────────────────────────────────

describe("POST /api/sources/test", () => {
  it("returns {ok: true} when rclone lsd exits 0", async () => {
    _cpCell.spawnSync = () => ({
      status: 0,
      stdout: Buffer.from("  -1 2024-01-01 00:00:00 -1 some-folder\n"),
      stderr: Buffer.from(""),
    });

    const res = await callTest({ name: "onedrive_karthik" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data).not.toHaveProperty("error");
  });

  it("returns {ok: false, error} when rclone lsd exits non-zero", async () => {
    _cpCell.spawnSync = () => ({
      status: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("Failed to access remote: authorization error"),
    });

    const res = await callTest({ name: "bad_remote" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data).toHaveProperty("error");
    expect(data.error).toContain("authorization error");
  });

  it("returns {ok: false, error} when rclone spawns with error", async () => {
    _cpCell.spawnSync = () => ({
      status: null,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      error: new Error("spawn rclone ENOENT"),
    });

    const res = await callTest({ name: "some_remote" });
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("spawn rclone ENOENT");
  });

  it("returns 400 when name is missing", async () => {
    const res = await callTest({});
    expect(res.status).toBe(400);
  });

  it("calls rclone lsd with correct remote arg", async () => {
    let capturedArgs: string[] = [];
    _cpCell.spawnSync = (_cmd: string, args: string[]) => {
      capturedArgs = args;
      return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    };

    await callTest({ name: "my_remote" });
    expect(capturedArgs[0]).toBe("lsd");
    expect(capturedArgs[1]).toBe("my_remote:");
  });
});

// ─── GET /api/sources/oauth-auth ─────────────────────────────────────────────

// The oauth-auth route uses async spawn (not spawnSync) because rclone authorize
// doesn't exit after printing the URL — it waits for the full OAuth flow.
// Tests use a fake child process that emits events via setTimeout.

describe("GET /api/sources/oauth-auth", () => {
  function makeSpawnWithOutput(
    stdoutData: string,
    stderrData: string,
    emitClose = false
  ): typeof _cpCell.spawn {
    return (_cmd, _args) => {
      const cbMap: Record<string, ((...a: unknown[]) => void)[]> = {};
      const stdoutCbs: ((d: Buffer) => void)[] = [];
      const stderrCbs: ((d: Buffer) => void)[] = [];
      setTimeout(() => {
        if (stdoutData) {
          stdoutCbs.forEach((cb) => {
            cb(Buffer.from(stdoutData));
          });
        }
        if (stderrData) {
          stderrCbs.forEach((cb) => {
            cb(Buffer.from(stderrData));
          });
        }
        if (emitClose) {
          cbMap.close?.forEach((cb) => {
            cb(0);
          });
        }
      }, 5);
      return {
        stdout: { on: (_e: string, cb: (d: Buffer) => void) => stdoutCbs.push(cb) },
        stderr: { on: (_e: string, cb: (d: Buffer) => void) => stderrCbs.push(cb) },
        on: (event, cb) => {
          if (!cbMap[event]) cbMap[event] = [];
          cbMap[event].push(cb);
        },
        kill: () => {},
      };
    };
  }

  it("returns {url} from rclone authorize stdout output", async () => {
    _cpCell.spawn = makeSpawnWithOutput(
      "Please go to the following link: https://accounts.google.com/oauth?code=abc\nLog in\n",
      ""
    );

    const res = await callOauthAuth("drive");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("url");
    expect(data.url).toMatch(/^https:\/\//);
  });

  it("extracts URL from rclone authorize stderr output", async () => {
    _cpCell.spawn = makeSpawnWithOutput(
      "",
      "Please go to the following link: https://www.dropbox.com/oauth2/authorize?client_id=xyz\n"
    );

    const res = await callOauthAuth("dropbox");
    const data = await res.json();
    expect(data.url).toContain("dropbox.com");
  });

  it("returns 400 when provider query param is missing", async () => {
    const { GET: oauthGET } = await import("@/app/api/sources/oauth-auth/route");
    const req = new Request("http://localhost/api/sources/oauth-auth") as Parameters<
      typeof oauthGET
    >[0];
    const res = await oauthGET(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown provider", async () => {
    const res = await callOauthAuth("unknown_provider");
    expect(res.status).toBe(400);
  });

  it("returns 500 when rclone closes without emitting a URL", async () => {
    _cpCell.spawn = makeSpawnWithOutput("Waiting for code...\n", "", true);

    const res = await callOauthAuth("drive");
    expect(res.status).toBe(500);
  });
});
