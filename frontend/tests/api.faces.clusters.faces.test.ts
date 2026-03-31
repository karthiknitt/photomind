/**
 * Tests for GET /api/faces/clusters/[id]/faces
 *
 * Returns individual faces (with bbox + photo dimensions) for a cluster,
 * used to render face-crop thumbnails in the split-cluster UI.
 *
 * Coverage:
 * - Returns 404 when cluster does not exist
 * - Returns empty array when cluster has no faces
 * - Returns faces with correct shape (id, photoId, bbox, detScore, photoWidth, photoHeight)
 * - Only returns faces belonging to the requested cluster
 * - Orders by detScore descending (most confident faces first)
 * - Returns total count
 */

import { Database } from "bun:sqlite";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewFace, NewFaceCluster, NewPhoto } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import { faceClusters, faces, photos } from "@/lib/db/schema";

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

async function getRequest(clusterId: string) {
  const { GET } = await import("@/app/api/faces/clusters/[id]/faces/route");
  const req = new Request(`http://localhost/api/faces/clusters/${clusterId}/faces`) as Parameters<
    typeof GET
  >[0];
  return GET(req, { params: Promise.resolve({ id: clusterId }) });
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

describe("GET /api/faces/clusters/[id]/faces", () => {
  it("returns 404 when cluster does not exist", async () => {
    const res = await getRequest("nonexistent-id");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns empty faces array when cluster has no faces", async () => {
    const cluster = makeCluster({ photoCount: 0 });
    await testDb.insert(faceClusters).values(cluster);

    const res = await getRequest(cluster.id);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.faces).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("returns faces with correct shape", async () => {
    const photo = makePhoto({ width: 4000, height: 3000 });
    const cluster = makeCluster({ photoCount: 1 });
    const face = makeFace(photo.id, cluster.id, {
      bboxX: 200,
      bboxY: 150,
      bboxW: 180,
      bboxH: 200,
      detScore: 0.97,
    });

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values(face);

    const res = await getRequest(cluster.id);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.faces).toHaveLength(1);
    const f = data.faces[0];
    expect(f.id).toBe(face.id);
    expect(f.photoId).toBe(photo.id);
    expect(f.bboxX).toBe(200);
    expect(f.bboxY).toBe(150);
    expect(f.bboxW).toBe(180);
    expect(f.bboxH).toBe(200);
    expect(f.detScore).toBeCloseTo(0.97);
    expect(f.photoWidth).toBe(4000);
    expect(f.photoHeight).toBe(3000);
    expect(data.total).toBe(1);
  });

  it("only returns faces belonging to the requested cluster", async () => {
    const photo = makePhoto();
    const clusterA = makeCluster({ photoCount: 2 });
    const clusterB = makeCluster({ photoCount: 1 });
    const faceA1 = makeFace(photo.id, clusterA.id);
    const faceA2 = makeFace(photo.id, clusterA.id);
    const faceB = makeFace(photo.id, clusterB.id);

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values([clusterA, clusterB]);
    await testDb.insert(faces).values([faceA1, faceA2, faceB]);

    const res = await getRequest(clusterA.id);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.faces).toHaveLength(2);
    expect(data.faces.map((f: { id: string }) => f.id)).toEqual(
      expect.arrayContaining([faceA1.id, faceA2.id])
    );
  });

  it("orders faces by detScore descending", async () => {
    const photo = makePhoto();
    const cluster = makeCluster({ photoCount: 1 });
    const faceHigh = makeFace(photo.id, cluster.id, { detScore: 0.99 });
    const faceMid = makeFace(photo.id, cluster.id, { detScore: 0.75 });
    const faceLow = makeFace(photo.id, cluster.id, { detScore: 0.55 });

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values([faceMid, faceLow, faceHigh]);

    const res = await getRequest(cluster.id);
    const data = await res.json();
    expect(data.faces[0].id).toBe(faceHigh.id);
    expect(data.faces[1].id).toBe(faceMid.id);
    expect(data.faces[2].id).toBe(faceLow.id);
  });

  it("does not include null-cluster (unclustered) faces", async () => {
    const photo = makePhoto();
    const cluster = makeCluster({ photoCount: 1 });
    const clusterFace = makeFace(photo.id, cluster.id);
    const noiseFace = makeFace(photo.id, null);

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values([clusterFace, noiseFace]);

    const res = await getRequest(cluster.id);
    const data = await res.json();
    expect(data.faces).toHaveLength(1);
    expect(data.faces[0].id).toBe(clusterFace.id);
  });
});
