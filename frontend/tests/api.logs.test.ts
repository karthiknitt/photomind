/**
 * Tests for GET /api/logs
 *
 * TDD: Write tests first, confirm FAIL, then implement.
 *
 * Uses vi.mock to inject an in-memory test DB instead of the real singleton.
 * Each describe block gets a fresh in-memory DB in beforeEach.
 *
 * Coverage:
 * - Returns 200 with correct shape (logs + pagination)
 * - action filter returns only matching entries
 * - Invalid action value returns 400
 * - Invalid page returns 400
 * - pagination hasMore is correct
 * - Empty log returns empty array with total=0
 * - Ordered by timestamp DESC
 * - limit capped at 200
 * - Default pagination values applied
 */

import { Database } from "bun:sqlite";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewActionLog } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import { actionLog } from "@/lib/db/schema";

// ─── Test DB factory ──────────────────────────────────────────────────────────

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let testDb: TestDb;
let testSqlite: Database;

function createTestDb(): { sqlite: Database; db: TestDb } {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  db.run(sql`PRAGMA foreign_keys=OFF`);
  db.run(sql`PRAGMA journal_mode=WAL`);
  migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../drizzle"),
  });
  return { sqlite, db };
}

// ─── Mock the DB client ───────────────────────────────────────────────────────

vi.mock("@/lib/db/client", () => ({
  db: new Proxy(
    {},
    {
      get(_target, prop) {
        // Forward all property accesses to testDb at call time
        return (...args: unknown[]) => {
          // biome-ignore lint/suspicious/noExplicitAny: proxy forwarding
          return (testDb as any)[prop](...args);
        };
      },
    }
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

type ActionEnum = NewActionLog["action"];

const VALID_ACTIONS: ActionEnum[] = [
  "COPIED",
  "SKIPPED_DUPLICATE",
  "SKIPPED_MEME",
  "SKIPPED_ERROR",
  "INDEXED",
  "FACE_DETECTED",
  "CLUSTER_UPDATED",
];

function makeLogEntry(overrides: Partial<NewActionLog> = {}): NewActionLog {
  return {
    id: crypto.randomUUID(),
    photoId: crypto.randomUUID(),
    action: "COPIED",
    detail: "test entry",
    timestamp: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

// ─── Helper: call GET handler ─────────────────────────────────────────────────

async function callGet(params: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/logs/route");
  const url = new URL("http://localhost/api/logs");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const req = new Request(url.toString());
  return GET(req as Parameters<typeof GET>[0]);
}

// ─── TestDefaultBehavior ──────────────────────────────────────────────────────

describe("TestDefaultBehavior", () => {
  beforeEach(() => {
    ({ sqlite: testSqlite, db: testDb } = createTestDb());
  });

  afterEach(() => {
    testSqlite.close();
  });

  it("returns 200 with logs array and pagination", async () => {
    await testDb
      .insert(actionLog)
      .values([
        makeLogEntry({ timestamp: 1000 }),
        makeLogEntry({ timestamp: 2000 }),
        makeLogEntry({ timestamp: 3000 }),
      ]);

    const res = await callGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.logs)).toBe(true);
    expect(body.logs).toHaveLength(3);
    expect(body.pagination.total).toBe(3);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(50);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("each log entry has the expected shape", async () => {
    const photoId = crypto.randomUUID();
    await testDb
      .insert(actionLog)
      .values([
        makeLogEntry({ photoId, action: "INDEXED", detail: "indexed ok", timestamp: 5000 }),
      ]);

    const res = await callGet();
    const body = await res.json();
    expect(body.logs).toHaveLength(1);

    const entry = body.logs[0];
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("photoId", photoId);
    expect(entry).toHaveProperty("action", "INDEXED");
    expect(entry).toHaveProperty("detail", "indexed ok");
    expect(entry).toHaveProperty("timestamp", 5000);
  });

  it("returns empty array with total=0 when no logs exist", async () => {
    const res = await callGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.logs).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("handles null photoId correctly", async () => {
    await testDb
      .insert(actionLog)
      .values([makeLogEntry({ photoId: null, action: "CLUSTER_UPDATED", detail: "re-clustered" })]);

    const res = await callGet();
    const body = await res.json();
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].photoId).toBeNull();
  });
});

// ─── TestOrdering ─────────────────────────────────────────────────────────────

describe("TestOrdering", () => {
  beforeEach(() => {
    ({ sqlite: testSqlite, db: testDb } = createTestDb());
  });

  afterEach(() => {
    testSqlite.close();
  });

  it("orders entries by timestamp DESC", async () => {
    const base = 1700000000;
    await testDb
      .insert(actionLog)
      .values([
        makeLogEntry({ timestamp: base + 100 }),
        makeLogEntry({ timestamp: base + 300 }),
        makeLogEntry({ timestamp: base + 200 }),
      ]);

    const res = await callGet();
    const body = await res.json();
    const timestamps = body.logs.map((e: { timestamp: number }) => e.timestamp);
    expect(timestamps[0]).toBe(base + 300);
    expect(timestamps[1]).toBe(base + 200);
    expect(timestamps[2]).toBe(base + 100);
  });
});

// ─── TestFiltering ────────────────────────────────────────────────────────────

describe("TestFiltering", () => {
  beforeEach(() => {
    ({ sqlite: testSqlite, db: testDb } = createTestDb());
  });

  afterEach(() => {
    testSqlite.close();
  });

  it("action filter returns only matching entries", async () => {
    await testDb
      .insert(actionLog)
      .values([
        makeLogEntry({ action: "COPIED" }),
        makeLogEntry({ action: "SKIPPED_MEME" }),
        makeLogEntry({ action: "COPIED" }),
        makeLogEntry({ action: "INDEXED" }),
      ]);

    const res = await callGet({ action: "COPIED" });
    const body = await res.json();
    expect(body.logs).toHaveLength(2);
    for (const entry of body.logs) {
      expect(entry.action).toBe("COPIED");
    }
    expect(body.pagination.total).toBe(2);
  });

  it("action filter SKIPPED_ERROR returns only error entries", async () => {
    await testDb
      .insert(actionLog)
      .values([
        makeLogEntry({ action: "SKIPPED_ERROR", detail: "file corrupt" }),
        makeLogEntry({ action: "COPIED" }),
      ]);

    const res = await callGet({ action: "SKIPPED_ERROR" });
    const body = await res.json();
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].action).toBe("SKIPPED_ERROR");
  });

  it("returns 400 for invalid action value", async () => {
    const res = await callGet({ action: "INVALID_ACTION" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("all 7 valid action enum values are accepted", async () => {
    for (const action of VALID_ACTIONS) {
      const res = await callGet({ action });
      expect(res.status).toBe(200);
    }
  });
});

// ─── TestPagination ───────────────────────────────────────────────────────────

describe("TestPagination", () => {
  beforeEach(() => {
    ({ sqlite: testSqlite, db: testDb } = createTestDb());
  });

  afterEach(() => {
    testSqlite.close();
  });

  it("paginates correctly", async () => {
    const entries = Array.from({ length: 7 }, (_, i) => makeLogEntry({ timestamp: 1000 + i }));
    await testDb.insert(actionLog).values(entries);

    const res = await callGet({ limit: "3", page: "1" });
    const body = await res.json();
    expect(body.logs).toHaveLength(3);
    expect(body.pagination.total).toBe(7);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(3);
  });

  it("last page hasMore=false", async () => {
    const entries = Array.from({ length: 7 }, (_, i) => makeLogEntry({ timestamp: 1000 + i }));
    await testDb.insert(actionLog).values(entries);

    const res = await callGet({ limit: "3", page: "3" });
    const body = await res.json();
    expect(body.logs).toHaveLength(1);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("hasMore is true when more pages remain", async () => {
    const entries = Array.from({ length: 10 }, (_, i) => makeLogEntry({ timestamp: 1000 + i }));
    await testDb.insert(actionLog).values(entries);

    const res = await callGet({ limit: "5", page: "1" });
    const body = await res.json();
    expect(body.pagination.hasMore).toBe(true);
  });

  it("clamps limit to 200", async () => {
    const entries = Array.from({ length: 210 }, (_, i) => makeLogEntry({ timestamp: 1000 + i }));
    await testDb.insert(actionLog).values(entries);

    const res = await callGet({ limit: "999" });
    const body = await res.json();
    expect(body.pagination.limit).toBe(200);
    expect(body.logs).toHaveLength(200);
  });

  it("returns empty array when page exceeds total", async () => {
    await testDb.insert(actionLog).values([makeLogEntry(), makeLogEntry()]);

    const res = await callGet({ page: "5" });
    const body = await res.json();
    expect(body.logs).toHaveLength(0);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.total).toBe(2);
  });
});

// ─── TestValidation ───────────────────────────────────────────────────────────

describe("TestValidation", () => {
  beforeEach(() => {
    ({ sqlite: testSqlite, db: testDb } = createTestDb());
  });

  afterEach(() => {
    testSqlite.close();
  });

  it("returns 400 for non-integer page", async () => {
    const res = await callGet({ page: "abc" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 for page < 1", async () => {
    const res = await callGet({ page: "0" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 for negative page", async () => {
    const res = await callGet({ page: "-1" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 for zero limit", async () => {
    const res = await callGet({ limit: "0" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 for non-integer limit", async () => {
    const res = await callGet({ limit: "notanumber" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});
