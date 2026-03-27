/**
 * Tests for GET /api/faces/clusters/[id]/photos
 *
 * Strategy:
 * - Use vi.mock to inject an in-memory test DB via Drizzle ORM.
 * - Each test gets a fresh DB via beforeEach.
 * - Run migrations so schema matches real DB.
 *
 * Coverage:
 * - Returns paginated photos for a cluster
 * - Returns empty array when no photos in cluster
 * - Returns 404 when cluster not found
 * - Only returns photos with status = DONE
 * - Pagination: hasMore is true when more pages exist
 * - Supports ?page and ?limit query params
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
    faceCount: 1,
    ...overrides,
  };
}

function makeCluster(overrides: Partial<NewFaceCluster> = {}): NewFaceCluster {
  return {
    id: crypto.randomUUID(),
    label: "Test Person",
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

async function getPhotosRequest(id: string, queryParams = ""): Promise<Response> {
  const { GET } = await import("@/app/api/faces/clusters/[id]/photos/route");
  const url = `http://localhost/api/faces/clusters/${id}/photos${queryParams}`;
  const req = new Request(url);
  const params = Promise.resolve({ id });
  return GET(req, { params });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/faces/clusters/[id]/photos", () => {
  beforeEach(() => {
    const { sqlite, db } = createTestDb();
    testSqlite = sqlite;
    testDb = db;
  });

  afterEach(() => {
    testSqlite.close();
  });

  it("returns 404 when cluster not found", async () => {
    const res = await getPhotosRequest("non-existent-cluster");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data).toHaveProperty("error");
  });

  it("returns empty array when cluster has no photos", async () => {
    const cluster = makeCluster({ id: "cluster-1", photoCount: 0 });
    await testDb.insert(faceClusters).values(cluster);

    const res = await getPhotosRequest("cluster-1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.photos).toEqual([]);
    expect(data.pagination.total).toBe(0);
    expect(data.pagination.hasMore).toBe(false);
  });

  it("returns paginated photos for a cluster", async () => {
    const photo = makePhoto({ id: "photo-1", filenameFinal: "photo.jpg" });
    const cluster = makeCluster({ id: "cluster-1", photoCount: 1 });
    const face = makeFace(photo.id, cluster.id);

    await testDb.insert(photos).values(photo);
    await testDb.insert(faceClusters).values(cluster);
    await testDb.insert(faces).values(face);

    const res = await getPhotosRequest("cluster-1");
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.photos).toHaveLength(1);
    expect(data.photos[0].id).toBe("photo-1");
    expect(data.photos[0].filenameFinal).toBe("photo.jpg");
    expect(data.pagination.total).toBe(1);
    expect(data.pagination.page).toBe(1);
    expect(data.pagination.hasMore).toBe(false);
  });

  it("only returns photos with status DONE", async () => {
    const photo1 = makePhoto({ id: "photo-done", status: "DONE" });
    const photo2 = makePhoto({ id: "photo-queued", status: "QUEUED" });
    const photo3 = makePhoto({ id: "photo-error", status: "ERROR" });
    const cluster = makeCluster({ id: "cluster-1", photoCount: 3 });

    await testDb.insert(photos).values([photo1, photo2, photo3]);
    await testDb.insert(faceClusters).values(cluster);
    await testDb
      .insert(faces)
      .values([
        makeFace(photo1.id, cluster.id),
        makeFace(photo2.id, cluster.id),
        makeFace(photo3.id, cluster.id),
      ]);

    const res = await getPhotosRequest("cluster-1");
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.photos).toHaveLength(1);
    expect(data.photos[0].id).toBe("photo-done");
  });

  it("hasMore is true when more pages exist", async () => {
    const cluster = makeCluster({ id: "cluster-1", photoCount: 3 });
    await testDb.insert(faceClusters).values(cluster);

    const photoList: NewPhoto[] = [];
    const faceList: NewFace[] = [];
    for (let i = 0; i < 3; i++) {
      const p = makePhoto();
      photoList.push(p);
      faceList.push(makeFace(p.id, cluster.id));
    }
    await testDb.insert(photos).values(photoList);
    await testDb.insert(faces).values(faceList);

    const res = await getPhotosRequest("cluster-1", "?page=1&limit=2");
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.photos).toHaveLength(2);
    expect(data.pagination.hasMore).toBe(true);
    expect(data.pagination.total).toBe(3);
  });

  it("supports page 2 pagination", async () => {
    const cluster = makeCluster({ id: "cluster-1", photoCount: 3 });
    await testDb.insert(faceClusters).values(cluster);

    const photoList: NewPhoto[] = [];
    const faceList: NewFace[] = [];
    for (let i = 0; i < 3; i++) {
      const p = makePhoto();
      photoList.push(p);
      faceList.push(makeFace(p.id, cluster.id));
    }
    await testDb.insert(photos).values(photoList);
    await testDb.insert(faces).values(faceList);

    const res = await getPhotosRequest("cluster-1", "?page=2&limit=2");
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.photos).toHaveLength(1);
    expect(data.pagination.page).toBe(2);
    expect(data.pagination.hasMore).toBe(false);
  });
});
