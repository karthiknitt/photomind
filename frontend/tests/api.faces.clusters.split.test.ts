/**
 * Tests for POST /api/faces/clusters/[id]/split
 *
 * Moves a subset of faces from a source cluster into a new cluster.
 * Used when a cluster contains multiple people and the user selects
 * faces belonging to one person to split out.
 *
 * Coverage:
 * - Returns 404 when source cluster does not exist
 * - Returns 400 when faceIds is empty
 * - Returns 400 when faceIds is not an array
 * - Returns 400 when a faceId does not belong to the source cluster
 * - Creates a new cluster and moves selected faces into it
 * - Recalculates photoCount on both source and new cluster
 * - Accepts optional label for the new cluster
 * - Returns new cluster shape in response
 * - Source cluster is NOT deleted even if all faces are moved
 */

import { Database } from "bun:sqlite";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
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

async function postSplit(clusterId: string, body: { faceIds: string[]; label?: string }) {
  const { POST } = await import("@/app/api/faces/clusters/[id]/split/route");
  const req = new Request(`http://localhost/api/faces/clusters/${clusterId}/split`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as Parameters<typeof POST>[0];
  return POST(req, { params: Promise.resolve({ id: clusterId }) });
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

describe("POST /api/faces/clusters/[id]/split", () => {
  it("returns 404 when source cluster does not exist", async () => {
    const res = await postSplit("nonexistent-id", { faceIds: ["x"] });
    expect(res.status).toBe(404);
  });

  it("returns 400 when faceIds is empty", async () => {
    const cluster = makeCluster();
    await testDb.insert(faceClusters).values(cluster);

    const res = await postSplit(cluster.id, { faceIds: [] });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns 400 when faceIds is not an array", async () => {
    const cluster = makeCluster();
    await testDb.insert(faceClusters).values(cluster);

    const { POST } = await import("@/app/api/faces/clusters/[id]/split/route");
    const req = new Request(`http://localhost/api/faces/clusters/${cluster.id}/split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: "not-an-array" }),
    }) as Parameters<typeof POST>[0];
    const res = await POST(req, { params: Promise.resolve({ id: cluster.id }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when a faceId does not belong to source cluster", async () => {
    const photo = makePhoto();
    const clusterA = makeCluster();
    const clusterB = makeCluster();
    const faceInB = makeFace(photo.id, clusterB.id);

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values([clusterA, clusterB]);
    await testDb.insert(faces).values(faceInB);

    const res = await postSplit(clusterA.id, { faceIds: [faceInB.id] });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/not.*belong/i);
  });

  it("creates a new cluster and moves selected faces", async () => {
    const photo1 = makePhoto();
    const photo2 = makePhoto();
    const cluster = makeCluster({ photoCount: 2 });
    const face1 = makeFace(photo1.id, cluster.id);
    const face2 = makeFace(photo2.id, cluster.id);

    await testDb.insert(photos).values([photo1, photo2]);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values([face1, face2]);

    const res = await postSplit(cluster.id, { faceIds: [face1.id] });
    expect(res.status).toBe(201);

    // face1 should now point to the new cluster
    const [moved] = await testDb.select().from(faces).where(eq(faces.id, face1.id));
    expect(moved.clusterId).not.toBe(cluster.id);

    // face2 should still be in original cluster
    const [stayed] = await testDb.select().from(faces).where(eq(faces.id, face2.id));
    expect(stayed.clusterId).toBe(cluster.id);
  });

  it("recalculates photoCount on both clusters", async () => {
    const photo1 = makePhoto();
    const photo2 = makePhoto();
    const cluster = makeCluster({ photoCount: 2 });
    const face1 = makeFace(photo1.id, cluster.id);
    const face2 = makeFace(photo2.id, cluster.id);

    await testDb.insert(photos).values([photo1, photo2]);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values([face1, face2]);

    const res = await postSplit(cluster.id, { faceIds: [face1.id] });
    expect(res.status).toBe(201);
    const data = await res.json();

    // new cluster should have photoCount = 1
    expect(data.newCluster.photoCount).toBe(1);

    // source cluster photoCount should now be 1
    const [src] = await testDb.select().from(faceClusters).where(eq(faceClusters.id, cluster.id));
    expect(src.photoCount).toBe(1);
  });

  it("accepts optional label for new cluster", async () => {
    const photo = makePhoto();
    const cluster = makeCluster({ photoCount: 1 });
    const face = makeFace(photo.id, cluster.id);

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values(face);

    const res = await postSplit(cluster.id, {
      faceIds: [face.id],
      label: "Amma",
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.newCluster.label).toBe("Amma");
  });

  it("returns new cluster shape in response", async () => {
    const photo = makePhoto();
    const cluster = makeCluster({ photoCount: 1 });
    const face = makeFace(photo.id, cluster.id);

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values(face);

    const res = await postSplit(cluster.id, { faceIds: [face.id] });
    expect(res.status).toBe(201);
    const data = await res.json();

    expect(data.newCluster.id).toBeDefined();
    expect(data.newCluster.label).toBeNull();
    expect(data.newCluster.photoCount).toBe(1);
    expect(data.newCluster.createdAt).toBeDefined();
  });

  it("source cluster is not deleted even when all faces are moved", async () => {
    const photo = makePhoto();
    const cluster = makeCluster({ photoCount: 1 });
    const face = makeFace(photo.id, cluster.id);

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values(face);

    await postSplit(cluster.id, { faceIds: [face.id] });

    const [src] = await testDb.select().from(faceClusters).where(eq(faceClusters.id, cluster.id));
    expect(src).toBeDefined();
    expect(src.photoCount).toBe(0);
  });

  it("two faces from same photo in new cluster counts as photoCount=1", async () => {
    const photo = makePhoto();
    const cluster = makeCluster({ photoCount: 1 });
    const face1 = makeFace(photo.id, cluster.id);
    const face2 = makeFace(photo.id, cluster.id);

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values([face1, face2]);

    const res = await postSplit(cluster.id, {
      faceIds: [face1.id, face2.id],
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    // both faces from same photo → photoCount = 1, not 2
    expect(data.newCluster.photoCount).toBe(1);
  });
});
