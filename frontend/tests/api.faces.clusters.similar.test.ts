/**
 * Tests for GET /api/faces/clusters/[id]/similar
 *
 * Returns unlabeled clusters similar to the given cluster, computed via
 * centroid similarity through the Python bridge.
 *
 * Coverage:
 * - Returns 404 when cluster does not exist
 * - Returns empty array when cluster has no embedding IDs
 * - Returns { clusters: [], bridgeUnavailable: true } when bridge is unreachable
 * - Filters out labeled clusters from suggestions
 * - Filters out clusters already in face_cluster_pairs with this cluster
 * - Returns top-5 clusters with correct shape (id, avgSimilarity, photoCount, representativeFaceId)
 * - avgSimilarity = round((1 - avgDistance) * 100)
 * - Groups multiple faces from same cluster, averages distances
 */

import { Database } from "bun:sqlite";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewFace, NewFaceCluster, NewFaceClusterPair, NewPhoto } from "@/lib/db/schema";
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

// ─── Mock fetch (bridge HTTP calls) ──────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function bridgeOk(results: { id: string; distance: number }[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ results }),
  });
}

function bridgeDown() {
  mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
}

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
  embeddingId: string | null = null,
  overrides: Partial<NewFace> = {}
): NewFace {
  return {
    id: crypto.randomUUID(),
    photoId,
    clusterId,
    embeddingId,
    bboxX: 100,
    bboxY: 80,
    bboxW: 120,
    bboxH: 120,
    detScore: 0.9,
    ...overrides,
  };
}

function makePair(
  clusterIdA: string,
  clusterIdB: string,
  isSame: boolean
): NewFaceClusterPair {
  const [a, b] = [clusterIdA, clusterIdB].sort();
  return {
    id: crypto.randomUUID(),
    clusterIdA: a,
    clusterIdB: b,
    isSame,
    createdAt: NOW,
  };
}

// ─── Request helper ───────────────────────────────────────────────────────────

async function getSimilar(clusterId: string) {
  const { GET } = await import("@/app/api/faces/clusters/[id]/similar/route");
  const req = new Request(
    `http://localhost/api/faces/clusters/${clusterId}/similar`
  ) as Parameters<typeof GET>[0];
  return GET(req, { params: Promise.resolve({ id: clusterId }) });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  const { sqlite, db } = createTestDb();
  testSqlite = sqlite;
  testDb = db;
  mockFetch.mockReset();
});

afterEach(() => {
  testSqlite.close();
});

describe("GET /api/faces/clusters/[id]/similar", () => {
  it("returns 404 when cluster does not exist", async () => {
    const res = await getSimilar("nonexistent");
    expect(res.status).toBe(404);
  });

  it("returns empty clusters when cluster has no embedding IDs", async () => {
    const cluster = makeCluster();
    const photo = makePhoto();
    const face = makeFace(photo.id, cluster.id, null); // no embeddingId

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values(face);

    const res = await getSimilar(cluster.id);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.clusters).toEqual([]);
  });

  it("returns bridgeUnavailable when bridge is unreachable", async () => {
    const cluster = makeCluster();
    const photo = makePhoto();
    const face = makeFace(photo.id, cluster.id, "emb-1");

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values(face);

    bridgeDown();

    const res = await getSimilar(cluster.id);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.clusters).toEqual([]);
    expect(data.bridgeUnavailable).toBe(true);
  });

  it("filters out labeled clusters from suggestions", async () => {
    const sourceCluster = makeCluster({ label: "Karthik" });
    const labeledTarget = makeCluster({ label: "Amma" }); // should be excluded
    const unlabeledTarget = makeCluster({ label: null });

    const photo1 = makePhoto();
    const photo2 = makePhoto();
    const photo3 = makePhoto();

    const srcFace = makeFace(photo1.id, sourceCluster.id, "emb-src");
    const labeledFace = makeFace(photo2.id, labeledTarget.id, "emb-lab");
    const unlabeledFace = makeFace(photo3.id, unlabeledTarget.id, "emb-unl");

    await testDb.insert(photos).values([photo1, photo2, photo3]);
    await testDb.insert(faceClusters).values([sourceCluster, labeledTarget, unlabeledTarget]);
    await testDb.insert(faces).values([srcFace, labeledFace, unlabeledFace]);

    // bridge returns both labeled and unlabeled face IDs
    bridgeOk([
      { id: labeledFace.id, distance: 0.2 },
      { id: unlabeledFace.id, distance: 0.3 },
    ]);

    const res = await getSimilar(sourceCluster.id);
    expect(res.status).toBe(200);
    const data = await res.json();

    const ids = data.clusters.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(labeledTarget.id);
    expect(ids).toContain(unlabeledTarget.id);
  });

  it("filters out clusters already in face_cluster_pairs", async () => {
    const source = makeCluster();
    const paired = makeCluster(); // already has a negative pair with source
    const fresh = makeCluster();

    const photo1 = makePhoto();
    const photo2 = makePhoto();
    const photo3 = makePhoto();
    const srcFace = makeFace(photo1.id, source.id, "emb-src");
    const pairedFace = makeFace(photo2.id, paired.id, "emb-pair");
    const freshFace = makeFace(photo3.id, fresh.id, "emb-fresh");

    await testDb.insert(photos).values([photo1, photo2, photo3]);
    await testDb.insert(faceClusters).values([source, paired, fresh]);
    await testDb.insert(faces).values([srcFace, pairedFace, freshFace]);
    await testDb.insert(faceClusterPairs).values(makePair(source.id, paired.id, false));

    bridgeOk([
      { id: pairedFace.id, distance: 0.2 },
      { id: freshFace.id, distance: 0.3 },
    ]);

    const res = await getSimilar(source.id);
    const data = await res.json();

    const ids = data.clusters.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(paired.id);
    expect(ids).toContain(fresh.id);
  });

  it("returns correct cluster shape with avgSimilarity and representativeFaceId", async () => {
    const source = makeCluster();
    const candidate = makeCluster({ photoCount: 3 });
    const photo1 = makePhoto();
    const photo2 = makePhoto();
    const srcFace = makeFace(photo1.id, source.id, "emb-src");
    const candFace = makeFace(photo2.id, candidate.id, "emb-cand");

    await testDb.insert(photos).values([photo1, photo2]);
    await testDb.insert(faceClusters).values([source, candidate]);
    await testDb.insert(faces).values([srcFace, candFace]);

    // distance 0.3 → avgSimilarity = round((1 - 0.3) * 100) = 70
    bridgeOk([{ id: candFace.id, distance: 0.3 }]);

    const res = await getSimilar(source.id);
    const data = await res.json();
    expect(data.clusters).toHaveLength(1);

    const c = data.clusters[0];
    expect(c.id).toBe(candidate.id);
    expect(c.avgSimilarity).toBe(70);
    expect(c.photoCount).toBe(3);
    expect(c.representativeFaceId).toBe(candFace.id);
  });

  it("averages distances when multiple faces from same cluster are returned", async () => {
    const source = makeCluster();
    const candidate = makeCluster();
    const photo1 = makePhoto();
    const photo2 = makePhoto();
    const photo3 = makePhoto();
    const srcFace = makeFace(photo1.id, source.id, "emb-src");
    const candFace1 = makeFace(photo2.id, candidate.id, "emb-c1");
    const candFace2 = makeFace(photo3.id, candidate.id, "emb-c2");

    await testDb.insert(photos).values([photo1, photo2, photo3]);
    await testDb.insert(faceClusters).values([source, candidate]);
    await testDb.insert(faces).values([srcFace, candFace1, candFace2]);

    // avg distance = (0.2 + 0.4) / 2 = 0.3 → avgSimilarity = 70
    bridgeOk([
      { id: candFace1.id, distance: 0.2 },
      { id: candFace2.id, distance: 0.4 },
    ]);

    const res = await getSimilar(source.id);
    const data = await res.json();
    expect(data.clusters[0].avgSimilarity).toBe(70);
  });

  it("does not return the source cluster itself as a suggestion", async () => {
    const source = makeCluster();
    const photo = makePhoto();
    const face = makeFace(photo.id, source.id, "emb-src");

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values(source);
    await testDb.insert(faces).values(face);

    // bridge returns the same face as similar
    bridgeOk([{ id: face.id, distance: 0.05 }]);

    const res = await getSimilar(source.id);
    const data = await res.json();
    const ids = data.clusters.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(source.id);
  });
});
