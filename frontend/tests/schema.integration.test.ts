/**
 * Sprint 1.1 — DB Schema integration tests
 *
 * Tests real SQLite CRUD operations via Drizzle ORM for all 7 tables.
 * Uses an in-memory DB per suite for full isolation.
 *
 * TDD RED: These tests fail until `bun run db:generate` creates migration
 * files in ./drizzle/ — that is expected and intentional.
 */
import { Database } from "bun:sqlite";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  NewActionLog,
  NewEvent,
  NewFace,
  NewFaceCluster,
  NewPhoto,
  NewPhotoTag,
  NewSource,
} from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import {
  actionLog,
  events,
  faceClusters,
  faces,
  photos,
  photoTags,
  sources,
} from "@/lib/db/schema";

// ─── Test DB factory ──────────────────────────────────────────────────────────

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function createTestDb(): { sqlite: Database; db: TestDb } {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // Enable FK constraints and WAL via Drizzle's run interface
  db.run(sql`PRAGMA foreign_keys=ON`);
  db.run(sql`PRAGMA journal_mode=WAL`);
  migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../drizzle"),
  });
  return { sqlite, db };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = Math.floor(Date.now() / 1000);

function makePhoto(overrides: Partial<NewPhoto> = {}): NewPhoto {
  return {
    id: crypto.randomUUID(),
    sourceRemote: "onedrive_karthik",
    sourcePath: "/Pictures/2024/test.jpg",
    status: "QUEUED",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeCluster(overrides: Partial<NewFaceCluster> = {}): NewFaceCluster {
  return {
    id: crypto.randomUUID(),
    createdAt: NOW,
    ...overrides,
  };
}

// ─── photos ───────────────────────────────────────────────────────────────────

describe("photos table", () => {
  let sqlite: Database;
  let db: TestDb;

  beforeEach(() => {
    ({ sqlite, db } = createTestDb());
  });

  afterEach(() => {
    sqlite.close();
  });

  it("inserts and retrieves a minimal photo record", async () => {
    const photo = makePhoto();
    await db.insert(photos).values(photo);
    const [found] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(found.id).toBe(photo.id);
    expect(found.sourceRemote).toBe("onedrive_karthik");
    expect(found.sourcePath).toBe("/Pictures/2024/test.jpg");
  });

  it("applies default status QUEUED when not specified", async () => {
    const photo = makePhoto();
    await db.insert(photos).values(photo);
    const [found] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(found.status).toBe("QUEUED");
  });

  it("applies default isMeme=false", async () => {
    const photo = makePhoto();
    await db.insert(photos).values(photo);
    const [found] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(found.isMeme).toBe(false);
  });

  it("applies default clipIndexed=false and faceCount=0", async () => {
    const photo = makePhoto();
    await db.insert(photos).values(photo);
    const [found] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(found.clipIndexed).toBe(false);
    expect(found.faceCount).toBe(0);
  });

  it("stores all optional metadata fields", async () => {
    const photo = makePhoto({
      gpsLat: 11.0168,
      gpsLon: 76.9558,
      city: "Ooty",
      state: "Tamil Nadu",
      country: "India",
      cameraMake: "Apple",
      cameraModel: "iPhone 14 Pro",
      dateTaken: 1735123200,
      width: 4032,
      height: 3024,
      fileSize: 4_200_000,
      phash: "abc123def456",
    });
    await db.insert(photos).values(photo);
    const [found] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(found.gpsLat).toBeCloseTo(11.0168);
    expect(found.city).toBe("Ooty");
    expect(found.cameraMake).toBe("Apple");
    expect(found.phash).toBe("abc123def456");
  });

  it("updates status to DONE and updatedAt", async () => {
    const photo = makePhoto();
    await db.insert(photos).values(photo);
    const later = NOW + 60;
    await db
      .update(photos)
      .set({ status: "DONE", updatedAt: later })
      .where(eq(photos.id, photo.id));
    const [found] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(found.status).toBe("DONE");
    expect(found.updatedAt).toBe(later);
  });

  it("marks photo as meme with reason", async () => {
    const photo = makePhoto({
      isMeme: true,
      memeReason: "whatsapp,aspect_ratio",
    });
    await db.insert(photos).values(photo);
    const [found] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(found.isMeme).toBe(true);
    expect(found.memeReason).toBe("whatsapp,aspect_ratio");
  });

  it("enforces unique id — duplicate insert throws", async () => {
    const photo = makePhoto();
    await db.insert(photos).values(photo);
    const duplicate = async () => db.insert(photos).values(photo);
    await expect(duplicate()).rejects.toThrow();
  });
});

// ─── face_clusters ────────────────────────────────────────────────────────────

describe("face_clusters table", () => {
  let sqlite: Database;
  let db: TestDb;

  beforeEach(() => {
    ({ sqlite, db } = createTestDb());
  });

  afterEach(() => {
    sqlite.close();
  });

  it("inserts a cluster with no label (nullable)", async () => {
    const cluster = makeCluster();
    await db.insert(faceClusters).values(cluster);
    const [found] = await db.select().from(faceClusters).where(eq(faceClusters.id, cluster.id));
    expect(found.label).toBeNull();
    expect(found.photoCount).toBe(0);
  });

  it("updates cluster label with a person name", async () => {
    const cluster = makeCluster();
    await db.insert(faceClusters).values(cluster);
    await db
      .update(faceClusters)
      .set({ label: "Karthik", photoCount: 42 })
      .where(eq(faceClusters.id, cluster.id));
    const [found] = await db.select().from(faceClusters).where(eq(faceClusters.id, cluster.id));
    expect(found.label).toBe("Karthik");
    expect(found.photoCount).toBe(42);
  });
});

// ─── faces ────────────────────────────────────────────────────────────────────

describe("faces table", () => {
  let sqlite: Database;
  let db: TestDb;
  let photoId: string;

  beforeEach(async () => {
    ({ sqlite, db } = createTestDb());
    const photo = makePhoto();
    photoId = photo.id;
    await db.insert(photos).values(photo);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("inserts a face linked to a photo", async () => {
    const face: NewFace = {
      id: crypto.randomUUID(),
      photoId,
      bboxX: 100,
      bboxY: 80,
      bboxW: 120,
      bboxH: 140,
      detScore: 0.97,
    };
    await db.insert(faces).values(face);
    const [found] = await db.select().from(faces).where(eq(faces.id, face.id));
    expect(found.photoId).toBe(photoId);
    expect(found.detScore).toBeCloseTo(0.97);
    expect(found.clusterId).toBeNull();
  });

  it("links a face to a cluster", async () => {
    const cluster = makeCluster();
    await db.insert(faceClusters).values(cluster);

    const face: NewFace = {
      id: crypto.randomUUID(),
      photoId,
      clusterId: cluster.id,
      detScore: 0.91,
    };
    await db.insert(faces).values(face);
    const [found] = await db.select().from(faces).where(eq(faces.id, face.id));
    expect(found.clusterId).toBe(cluster.id);
  });

  it("rejects a face with non-existent photo_id (FK violation)", async () => {
    const face: NewFace = {
      id: crypto.randomUUID(),
      photoId: "does-not-exist",
    };
    const insert = async () => db.insert(faces).values(face);
    await expect(insert()).rejects.toThrow();
  });
});

// ─── photo_tags ───────────────────────────────────────────────────────────────

describe("photo_tags table", () => {
  let sqlite: Database;
  let db: TestDb;
  let photoId: string;

  beforeEach(async () => {
    ({ sqlite, db } = createTestDb());
    const photo = makePhoto();
    photoId = photo.id;
    await db.insert(photos).values(photo);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("inserts a CLIP-generated tag", async () => {
    const tag: NewPhotoTag = {
      id: crypto.randomUUID(),
      photoId,
      tag: "mountain landscape",
      source: "clip",
      confidence: 0.88,
    };
    await db.insert(photoTags).values(tag);
    const [found] = await db.select().from(photoTags).where(eq(photoTags.id, tag.id));
    expect(found.tag).toBe("mountain landscape");
    expect(found.source).toBe("clip");
    expect(found.confidence).toBeCloseTo(0.88);
  });

  it("inserts a manual tag with null confidence", async () => {
    const tag: NewPhotoTag = {
      id: crypto.randomUUID(),
      photoId,
      tag: "family",
      source: "manual",
    };
    await db.insert(photoTags).values(tag);
    const [found] = await db.select().from(photoTags).where(eq(photoTags.id, tag.id));
    expect(found.source).toBe("manual");
    expect(found.confidence).toBeNull();
  });

  it("rejects a tag with non-existent photo_id (FK violation)", async () => {
    const tag: NewPhotoTag = {
      id: crypto.randomUUID(),
      photoId: "ghost-photo",
      tag: "sunset",
      source: "clip",
    };
    const insert = async () => db.insert(photoTags).values(tag);
    await expect(insert()).rejects.toThrow();
  });
});

// ─── events ───────────────────────────────────────────────────────────────────

describe("events table", () => {
  let sqlite: Database;
  let db: TestDb;

  beforeEach(() => {
    ({ sqlite, db } = createTestDb());
  });

  afterEach(() => {
    sqlite.close();
  });

  it("inserts an event with no cover photo", async () => {
    const event: NewEvent = {
      id: crypto.randomUUID(),
      name: "Ooty Trip 2024",
      dateStart: 1735000000,
      dateEnd: 1735200000,
    };
    await db.insert(events).values(event);
    const [found] = await db.select().from(events).where(eq(events.id, event.id));
    expect(found.name).toBe("Ooty Trip 2024");
    expect(found.coverPhotoId).toBeNull();
  });

  it("inserts an event with a cover photo FK", async () => {
    const photo = makePhoto();
    await db.insert(photos).values(photo);

    const event: NewEvent = {
      id: crypto.randomUUID(),
      name: "Diwali 2024",
      coverPhotoId: photo.id,
    };
    await db.insert(events).values(event);
    const [found] = await db.select().from(events).where(eq(events.id, event.id));
    expect(found.coverPhotoId).toBe(photo.id);
  });
});

// ─── action_log ───────────────────────────────────────────────────────────────

describe("action_log table", () => {
  let sqlite: Database;
  let db: TestDb;
  let photoId: string;

  beforeEach(async () => {
    ({ sqlite, db } = createTestDb());
    const photo = makePhoto();
    photoId = photo.id;
    await db.insert(photos).values(photo);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("logs a COPIED action with photo reference", async () => {
    const entry: NewActionLog = {
      id: crypto.randomUUID(),
      photoId,
      action: "COPIED",
      detail: JSON.stringify({ dest: "onedrive_karthik:PhotoMind/library/" }),
      timestamp: NOW,
    };
    await db.insert(actionLog).values(entry);
    const [found] = await db.select().from(actionLog).where(eq(actionLog.id, entry.id));
    expect(found.action).toBe("COPIED");
    expect(found.photoId).toBe(photoId);
  });

  it("logs a SKIPPED_DUPLICATE action without photo reference", async () => {
    const entry: NewActionLog = {
      id: crypto.randomUUID(),
      action: "SKIPPED_DUPLICATE",
      detail: "pHash matched photo abc123",
      timestamp: NOW,
    };
    await db.insert(actionLog).values(entry);
    const [found] = await db.select().from(actionLog).where(eq(actionLog.id, entry.id));
    expect(found.action).toBe("SKIPPED_DUPLICATE");
    expect(found.photoId).toBeNull();
  });

  it("logs all supported action types without error", async () => {
    const actionTypes: NewActionLog["action"][] = [
      "COPIED",
      "SKIPPED_DUPLICATE",
      "SKIPPED_MEME",
      "SKIPPED_ERROR",
      "INDEXED",
      "FACE_DETECTED",
      "CLUSTER_UPDATED",
    ];
    for (const action of actionTypes) {
      await db.insert(actionLog).values({
        id: crypto.randomUUID(),
        action,
        timestamp: NOW,
      });
    }
    const all = await db.select().from(actionLog);
    expect(all).toHaveLength(actionTypes.length);
  });
});

// ─── sources ──────────────────────────────────────────────────────────────────

describe("sources table", () => {
  let sqlite: Database;
  let db: TestDb;

  beforeEach(() => {
    ({ sqlite, db } = createTestDb());
  });

  afterEach(() => {
    sqlite.close();
  });

  it("inserts a source with enabled=true by default", async () => {
    const source: NewSource = {
      id: crypto.randomUUID(),
      remoteName: "onedrive_karthik",
      displayName: "Karthik OneDrive",
      scanPath: "/Pictures",
    };
    await db.insert(sources).values(source);
    const [found] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(found.remoteName).toBe("onedrive_karthik");
    expect(found.enabled).toBe(true);
    expect(found.lastScannedAt).toBeNull();
  });

  it("updates lastScannedAt after a scan completes", async () => {
    const source: NewSource = {
      id: crypto.randomUUID(),
      remoteName: "onedrive_wife",
      displayName: "Wife OneDrive",
      scanPath: "/Camera Roll",
    };
    await db.insert(sources).values(source);
    await db.update(sources).set({ lastScannedAt: NOW }).where(eq(sources.id, source.id));
    const [found] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(found.lastScannedAt).toBe(NOW);
  });

  it("can disable a source", async () => {
    const source: NewSource = {
      id: crypto.randomUUID(),
      remoteName: "onedrive_old",
      displayName: "Old Account",
      scanPath: "/",
      enabled: false,
    };
    await db.insert(sources).values(source);
    const [found] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(found.enabled).toBe(false);
  });
});
