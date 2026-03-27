/**
 * Tests for PATCH /api/faces/clusters/[id]
 *
 * Strategy:
 * - Use vi.mock to inject an in-memory test DB via Drizzle ORM.
 * - Each test gets a fresh DB via beforeEach.
 * - Run migrations so schema matches real DB.
 *
 * Coverage:
 * - Returns 200 with updated cluster on success
 * - Returns 404 when cluster not found
 * - Returns 400 when label is missing from body
 * - Returns 400 when label exceeds 100 characters
 * - Returns 400 when body is not valid JSON
 * - Returns 400 when label is not a string
 * - Clears label when empty string is provided
 */

import { Database } from "bun:sqlite";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewFaceCluster } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import { faceClusters } from "@/lib/db/schema";

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
    photoCount: 5,
    createdAt: NOW,
    ...overrides,
  };
}

// ─── Route helper ─────────────────────────────────────────────────────────────

async function patchRequest(id: string, body: unknown): Promise<Response> {
  const { PATCH } = await import("@/app/api/faces/clusters/[id]/route");
  const req = new Request(`http://localhost/api/faces/clusters/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as Parameters<typeof PATCH>[0];
  const params = Promise.resolve({ id });
  return PATCH(req, { params });
}

async function patchRequestRaw(id: string, rawBody: string): Promise<Response> {
  const { PATCH } = await import("@/app/api/faces/clusters/[id]/route");
  const req = new Request(`http://localhost/api/faces/clusters/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: rawBody,
  }) as Parameters<typeof PATCH>[0];
  const params = Promise.resolve({ id });
  return PATCH(req, { params });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PATCH /api/faces/clusters/[id]", () => {
  beforeEach(() => {
    const { sqlite, db } = createTestDb();
    testSqlite = sqlite;
    testDb = db;
  });

  afterEach(() => {
    testSqlite.close();
  });

  it("returns 200 with updated cluster on success", async () => {
    const cluster = makeCluster({ id: "cluster-1", label: null });
    await testDb.insert(faceClusters).values(cluster);

    const res = await patchRequest("cluster-1", { label: "Karthik" });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.cluster).toBeDefined();
    expect(data.cluster.id).toBe("cluster-1");
    expect(data.cluster.label).toBe("Karthik");
    expect(data.cluster.photoCount).toBe(5);
  });

  it("returns 404 when cluster not found", async () => {
    const res = await patchRequest("non-existent-id", { label: "Test" });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data).toHaveProperty("error");
  });

  it("returns 400 when body is not valid JSON", async () => {
    const cluster = makeCluster({ id: "cluster-1" });
    await testDb.insert(faceClusters).values(cluster);

    const res = await patchRequestRaw("cluster-1", "not-valid-json{{{");
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toHaveProperty("error");
  });

  it("returns 400 when label is not a string", async () => {
    const cluster = makeCluster({ id: "cluster-1" });
    await testDb.insert(faceClusters).values(cluster);

    const res = await patchRequest("cluster-1", { label: 123 });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toHaveProperty("error");
  });

  it("returns 400 when label exceeds 100 characters", async () => {
    const cluster = makeCluster({ id: "cluster-1" });
    await testDb.insert(faceClusters).values(cluster);

    const tooLong = "a".repeat(101);
    const res = await patchRequest("cluster-1", { label: tooLong });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toHaveProperty("error");
  });

  it("returns 400 when label field is missing", async () => {
    const cluster = makeCluster({ id: "cluster-1" });
    await testDb.insert(faceClusters).values(cluster);

    const res = await patchRequest("cluster-1", { notLabel: "oops" });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toHaveProperty("error");
  });

  it("clears label when empty string is provided", async () => {
    const cluster = makeCluster({ id: "cluster-1", label: "OldName" });
    await testDb.insert(faceClusters).values(cluster);

    const res = await patchRequest("cluster-1", { label: "" });
    expect(res.status).toBe(200);

    const data = await res.json();
    // empty string clears to null or empty string
    expect(data.cluster.label === null || data.cluster.label === "").toBe(true);
  });

  it("persists label to the database", async () => {
    const cluster = makeCluster({ id: "cluster-1", label: null });
    await testDb.insert(faceClusters).values(cluster);

    await patchRequest("cluster-1", { label: "Priya" });

    const [updated] = await testDb.select().from(faceClusters).where(sql`id = 'cluster-1'`);
    expect(updated.label).toBe("Priya");
  });
});
