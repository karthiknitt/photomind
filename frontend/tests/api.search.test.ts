/**
 * Tests for GET /api/search route.
 *
 * Strategy:
 * - Mock @/lib/db/client via bun:test mock.module with a Proxy db.
 *   The Proxy forwards all Drizzle ORM calls to `_cell.current` which is
 *   swapped per-test in beforeEach. This avoids the bun module-cache issue
 *   where a getter on the namespace object is only evaluated once.
 * - SQLite handles are kept alive until after all tests (stored in _handles).
 *   Closing them early would cause "Cannot use a closed database" in the
 *   bun module cache that holds the old drizzle session.
 * - fetch is overridden per-call via the callSearch helper param rather than
 *   global stubs, so tests are self-contained.
 */

import { Database } from "bun:sqlite";
import { mock } from "bun:test";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NewPhoto } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import { photos } from "@/lib/db/schema";

// ─── Shared Proxy-based db mock ───────────────────────────────────────────────

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

// Shared mutable cell. Each test sets current to its own in-memory DB.
const _cell: { current: TestDb | null } = { current: null };

// Proxy forwards all drizzle method calls to the current test DB.
// biome-ignore lint/suspicious/noExplicitAny: proxy needs any for forwarding
const dbProxy = new Proxy({} as TestDb, {
  get(_, prop: string | symbol) {
    if (!_cell.current) {
      throw new Error(`[test] DB proxy accessed but _cell.current is null (prop=${String(prop)})`);
    }
    // biome-ignore lint/suspicious/noExplicitAny: proxy forwarding
    const target = _cell.current as any;
    const val = target[prop];
    return typeof val === "function" ? val.bind(target) : val;
  },
});

// Install mock before any imports of @/lib/db/client can happen.
mock.module("@/lib/db/client", () => ({ db: dbProxy }));

// ─── DB factory ───────────────────────────────────────────────────────────────

// Keep all handles alive — bun module cache may retain references to old drizzle
// sessions; closing the underlying sqlite prematurely causes runtime errors.
const _handles: Database[] = [];

function createTestDb(): TestDb {
  const sqlite = new Database(":memory:");
  _handles.push(sqlite);
  const db = drizzle(sqlite, { schema });
  db.run(sql`PRAGMA foreign_keys=ON`);
  db.run(sql`PRAGMA journal_mode=WAL`);
  migrate(db, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  return db;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = Math.floor(Date.now() / 1000);

function makePhoto(overrides: Partial<NewPhoto> = {}): NewPhoto {
  return {
    id: crypto.randomUUID(),
    sourceRemote: "onedrive_karthik",
    sourcePath: "/Pictures/test.jpg",
    status: "DONE",
    createdAt: NOW,
    updatedAt: NOW,
    faceCount: 0,
    ...overrides,
  };
}

// ─── Helper: call route handler directly ─────────────────────────────────────

async function callSearch(
  params: Record<string, string>,
  fetchOverride?: (url: string) => Promise<unknown>
): Promise<{ status: number; body: unknown }> {
  const { GET } = await import("@/app/api/search/route");
  const { NextRequest } = await import("next/server");
  const url = new URL("http://localhost/api/search");
  for (const [key, val] of Object.entries(params)) {
    url.searchParams.set(key, val);
  }

  // Temporarily override global fetch if provided
  const origFetch = globalThis.fetch;
  if (fetchOverride) {
    // biome-ignore lint/suspicious/noExplicitAny: test-only fetch override
    (globalThis as any).fetch = fetchOverride;
  }
  let res: Response;
  try {
    const req = new NextRequest(url.toString());
    res = await GET(req);
  } finally {
    if (fetchOverride) {
      globalThis.fetch = origFetch;
    }
  }

  const body = await res.json();
  return { status: res.status, body };
}

// ─── TestTextSearch ───────────────────────────────────────────────────────────

describe("TestTextSearch", () => {
  beforeEach(() => {
    _cell.current = createTestDb();
    delete process.env.CLIP_BRIDGE_URL;
  });

  afterEach(() => {
    _cell.current = null;
    delete process.env.CLIP_BRIDGE_URL;
  });

  it("returns text matches on city", async () => {
    const photo = makePhoto({ city: "Paris", country: "France" });
    await _cell.current!.insert(photos).values(photo);

    const { status, body } = await callSearch({ q: "Paris" });

    expect(status).toBe(200);
    const data = body as { results: { id: string }[] };
    expect(data.results.map((r) => r.id)).toContain(photo.id);
  });

  it("returns text matches on country", async () => {
    const photo = makePhoto({ city: "Tokyo", country: "Japan" });
    await _cell.current!.insert(photos).values(photo);

    const { status, body } = await callSearch({ q: "Japan" });

    expect(status).toBe(200);
    const data = body as { results: { id: string }[] };
    expect(data.results.map((r) => r.id)).toContain(photo.id);
  });

  it("returns text matches on filenameFinal", async () => {
    const photo = makePhoto({ filenameFinal: "beach_sunset_2024.jpg" });
    await _cell.current!.insert(photos).values(photo);

    const { status, body } = await callSearch({ q: "sunset" });

    expect(status).toBe(200);
    const data = body as { results: { id: string }[] };
    expect(data.results.map((r) => r.id)).toContain(photo.id);
  });

  it("returns empty array when no matches", async () => {
    const photo = makePhoto({ city: "Berlin", country: "Germany" });
    await _cell.current!.insert(photos).values(photo);

    const { status, body } = await callSearch({ q: "xyznomatchwhatsoever" });

    expect(status).toBe(200);
    const data = body as { results: unknown[] };
    expect(data.results).toHaveLength(0);
  });
});

// ─── TestSemanticSearch ───────────────────────────────────────────────────────

describe("TestSemanticSearch", () => {
  beforeEach(() => {
    _cell.current = createTestDb();
  });

  afterEach(() => {
    _cell.current = null;
    delete process.env.CLIP_BRIDGE_URL;
  });

  it("calls CLIP bridge URL when CLIP_BRIDGE_URL is set", async () => {
    process.env.CLIP_BRIDGE_URL = "http://localhost:8765";
    const photo = makePhoto({ id: "semantic-photo-1" });
    await _cell.current!.insert(photos).values(photo);

    let calledUrl = "";
    const { status } = await callSearch({ q: "dogs", mode: "semantic" }, async (url) => {
      calledUrl = url;
      return {
        ok: true,
        json: async () => ({
          results: [{ id: photo.id, distance: 0.1 }],
          query: "dogs",
          n: 1,
        }),
      };
    });

    expect(status).toBe(200);
    expect(calledUrl).toContain("localhost:8765");
    expect(calledUrl).toContain("dogs");
  });

  it("converts distance to score (score = 1 - distance)", async () => {
    process.env.CLIP_BRIDGE_URL = "http://localhost:8765";
    const photo = makePhoto({ id: "dist-photo-1" });
    await _cell.current!.insert(photos).values(photo);

    const { status, body } = await callSearch({ q: "cats", mode: "semantic" }, async () => ({
      ok: true,
      json: async () => ({
        results: [{ id: photo.id, distance: 0.3 }],
        query: "cats",
        n: 1,
      }),
    }));

    expect(status).toBe(200);
    const data = body as { results: { id: string; score: number }[] };
    const result = data.results.find((r) => r.id === photo.id);
    expect(result).toBeDefined();
    expect(result!.score).toBeCloseTo(0.7, 5);
  });

  it("skips bridge when CLIP_BRIDGE_URL not set", async () => {
    delete process.env.CLIP_BRIDGE_URL;
    const photo = makePhoto({ city: "London", country: "UK" });
    await _cell.current!.insert(photos).values(photo);

    let fetchCalled = false;
    const { status } = await callSearch({ q: "London" }, async () => {
      fetchCalled = true;
      return { ok: true, json: async () => ({ results: [], query: "", n: 0 }) };
    });

    expect(status).toBe(200);
    expect(fetchCalled).toBe(false);
  });

  it("degrades gracefully when bridge returns 500", async () => {
    process.env.CLIP_BRIDGE_URL = "http://localhost:8765";
    const photo = makePhoto({ city: "Mumbai", country: "India" });
    await _cell.current!.insert(photos).values(photo);

    const { status, body } = await callSearch({ q: "Mumbai" }, async () => ({
      ok: false,
      status: 500,
      json: async () => ({ detail: "Internal Server Error" }),
    }));

    // Should not throw — falls back to text-only
    expect(status).toBe(200);
    const data = body as { results: { id: string }[] };
    expect(data.results.map((r) => r.id)).toContain(photo.id);
  });
});

// ─── TestHybridMerge ──────────────────────────────────────────────────────────

describe("TestHybridMerge", () => {
  beforeEach(() => {
    _cell.current = createTestDb();
    process.env.CLIP_BRIDGE_URL = "http://localhost:8765";
  });

  afterEach(() => {
    _cell.current = null;
    delete process.env.CLIP_BRIDGE_URL;
  });

  it("deduplicates results appearing in both text and semantic", async () => {
    const photo = makePhoto({ city: "Rome", country: "Italy" });
    await _cell.current!.insert(photos).values(photo);

    const { status, body } = await callSearch({ q: "Rome", mode: "hybrid" }, async () => ({
      ok: true,
      json: async () => ({
        results: [{ id: photo.id, distance: 0.2 }],
        query: "Rome",
        n: 1,
      }),
    }));

    expect(status).toBe(200);
    const data = body as { results: { id: string }[] };
    const ids = data.results.map((r) => r.id);
    const count = ids.filter((id) => id === photo.id).length;
    expect(count).toBe(1);
  });

  it("assigns hybrid matchSource for photos found by both methods", async () => {
    const photo = makePhoto({ city: "Sydney", country: "Australia" });
    await _cell.current!.insert(photos).values(photo);

    const { status, body } = await callSearch({ q: "Sydney", mode: "hybrid" }, async () => ({
      ok: true,
      json: async () => ({
        results: [{ id: photo.id, distance: 0.15 }],
        query: "Sydney",
        n: 1,
      }),
    }));

    expect(status).toBe(200);
    const data = body as { results: { id: string; matchSource: string }[] };
    const result = data.results.find((r) => r.id === photo.id);
    expect(result).toBeDefined();
    expect(result!.matchSource).toBe("hybrid");
  });

  it("sorts by score descending", async () => {
    const photo1 = makePhoto({ city: "Cairo", country: "Egypt" });
    const photo2 = makePhoto({ city: "Cairo", country: "Egypt" });
    await _cell.current!.insert(photos).values([photo1, photo2]);

    const { status, body } = await callSearch({ q: "Cairo", mode: "hybrid" }, async () => ({
      ok: true,
      json: async () => ({
        results: [
          { id: photo1.id, distance: 0.05 },
          { id: photo2.id, distance: 0.8 },
        ],
        query: "Cairo",
        n: 2,
      }),
    }));

    expect(status).toBe(200);
    const data = body as { results: { score: number }[] };
    const scores = data.results.map((r) => r.score);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
    }
  });
});

// ─── TestValidation ───────────────────────────────────────────────────────────

describe("TestValidation", () => {
  beforeEach(() => {
    _cell.current = createTestDb();
    delete process.env.CLIP_BRIDGE_URL;
  });

  afterEach(() => {
    _cell.current = null;
    delete process.env.CLIP_BRIDGE_URL;
  });

  it("returns 400 when q is missing", async () => {
    const { GET } = await import("@/app/api/search/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/search");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid mode", async () => {
    const { status } = await callSearch({ q: "test", mode: "invalid_mode" });
    expect(status).toBe(400);
  });

  it("clamps limit to max 50", async () => {
    const photo = makePhoto({ city: "Oslo", country: "Norway" });
    await _cell.current!.insert(photos).values(photo);

    const { status } = await callSearch({ q: "Oslo", limit: "999" });
    expect(status).toBe(200);
  });
});

// ─── TestResponse ─────────────────────────────────────────────────────────────

describe("TestResponse", () => {
  beforeEach(() => {
    _cell.current = createTestDb();
    delete process.env.CLIP_BRIDGE_URL;
  });

  afterEach(() => {
    _cell.current = null;
    delete process.env.CLIP_BRIDGE_URL;
  });

  it("response shape has id, filenameFinal, score, matchSource", async () => {
    const photo = makePhoto({
      city: "Vienna",
      country: "Austria",
      filenameFinal: "vienna_trip.jpg",
    });
    await _cell.current!.insert(photos).values(photo);

    const { status, body } = await callSearch({ q: "Vienna" });

    expect(status).toBe(200);
    const data = body as {
      results: {
        id: string;
        filenameFinal: string | null;
        score: number;
        matchSource: string;
      }[];
    };
    expect(data.results.length).toBeGreaterThan(0);
    const r = data.results[0];
    expect(r).toHaveProperty("id");
    expect(r).toHaveProperty("filenameFinal");
    expect(r).toHaveProperty("score");
    expect(r).toHaveProperty("matchSource");
  });

  it("response has query and mode fields", async () => {
    const photo = makePhoto({ city: "Athens", country: "Greece" });
    await _cell.current!.insert(photos).values(photo);

    const { status, body } = await callSearch({ q: "Athens", mode: "text" });

    expect(status).toBe(200);
    const data = body as { query: string; mode: string };
    expect(data.query).toBe("Athens");
    expect(data.mode).toBe("text");
  });

  it("response has total field", async () => {
    const photo = makePhoto({ city: "Prague", country: "CzechRepublic" });
    await _cell.current!.insert(photos).values(photo);

    const { status, body } = await callSearch({ q: "Prague" });

    expect(status).toBe(200);
    const data = body as { total: number };
    expect(data).toHaveProperty("total");
    expect(typeof data.total).toBe("number");
  });
});
