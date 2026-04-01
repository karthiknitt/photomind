/**
 * Tests for POST /api/faces/clusters/[id]/merge
 *
 * Merges a source cluster into a target cluster (the [id]).
 * All faces from source are moved to target; source is deleted.
 * A face_cluster_pairs record is written with isSame=true.
 *
 * Coverage:
 * - Returns 404 when target cluster does not exist
 * - Returns 404 when source cluster does not exist
 * - Returns 400 when sourceClusterId equals target id
 * - Moves all faces from source to target
 * - Deletes source cluster after merge
 * - Recalculates photoCount on target via COUNT(DISTINCT photo_id)
 * - Records positive pair in face_cluster_pairs
 * - Returns updated target cluster shape
 * - Returns 400 when sourceClusterId is missing from body
 */

import { Database } from "bun:sqlite";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewFace, NewFaceCluster, NewPhoto } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import { faceClusterPairs, faceClusters, faces, photos } from "@/lib/db/schema";

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

function makePhoto(overrides: Partial<NewPhoto> = {}): NewPhoto {
  return {
    id: crypto.randomUUID(),
    sourceRemote: "onedrive",
    sourcePath: "/Pictures/photo.jpg",
    status: "DONE",
    createdAt: NOW,
    updatedAt: NOW,
    isMeme: false,
    clipIndexed: false,
    faceCount: 0,
    width: 3000,
    height: 2000,
    ...overrides,
  };
}

function makeCluster(overrides: Partial<NewFaceCluster> = {}): NewFaceCluster {
  return {
    id: crypto.randomUUID(),
    label: null,
    photoCount: 1,
    createdAt: NOW,
    ...overrides,
  };
}

function makeFace(
  photoId: string,
  clusterId: string | null,
  overrides: Partial<NewFace> = {}
): NewFace {
  return {
    id: crypto.randomUUID(),
    photoId,
    clusterId,
    embeddingId: null,
    bboxX: 100,
    bboxY: 80,
    bboxW: 120,
    bboxH: 120,
    detScore: 0.9,
    ...overrides,
  };
}

// ─── Request helper ───────────────────────────────────────────────────────────

async function postMerge(targetId: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/faces/clusters/[id]/merge/route");
  const req = new Request(`http://localhost/api/faces/clusters/${targetId}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as Parameters<typeof POST>[0];
  return POST(req, { params: Promise.resolve({ id: targetId }) });
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

describe("POST /api/faces/clusters/[id]/merge", () => {
  it("returns 404 when target cluster does not exist", async () => {
    const res = await postMerge("nonexistent-target", { sourceClusterId: "some-id" });
    expect(res.status).toBe(404);
  });

  it("returns 404 when source cluster does not exist", async () => {
    const target = makeCluster();
    await testDb.insert(faceClusters).values(target);

    const res = await postMerge(target.id, { sourceClusterId: "nonexistent-source" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when sourceClusterId equals target id", async () => {
    const cluster = makeCluster();
    await testDb.insert(faceClusters).values(cluster);

    const res = await postMerge(cluster.id, { sourceClusterId: cluster.id });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/same/i);
  });

  it("returns 400 when sourceClusterId is missing", async () => {
    const cluster = makeCluster();
    await testDb.insert(faceClusters).values(cluster);

    const res = await postMerge(cluster.id, {});
    expect(res.status).toBe(400);
  });

  it("moves all faces from source to target", async () => {
    const photo1 = makePhoto();
    const photo2 = makePhoto();
    const target = makeCluster({ photoCount: 1 });
    const source = makeCluster({ photoCount: 1 });
    const faceTarget = makeFace(photo1.id, target.id);
    const faceSource = makeFace(photo2.id, source.id);

    await testDb.insert(photos).values([photo1, photo2]);
    await testDb.insert(faceClusters).values([target, source]);
    await testDb.insert(faces).values([faceTarget, faceSource]);

    const res = await postMerge(target.id, { sourceClusterId: source.id });
    expect(res.status).toBe(200);

    // faceSource must now belong to target
    const [moved] = await testDb.select().from(faces).where(eq(faces.id, faceSource.id));
    expect(moved.clusterId).toBe(target.id);
  });

  it("deletes source cluster after merge", async () => {
    const photo = makePhoto();
    const target = makeCluster();
    const source = makeCluster();
    const face = makeFace(photo.id, source.id);

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values([target, source]);
    await testDb.insert(faces).values(face);

    await postMerge(target.id, { sourceClusterId: source.id });

    const remaining = await testDb
      .select()
      .from(faceClusters)
      .where(eq(faceClusters.id, source.id));
    expect(remaining).toHaveLength(0);
  });

  it("recalculates photoCount on target using COUNT DISTINCT", async () => {
    const photo1 = makePhoto();
    const photo2 = makePhoto();
    const target = makeCluster({ photoCount: 1 });
    const source = makeCluster({ photoCount: 1 });
    const faceA = makeFace(photo1.id, target.id);
    const faceB = makeFace(photo2.id, source.id);
    const faceC = makeFace(photo2.id, source.id); // same photo as faceB

    await testDb.insert(photos).values([photo1, photo2]);
    await testDb.insert(faceClusters).values([target, source]);
    await testDb.insert(faces).values([faceA, faceB, faceC]);

    const res = await postMerge(target.id, { sourceClusterId: source.id });
    expect(res.status).toBe(200);
    const data = await res.json();

    // photo1 + photo2 = 2 distinct photos
    expect(data.cluster.photoCount).toBe(2);
  });

  it("records a positive pair in face_cluster_pairs", async () => {
    const photo = makePhoto();
    const target = makeCluster();
    const source = makeCluster();
    const face = makeFace(photo.id, source.id);

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values([target, source]);
    await testDb.insert(faces).values(face);

    await postMerge(target.id, { sourceClusterId: source.id });

    const pairs = await testDb.select().from(faceClusterPairs);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].isSame).toBe(true);
    // normalised order: smaller UUID in clusterIdA
    const ids = [pairs[0].clusterIdA, pairs[0].clusterIdB].sort();
    expect(ids).toContain(target.id);
    expect(ids).toContain(source.id);
  });

  it("returns updated target cluster in response", async () => {
    const photo = makePhoto();
    const target = makeCluster({ label: "Karthik", photoCount: 0 });
    const source = makeCluster();
    const face = makeFace(photo.id, source.id);

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values([target, source]);
    await testDb.insert(faces).values(face);

    const res = await postMerge(target.id, { sourceClusterId: source.id });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cluster.id).toBe(target.id);
    expect(data.cluster.label).toBe("Karthik");
    expect(data.cluster.photoCount).toBe(1);
  });
});
