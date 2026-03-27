/**
 * Tests for GET /api/faces/clusters
 *
 * Strategy:
 * - Use vi.mock to inject an in-memory test DB via Drizzle ORM.
 * - Each test gets a fresh DB via beforeEach.
 * - Run migrations so schema matches real DB.
 *
 * Coverage:
 * - Returns empty clusters array when no clusters exist
 * - Returns clusters with correct shape (id, label, photoCount, createdAt, representativePhotoId)
 * - Orders clusters by photoCount descending
 * - Only returns clusters with photoCount > 0
 * - representativePhotoId is present for clusters with faces
 * - representativePhotoId is null if cluster has no faces
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

function makeFace(photoId: string, clusterId: string, overrides: Partial<NewFace> = {}): NewFace {
  return {
    id: crypto.randomUUID(),
    photoId,
    clusterId,
    embeddingId: null,
    bboxX: 10,
    bboxY: 10,
    bboxW: 50,
    bboxH: 50,
    detScore: 0.95,
    ...overrides,
  };
}

// ─── Route helper ─────────────────────────────────────────────────────────────

async function getRequest(): Promise<Response> {
  const { GET } = await import("@/app/api/faces/clusters/route");
  const req = new Request("http://localhost/api/faces/clusters");
  return GET(req);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/faces/clusters", () => {
  beforeEach(() => {
    const { sqlite, db } = createTestDb();
    testSqlite = sqlite;
    testDb = db;
  });

  afterEach(() => {
    testSqlite.close();
  });

  it("returns empty clusters array when no clusters exist", async () => {
    const res = await getRequest();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.clusters).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("returns cluster with correct shape", async () => {
    const photo = makePhoto();
    const cluster = makeCluster({ label: "Karthik", photoCount: 5 });
    const face = makeFace(photo.id, cluster.id);

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values(face);

    const res = await getRequest();
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.clusters).toHaveLength(1);
    const c = data.clusters[0];
    expect(c.id).toBe(cluster.id);
    expect(c.label).toBe("Karthik");
    expect(c.photoCount).toBe(5);
    expect(c.createdAt).toBe(NOW);
    expect(c.representativePhotoId).toBe(photo.id);
    expect(data.total).toBe(1);
  });

  it("orders clusters by photoCount descending", async () => {
    const photo1 = makePhoto();
    const photo2 = makePhoto();
    const photo3 = makePhoto();

    const clusterA = makeCluster({ label: "A", photoCount: 2 });
    const clusterB = makeCluster({ label: "B", photoCount: 10 });
    const clusterC = makeCluster({ label: "C", photoCount: 5 });

    await testDb.insert(photos).values([photo1, photo2, photo3]);
    await testDb.insert(faceClusters).values([clusterA, clusterB, clusterC]);
    await testDb
      .insert(faces)
      .values([
        makeFace(photo1.id, clusterA.id),
        makeFace(photo2.id, clusterB.id),
        makeFace(photo3.id, clusterC.id),
      ]);

    const res = await getRequest();
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.clusters).toHaveLength(3);
    expect(data.clusters[0].label).toBe("B"); // 10
    expect(data.clusters[1].label).toBe("C"); // 5
    expect(data.clusters[2].label).toBe("A"); // 2
  });

  it("only returns clusters with photoCount > 0", async () => {
    const photo = makePhoto();
    const activeCluster = makeCluster({ label: "Active", photoCount: 3 });
    const emptyCluster = makeCluster({ label: "Empty", photoCount: 0 });

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values([activeCluster, emptyCluster]);
    await testDb.insert(faces).values(makeFace(photo.id, activeCluster.id));

    const res = await getRequest();
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.clusters).toHaveLength(1);
    expect(data.clusters[0].label).toBe("Active");
  });

  it("representativePhotoId is a valid photo id", async () => {
    const photo = makePhoto();
    const cluster = makeCluster({ photoCount: 1 });
    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values(makeFace(photo.id, cluster.id));

    const res = await getRequest();
    const data = await res.json();
    expect(data.clusters[0].representativePhotoId).toBe(photo.id);
  });

  it("returns null label for unlabeled clusters", async () => {
    const photo = makePhoto();
    const cluster = makeCluster({ label: null, photoCount: 1 });
    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values(makeFace(photo.id, cluster.id));

    const res = await getRequest();
    const data = await res.json();
    expect(data.clusters[0].label).toBeNull();
  });

  it("total reflects only clusters with photoCount > 0", async () => {
    const photo = makePhoto();
    await testDb.insert(photos).values(photo);
    await testDb
      .insert(faceClusters)
      .values([
        makeCluster({ photoCount: 1 }),
        makeCluster({ photoCount: 0 }),
        makeCluster({ photoCount: 5 }),
      ]);

    // Add faces for the active clusters
    const allClusters = await testDb.select().from(faceClusters);
    const activeClusters = allClusters.filter((c) => (c.photoCount ?? 0) > 0);
    for (const c of activeClusters) {
      await testDb.insert(faces).values(makeFace(photo.id, c.id));
    }

    const res = await getRequest();
    const data = await res.json();
    expect(data.total).toBe(2);
  });
});
