/**
 * Tests for GET /api/photos/[id]
 *
 * TDD: Write tests first, confirm FAIL, then implement.
 *
 * Uses vi.mock to inject an in-memory test DB.
 * Each test gets a fresh in-memory DB in beforeEach.
 *
 * Coverage:
 * - Returns 200 + correct shape for existing photo
 * - Returns 200 + faces array with clusterLabel
 * - Returns 404 for unknown id
 * - Includes all expected photo fields
 * - Faces with no cluster return clusterLabel null
 * - Returns 200 with empty faces array when photo has no faces
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

function makePhoto(overrides: Partial<NewPhoto> = {}): NewPhoto {
  return {
    id: crypto.randomUUID(),
    sourceRemote: "onedrive_test",
    sourcePath: "/test/photo.jpg",
    status: "DONE",
    createdAt: Math.floor(Date.now() / 1000),
    updatedAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function makeCluster(overrides: Partial<NewFaceCluster> = {}): NewFaceCluster {
  return {
    id: crypto.randomUUID(),
    createdAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function makeFace(photoId: string, overrides: Partial<NewFace> = {}): NewFace {
  return {
    id: crypto.randomUUID(),
    photoId,
    bboxX: 100,
    bboxY: 50,
    bboxW: 80,
    bboxH: 90,
    detScore: 0.97,
    ...overrides,
  };
}

// ─── Helper: call GET handler ─────────────────────────────────────────────────

async function callGet(id: string) {
  const { GET } = await import("@/app/api/photos/[id]/route");
  const url = `http://localhost/api/photos/${id}`;
  const req = new Request(url);
  const params = Promise.resolve({ id });
  return GET(req as Parameters<typeof GET>[0], { params });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/photos/[id]", () => {
  beforeEach(() => {
    ({ sqlite: testSqlite, db: testDb } = createTestDb());
  });

  afterEach(() => {
    testSqlite.close();
  });

  it("returns 200 with correct shape for an existing photo", async () => {
    const photo = makePhoto({
      id: "photo-abc-123",
      filenameFinal: "2024-12-25_family.jpg",
      dateTaken: 1735084800,
      city: "Chennai",
      state: "Tamil Nadu",
      country: "India",
      cameraMake: "Apple",
      cameraModel: "iPhone 15 Pro",
      width: 4032,
      height: 3024,
      fileSize: 4096000,
      gpsLat: 13.0827,
      gpsLon: 80.2707,
      isMeme: false,
      faceCount: 0,
      clipIndexed: true,
    });

    await testDb.insert(photos).values([photo]);

    const res = await callGet("photo-abc-123");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("photo");
    expect(body).toHaveProperty("faces");
    expect(Array.isArray(body.faces)).toBe(true);

    const p = body.photo;
    expect(p.id).toBe("photo-abc-123");
    expect(p.filenameFinal).toBe("2024-12-25_family.jpg");
    expect(p.city).toBe("Chennai");
    expect(p.country).toBe("India");
    expect(p.cameraMake).toBe("Apple");
    expect(p.cameraModel).toBe("iPhone 15 Pro");
  });

  it("includes all expected photo fields in the response", async () => {
    const ts = 1735084800;
    const photo = makePhoto({
      id: "photo-fields-test",
      filenameFinal: "test.jpg",
      dateTaken: ts,
      city: "Mumbai",
      state: "Maharashtra",
      country: "India",
      cameraMake: "Samsung",
      cameraModel: "Galaxy S24",
      width: 1920,
      height: 1080,
      fileSize: 2048000,
      gpsLat: 19.076,
      gpsLon: 72.8777,
      isMeme: false,
      faceCount: 3,
      clipIndexed: false,
      status: "DONE",
    });

    await testDb.insert(photos).values([photo]);

    const res = await callGet("photo-fields-test");
    expect(res.status).toBe(200);

    const { photo: p } = await res.json();
    // All required fields must be present
    expect(p).toHaveProperty("id");
    expect(p).toHaveProperty("filenameFinal");
    expect(p).toHaveProperty("dateTaken");
    expect(p).toHaveProperty("city");
    expect(p).toHaveProperty("state");
    expect(p).toHaveProperty("country");
    expect(p).toHaveProperty("cameraMake");
    expect(p).toHaveProperty("cameraModel");
    expect(p).toHaveProperty("width");
    expect(p).toHaveProperty("height");
    expect(p).toHaveProperty("fileSize");
    expect(p).toHaveProperty("gpsLat");
    expect(p).toHaveProperty("gpsLon");
    expect(p).toHaveProperty("isMeme");
    expect(p).toHaveProperty("faceCount");
    expect(p).toHaveProperty("clipIndexed");
    expect(p).toHaveProperty("status");
    expect(p).toHaveProperty("createdAt");

    // Check field values
    expect(p.width).toBe(1920);
    expect(p.height).toBe(1080);
    expect(p.fileSize).toBe(2048000);
    expect(p.faceCount).toBe(3);
    expect(p.isMeme).toBe(false);
    expect(p.clipIndexed).toBe(false);
    expect(p.status).toBe("DONE");
    expect(p.dateTaken).toBe(ts);
  });

  it("returns 200 with faces array including clusterLabel", async () => {
    const photo = makePhoto({ id: "photo-with-faces", faceCount: 2 });
    const cluster = makeCluster({ id: "cluster-1", label: "Karthik" });

    await testDb.insert(photos).values([photo]);
    await testDb.insert(faceClusters).values([cluster]);
    await testDb
      .insert(faces)
      .values([
        makeFace("photo-with-faces", { clusterId: "cluster-1" }),
        makeFace("photo-with-faces", { clusterId: null }),
      ]);

    const res = await callGet("photo-with-faces");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.faces).toHaveLength(2);

    // Face with cluster should have the cluster label
    const labeledFace = body.faces.find(
      (f: { clusterLabel: string | null }) => f.clusterLabel === "Karthik"
    );
    expect(labeledFace).toBeDefined();
    expect(labeledFace.clusterLabel).toBe("Karthik");

    // Face without cluster should have null clusterLabel
    const unlabeledFace = body.faces.find(
      (f: { clusterLabel: string | null }) => f.clusterLabel === null
    );
    expect(unlabeledFace).toBeDefined();
    expect(unlabeledFace.clusterLabel).toBeNull();
  });

  it("returns 404 for an unknown photo id", async () => {
    const res = await callGet("does-not-exist");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 200 with empty faces array when photo has no faces", async () => {
    const photo = makePhoto({ id: "photo-no-faces", faceCount: 0 });
    await testDb.insert(photos).values([photo]);

    const res = await callGet("photo-no-faces");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.faces).toHaveLength(0);
    expect(Array.isArray(body.faces)).toBe(true);
  });

  it("returns faces with all expected face fields", async () => {
    const photo = makePhoto({ id: "photo-face-fields", faceCount: 1 });
    const cluster = makeCluster({ id: "cluster-karthik", label: "Karthik" });
    const faceId = "face-uuid-1";

    await testDb.insert(photos).values([photo]);
    await testDb.insert(faceClusters).values([cluster]);
    await testDb.insert(faces).values([
      makeFace("photo-face-fields", {
        id: faceId,
        clusterId: "cluster-karthik",
        bboxX: 100,
        bboxY: 50,
        bboxW: 80,
        bboxH: 90,
        detScore: 0.97,
      }),
    ]);

    const res = await callGet("photo-face-fields");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.faces).toHaveLength(1);

    const face = body.faces[0];
    expect(face).toHaveProperty("id");
    expect(face).toHaveProperty("clusterId");
    expect(face).toHaveProperty("clusterLabel");
    expect(face).toHaveProperty("bboxX");
    expect(face).toHaveProperty("bboxY");
    expect(face).toHaveProperty("bboxW");
    expect(face).toHaveProperty("bboxH");
    expect(face).toHaveProperty("detScore");

    expect(face.id).toBe(faceId);
    expect(face.clusterId).toBe("cluster-karthik");
    expect(face.clusterLabel).toBe("Karthik");
    expect(face.bboxX).toBe(100);
    expect(face.bboxY).toBe(50);
    expect(face.bboxW).toBe(80);
    expect(face.bboxH).toBe(90);
    expect(face.detScore).toBe(0.97);
  });
});
