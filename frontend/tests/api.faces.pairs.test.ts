/**
 * Tests for POST /api/faces/pairs
 *
 * Records a confirmed same/different decision between two clusters.
 * Used when user clicks "No, different person" during the wizard.
 *
 * Coverage:
 * - Returns 400 when clusterIdA is missing
 * - Returns 400 when clusterIdB is missing
 * - Returns 400 when isSame is missing
 * - Returns 404 when clusterIdA does not exist
 * - Returns 404 when clusterIdB does not exist
 * - Returns 400 when clusterIdA equals clusterIdB
 * - Inserts pair with isSame=false
 * - Inserts pair with isSame=true
 * - Normalises UUID order (smaller UUID in clusterIdA)
 * - Returns pair shape in response
 */

import { Database } from "bun:sqlite";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewFaceCluster } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import { faceClusterPairs, faceClusters } from "@/lib/db/schema";

// ─── Test DB ──────────────────────────────────────────────────────────────────

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let testDb: TestDb;
let testSqlite: Database;

function createTestDb(): { sqlite: Database; db: TestDb } {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  db.run(sql`PRAGMA foreign_keys=ON`);
  db.run(sql`PRAGMA journal_mode=WAL`);
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../drizzle") });
  return { sqlite, db };
}

vi.mock("@/lib/db/client", () => ({
  db: new Proxy(
    {},
    {
      get(_target, prop) {
        // biome-ignore lint/suspicious/noExplicitAny: proxy forwarding
        return (...args: unknown[]) => (testDb as any)[prop](...args);
      },
    }
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = Math.floor(Date.now() / 1000);

function makeCluster(overrides: Partial<NewFaceCluster> = {}): NewFaceCluster {
  return {
    id: crypto.randomUUID(),
    label: null,
    photoCount: 0,
    createdAt: NOW,
    ...overrides,
  };
}

// ─── Request helper ───────────────────────────────────────────────────────────

async function postPair(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/faces/pairs/route");
  const req = new Request("http://localhost/api/faces/pairs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as Parameters<typeof POST>[0];
  return POST(req);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  const { sqlite, db } = createTestDb();
  testSqlite = sqlite;
  testDb = db;
});

afterEach(() => {
  testSqlite.close();
});

describe("POST /api/faces/pairs", () => {
  it("returns 400 when clusterIdA is missing", async () => {
    const res = await postPair({ clusterIdB: "b", isSame: false });
    expect(res.status).toBe(400);
  });

  it("returns 400 when clusterIdB is missing", async () => {
    const res = await postPair({ clusterIdA: "a", isSame: false });
    expect(res.status).toBe(400);
  });

  it("returns 400 when isSame is missing", async () => {
    const res = await postPair({ clusterIdA: "a", clusterIdB: "b" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when clusterIdA does not exist", async () => {
    const b = makeCluster();
    await testDb.insert(faceClusters).values(b);

    const res = await postPair({ clusterIdA: "nonexistent", clusterIdB: b.id, isSame: false });
    expect(res.status).toBe(404);
  });

  it("returns 404 when clusterIdB does not exist", async () => {
    const a = makeCluster();
    await testDb.insert(faceClusters).values(a);

    const res = await postPair({ clusterIdA: a.id, clusterIdB: "nonexistent", isSame: false });
    expect(res.status).toBe(404);
  });

  it("returns 400 when clusterIdA equals clusterIdB", async () => {
    const cluster = makeCluster();
    await testDb.insert(faceClusters).values(cluster);

    const res = await postPair({ clusterIdA: cluster.id, clusterIdB: cluster.id, isSame: false });
    expect(res.status).toBe(400);
  });

  it("inserts pair with isSame=false", async () => {
    const a = makeCluster();
    const b = makeCluster();
    await testDb.insert(faceClusters).values([a, b]);

    const res = await postPair({ clusterIdA: a.id, clusterIdB: b.id, isSame: false });
    expect(res.status).toBe(201);

    const rows = await testDb.select().from(faceClusterPairs);
    expect(rows).toHaveLength(1);
    expect(rows[0].isSame).toBe(false);
  });

  it("inserts pair with isSame=true", async () => {
    const a = makeCluster();
    const b = makeCluster();
    await testDb.insert(faceClusters).values([a, b]);

    const res = await postPair({ clusterIdA: a.id, clusterIdB: b.id, isSame: true });
    expect(res.status).toBe(201);

    const rows = await testDb.select().from(faceClusterPairs);
    expect(rows[0].isSame).toBe(true);
  });

  it("normalises UUID order so smaller UUID is always clusterIdA", async () => {
    // Create two clusters with known UUIDs so we can control ordering
    const smaller = makeCluster({ id: "00000000-0000-0000-0000-000000000001" });
    const larger = makeCluster({ id: "ffffffff-ffff-ffff-ffff-ffffffffffff" });
    await testDb.insert(faceClusters).values([smaller, larger]);

    // Pass larger as clusterIdA intentionally
    const res = await postPair({
      clusterIdA: larger.id,
      clusterIdB: smaller.id,
      isSame: false,
    });
    expect(res.status).toBe(201);

    const rows = await testDb.select().from(faceClusterPairs);
    expect(rows[0].clusterIdA).toBe(smaller.id);
    expect(rows[0].clusterIdB).toBe(larger.id);
  });

  it("returns pair shape in response", async () => {
    const a = makeCluster();
    const b = makeCluster();
    await testDb.insert(faceClusters).values([a, b]);

    const res = await postPair({ clusterIdA: a.id, clusterIdB: b.id, isSame: false });
    expect(res.status).toBe(201);
    const data = await res.json();

    expect(data.pair.id).toBeDefined();
    expect(data.pair.isSame).toBe(false);
    expect(data.pair.createdAt).toBeDefined();
    // normalised IDs present
    const ids = [data.pair.clusterIdA, data.pair.clusterIdB];
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });
});
