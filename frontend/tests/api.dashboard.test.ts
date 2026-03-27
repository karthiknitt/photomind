/**
 * Tests for GET /api/dashboard
 *
 * Strategy:
 * - Uses vi.mock to inject an in-memory test DB (same pattern as api.photos.test.ts)
 * - Each describe block gets a fresh in-memory DB in beforeEach
 *
 * Coverage:
 * - Returns 200 with correct shape (stats + recentActivity)
 * - Stats object has all required fields
 * - done + queued + processing + error <= total
 * - recentActivity is an array (possibly empty)
 * - Handles empty database (all zeros)
 * - Stats reflect actual DB data correctly
 * - recentActivity is ordered by timestamp DESC
 * - recentActivity is capped at 20 entries
 */

import { Database } from "bun:sqlite";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewPhoto } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import { actionLog, faceClusters, faces, photos } from "@/lib/db/schema";

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

const NOW = Math.floor(Date.now() / 1000);

function makePhoto(overrides: Partial<NewPhoto> = {}): NewPhoto {
  return {
    id: crypto.randomUUID(),
    sourceRemote: "onedrive_test",
    sourcePath: "/test/photo.jpg",
    status: "DONE",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ─── Helper: call GET handler ─────────────────────────────────────────────────

async function callGet() {
  const { GET } = await import("@/app/api/dashboard/route");
  const req = new Request("http://localhost/api/dashboard");
  return GET(req as Parameters<typeof GET>[0]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/dashboard", () => {
  beforeEach(() => {
    const result = createTestDb();
    testDb = result.db;
    testSqlite = result.sqlite;
  });

  afterEach(() => {
    testSqlite.close();
  });

  it("returns 200 with correct shape (stats + recentActivity)", async () => {
    const res = await callGet();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty("stats");
    expect(data).toHaveProperty("recentActivity");
  });

  it("stats object has all required fields", async () => {
    const res = await callGet();
    const data = await res.json();
    const { stats } = data;

    expect(stats).toHaveProperty("total");
    expect(stats).toHaveProperty("done");
    expect(stats).toHaveProperty("queued");
    expect(stats).toHaveProperty("processing");
    expect(stats).toHaveProperty("error");
    expect(stats).toHaveProperty("memes");
    expect(stats).toHaveProperty("faces");
    expect(stats).toHaveProperty("faceClusters");
    expect(stats).toHaveProperty("clipIndexed");
    expect(stats).toHaveProperty("totalSizeBytes");
  });

  it("handles empty database — all stats are zero or null", async () => {
    const res = await callGet();
    expect(res.status).toBe(200);

    const data = await res.json();
    const { stats } = data;

    expect(stats.total).toBe(0);
    expect(stats.done).toBe(0);
    expect(stats.queued).toBe(0);
    expect(stats.processing).toBe(0);
    expect(stats.error).toBe(0);
    expect(stats.memes).toBe(0);
    expect(stats.faces).toBe(0);
    expect(stats.faceClusters).toBe(0);
    expect(stats.clipIndexed).toBe(0);
    expect(stats.totalSizeBytes ?? 0).toBe(0);
  });

  it("recentActivity is an array (possibly empty)", async () => {
    const res = await callGet();
    const data = await res.json();
    expect(Array.isArray(data.recentActivity)).toBe(true);
  });

  it("done + queued + processing + error <= total", async () => {
    // Insert a mix of statuses
    await testDb
      .insert(photos)
      .values([
        makePhoto({ status: "DONE" }),
        makePhoto({ status: "DONE" }),
        makePhoto({ status: "QUEUED" }),
        makePhoto({ status: "PROCESSING" }),
        makePhoto({ status: "ERROR" }),
      ]);

    const res = await callGet();
    const data = await res.json();
    const { stats } = data;

    const summedStatuses = stats.done + stats.queued + stats.processing + stats.error;
    expect(summedStatuses).toBeLessThanOrEqual(stats.total);
    // In a clean DB without overlaps they should be equal
    expect(summedStatuses).toBe(stats.total);
  });

  it("stats reflect actual DB data correctly", async () => {
    const photoId1 = crypto.randomUUID();
    const photoId2 = crypto.randomUUID();
    const clusterId = crypto.randomUUID();

    await testDb.insert(photos).values([
      makePhoto({
        id: photoId1,
        status: "DONE",
        isMeme: false,
        clipIndexed: true,
        fileSize: 1000,
      }),
      makePhoto({
        id: photoId2,
        status: "DONE",
        isMeme: true,
        clipIndexed: false,
        fileSize: 2000,
      }),
      makePhoto({ status: "QUEUED", fileSize: 500 }),
      makePhoto({ status: "ERROR" }),
    ]);

    await testDb
      .insert(faceClusters)
      .values([{ id: clusterId, label: "Family", photoCount: 2, createdAt: NOW }]);

    await testDb.insert(faces).values([
      { id: crypto.randomUUID(), photoId: photoId1, clusterId, detScore: 0.99 },
      { id: crypto.randomUUID(), photoId: photoId1, clusterId, detScore: 0.95 },
    ]);

    const res = await callGet();
    const data = await res.json();
    const { stats } = data;

    expect(stats.total).toBe(4);
    expect(stats.done).toBe(2);
    expect(stats.queued).toBe(1);
    expect(stats.processing).toBe(0);
    expect(stats.error).toBe(1);
    expect(stats.memes).toBe(1);
    expect(stats.clipIndexed).toBe(1);
    expect(stats.totalSizeBytes).toBe(3500); // 1000 + 2000 + 500 + null(=0)
    expect(stats.faces).toBe(2);
    expect(stats.faceClusters).toBe(1);
  });

  it("recentActivity entries have expected fields", async () => {
    const photoId = crypto.randomUUID();
    await testDb.insert(photos).values([makePhoto({ id: photoId })]);
    await testDb.insert(actionLog).values([
      {
        id: crypto.randomUUID(),
        photoId,
        action: "COPIED",
        detail: "copied from source",
        timestamp: NOW,
      },
    ]);

    const res = await callGet();
    const data = await res.json();
    const entry = data.recentActivity[0];

    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("photoId");
    expect(entry).toHaveProperty("action");
    expect(entry).toHaveProperty("detail");
    expect(entry).toHaveProperty("timestamp");
    expect(entry.action).toBe("COPIED");
    expect(entry.photoId).toBe(photoId);
  });

  it("recentActivity is ordered by timestamp DESC", async () => {
    const photoId = crypto.randomUUID();
    await testDb.insert(photos).values([makePhoto({ id: photoId })]);

    const timestamps = [NOW - 300, NOW - 100, NOW - 200];
    for (const ts of timestamps) {
      await testDb.insert(actionLog).values([
        {
          id: crypto.randomUUID(),
          photoId,
          action: "INDEXED",
          detail: null,
          timestamp: ts,
        },
      ]);
    }

    const res = await callGet();
    const data = await res.json();
    const activity: { timestamp: number }[] = data.recentActivity;

    // Should be sorted newest first
    for (let i = 0; i < activity.length - 1; i++) {
      expect(activity[i].timestamp).toBeGreaterThanOrEqual(activity[i + 1].timestamp);
    }
  });

  it("recentActivity is capped at 20 entries", async () => {
    const photoId = crypto.randomUUID();
    await testDb.insert(photos).values([makePhoto({ id: photoId })]);

    // Insert 25 action log entries
    for (let i = 0; i < 25; i++) {
      await testDb.insert(actionLog).values([
        {
          id: crypto.randomUUID(),
          photoId,
          action: "INDEXED",
          detail: `entry ${i}`,
          timestamp: NOW + i,
        },
      ]);
    }

    const res = await callGet();
    const data = await res.json();
    expect(data.recentActivity.length).toBe(20);
  });
});
