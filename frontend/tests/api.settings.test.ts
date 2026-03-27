/**
 * Tests for GET /api/settings
 *
 * Strategy:
 * - Mock @/lib/db/client using vi.mock with a Proxy that forwards to testDb.
 * - Run Drizzle migrations on an in-memory SQLite DB so the sources table exists.
 * - Env vars (DATABASE_PATH, THUMBNAILS_PATH, CLIP_BRIDGE_URL) are set per-test.
 *
 * Coverage:
 * - Returns 200 with system + sources shape
 * - system fields reflect env vars
 * - sources is an array (possibly empty)
 * - sources ordered by displayName
 * - returns correct source fields
 */

import { Database } from "bun:sqlite";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewSource } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import { sources } from "@/lib/db/schema";

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
        return (...args: unknown[]) => {
          // biome-ignore lint/suspicious/noExplicitAny: proxy forwarding
          return (testDb as any)[prop](...args);
        };
      },
    }
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSource(overrides: Partial<NewSource> = {}): NewSource {
  return {
    id: crypto.randomUUID(),
    remoteName: "onedrive_test",
    displayName: "Test OneDrive",
    scanPath: "/Pictures",
    lastScannedAt: null,
    enabled: true,
    ...overrides,
  };
}

// ─── Helper: call GET handler ─────────────────────────────────────────────────

async function callGet(): Promise<Response> {
  const { GET } = await import("@/app/api/settings/route");
  const req = new Request("http://localhost/api/settings") as Parameters<typeof GET>[0];
  return GET(req);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/settings", () => {
  beforeEach(() => {
    const { sqlite, db } = createTestDb();
    testSqlite = sqlite;
    testDb = db;

    process.env.DATABASE_PATH = "/test/photomind.db";
    process.env.THUMBNAILS_PATH = "/test/thumbnails";
    process.env.CLIP_BRIDGE_URL = "http://localhost:9999";
  });

  afterEach(() => {
    testSqlite.close();
    delete process.env.DATABASE_PATH;
    delete process.env.THUMBNAILS_PATH;
    delete process.env.CLIP_BRIDGE_URL;
  });

  it("returns 200 with system and sources keys", async () => {
    const res = await callGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("system");
    expect(data).toHaveProperty("sources");
  });

  it("system fields reflect env vars", async () => {
    const res = await callGet();
    const data = await res.json();
    expect(data.system.databasePath).toBe("/test/photomind.db");
    expect(data.system.thumbnailsPath).toBe("/test/thumbnails");
    expect(data.system.clipBridgeUrl).toBe("http://localhost:9999");
  });

  it("uses default values when env vars are absent", async () => {
    delete process.env.DATABASE_PATH;
    delete process.env.THUMBNAILS_PATH;
    delete process.env.CLIP_BRIDGE_URL;

    const res = await callGet();
    const data = await res.json();
    expect(data.system.databasePath).toBe("~/photomind/photomind.db");
    expect(data.system.thumbnailsPath).toBe("~/photomind/thumbnails");
    expect(data.system.clipBridgeUrl).toBe("http://localhost:8765");
  });

  it("sources is an array (empty when no sources in DB)", async () => {
    const res = await callGet();
    const data = await res.json();
    expect(Array.isArray(data.sources)).toBe(true);
    expect(data.sources).toHaveLength(0);
  });

  it("returns sources with correct shape when sources exist", async () => {
    const source = makeSource({
      id: "src-001",
      remoteName: "onedrive_karthik",
      displayName: "Karthik OneDrive",
      scanPath: "/Pictures",
      lastScannedAt: 1234567890,
      enabled: true,
    });
    await testDb.insert(sources).values(source);

    const res = await callGet();
    const data = await res.json();
    expect(data.sources).toHaveLength(1);
    const s = data.sources[0];
    expect(s.id).toBe("src-001");
    expect(s.remoteName).toBe("onedrive_karthik");
    expect(s.displayName).toBe("Karthik OneDrive");
    expect(s.scanPath).toBe("/Pictures");
    expect(s.lastScannedAt).toBe(1234567890);
    expect(s.enabled).toBe(true);
  });

  it("returns sources ordered by displayName", async () => {
    await testDb
      .insert(sources)
      .values([
        makeSource({ id: "src-z", displayName: "Zebra Drive" }),
        makeSource({ id: "src-a", displayName: "Alpha Drive" }),
        makeSource({ id: "src-m", displayName: "Middle Drive" }),
      ]);

    const res = await callGet();
    const data = await res.json();
    expect(data.sources).toHaveLength(3);
    expect(data.sources[0].displayName).toBe("Alpha Drive");
    expect(data.sources[1].displayName).toBe("Middle Drive");
    expect(data.sources[2].displayName).toBe("Zebra Drive");
  });
});
