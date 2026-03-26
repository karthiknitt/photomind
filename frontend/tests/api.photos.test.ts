/**
 * Gallery API tests — GET /api/photos
 *
 * TDD: Write tests first, confirm FAIL, then implement.
 *
 * Uses vi.mock to inject an in-memory test DB instead of the real singleton.
 * Each describe block gets a fresh in-memory DB in beforeEach.
 */

import { Database } from "bun:sqlite";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewPhoto } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import { photos } from "@/lib/db/schema";

// ─── Test DB factory ──────────────────────────────────────────────────────────

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let testDb: TestDb;
let testSqlite: Database;

function createTestDb(): { sqlite: Database; db: TestDb } {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  db.run(sql`PRAGMA foreign_keys=ON`);
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

// Unused at module level — kept for potential fixture use
// const _NOW = Math.floor(Date.now() / 1000);

function makePhoto(overrides: Partial<NewPhoto> = {}): NewPhoto {
  return {
    id: crypto.randomUUID(),
    sourceRemote: "onedrive_test",
    sourcePath: "/test/photo.jpg",
    status: "DONE",
    createdAt: Math.floor(Date.now() / 1000),
    updatedAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

// ─── Helper: call GET handler ─────────────────────────────────────────────────

async function callGet(params: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/photos/route");
  const url = new URL("http://localhost/api/photos");
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

  it("returns 200 with photos array and pagination", async () => {
    await testDb
      .insert(photos)
      .values([
        makePhoto({ id: crypto.randomUUID() }),
        makePhoto({ id: crypto.randomUUID() }),
        makePhoto({ id: crypto.randomUUID() }),
      ]);

    const res = await callGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.photos)).toBe(true);
    expect(body.photos).toHaveLength(3);
    expect(body.pagination.total).toBe(3);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(50);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("defaults to status=DONE", async () => {
    await testDb
      .insert(photos)
      .values([makePhoto({ status: "DONE" }), makePhoto({ status: "QUEUED" })]);

    const res = await callGet();
    const body = await res.json();
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0].status).toBe("DONE");
  });

  it("response does not include internal fields", async () => {
    await testDb.insert(photos).values([
      makePhoto({
        phash: "abc123",
        memeReason: "whatsapp",
        errorDetail: "some error",
        software: "WhatsApp",
        dateOriginalStr: "2024:01:01 10:00:00",
      }),
    ]);

    const res = await callGet();
    const body = await res.json();
    expect(body.photos).toHaveLength(1);

    const photo = body.photos[0];
    expect(photo).not.toHaveProperty("phash");
    expect(photo).not.toHaveProperty("sourcePath");
    expect(photo).not.toHaveProperty("sourceRemote");
    expect(photo).not.toHaveProperty("memeReason");
    expect(photo).not.toHaveProperty("errorDetail");
    expect(photo).not.toHaveProperty("software");
    expect(photo).not.toHaveProperty("dateOriginalStr");
    expect(photo).not.toHaveProperty("gpsLat");
    expect(photo).not.toHaveProperty("gpsLon");
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
    const photosToInsert = Array.from({ length: 5 }, () => makePhoto());
    await testDb.insert(photos).values(photosToInsert);

    const res = await callGet({ limit: "2", page: "1" });
    const body = await res.json();
    expect(body.photos).toHaveLength(2);
    expect(body.pagination.total).toBe(5);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(2);
  });

  it("last page hasMore=false", async () => {
    const photosToInsert = Array.from({ length: 5 }, () => makePhoto());
    await testDb.insert(photos).values(photosToInsert);

    const res = await callGet({ limit: "2", page: "3" });
    const body = await res.json();
    expect(body.photos).toHaveLength(1);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("clamps limit to 100", async () => {
    // Insert 110 DONE photos
    const photosToInsert = Array.from({ length: 110 }, () => makePhoto());
    await testDb.insert(photos).values(photosToInsert);

    const res = await callGet({ limit: "999" });
    const body = await res.json();
    expect(body.pagination.limit).toBe(100);
    expect(body.photos).toHaveLength(100);
  });

  it("returns empty array when page exceeds total", async () => {
    await testDb.insert(photos).values([makePhoto(), makePhoto()]);

    const res = await callGet({ page: "5" });
    const body = await res.json();
    expect(body.photos).toHaveLength(0);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.total).toBe(2);
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

  it("filters by status", async () => {
    await testDb
      .insert(photos)
      .values([makePhoto({ status: "DONE" }), makePhoto({ status: "QUEUED" })]);

    const res = await callGet({ status: "QUEUED" });
    const body = await res.json();
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0].status).toBe("QUEUED");
  });

  it("filters by date range", async () => {
    const base = 1700000000;
    await testDb.insert(photos).values([
      makePhoto({ dateTaken: base - 1000 }), // before range
      makePhoto({ dateTaken: base }), // at from boundary
      makePhoto({ dateTaken: base + 500 }), // inside range
      makePhoto({ dateTaken: base + 1001 }), // after range
    ]);

    const res = await callGet({
      from: String(base),
      to: String(base + 1000),
      status: "DONE",
    });
    const body = await res.json();
    // Should include base, base+500 but not base-1000 or base+1001
    expect(body.photos).toHaveLength(2);
    for (const photo of body.photos) {
      expect(photo.dateTaken).toBeGreaterThanOrEqual(base);
      expect(photo.dateTaken).toBeLessThanOrEqual(base + 1000);
    }
  });

  it("returns 400 for invalid status", async () => {
    const res = await callGet({ status: "INVALID" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});

// ─── TestSorting ──────────────────────────────────────────────────────────────

describe("TestSorting", () => {
  beforeEach(() => {
    ({ sqlite: testSqlite, db: testDb } = createTestDb());
  });

  afterEach(() => {
    testSqlite.close();
  });

  it("sorts by dateTaken desc", async () => {
    const base = 1700000000;
    await testDb
      .insert(photos)
      .values([
        makePhoto({ dateTaken: base + 100 }),
        makePhoto({ dateTaken: base + 300 }),
        makePhoto({ dateTaken: base + 200 }),
      ]);

    const res = await callGet();
    const body = await res.json();
    expect(body.photos).toHaveLength(3);
    const dateTakens = body.photos.map((p: { dateTaken: number }) => p.dateTaken);
    expect(dateTakens[0]).toBe(base + 300);
    expect(dateTakens[1]).toBe(base + 200);
    expect(dateTakens[2]).toBe(base + 100);
  });
});

// ─── TestErrors ───────────────────────────────────────────────────────────────

describe("TestErrors", () => {
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

  it("returns 400 for zero or negative limit", async () => {
    const res = await callGet({ limit: "0" });
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
});
