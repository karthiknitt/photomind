import { inArray, like, or } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import * as dbClient from "@/lib/db/client"; // namespace import so tests can replace .db via getter
import { photos } from "@/lib/db/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

type MatchSource = "semantic" | "text" | "hybrid";

type SearchResult = {
  id: string;
  score: number;
  matchSource: MatchSource;
};

type PhotoRow = typeof photos.$inferSelect;

type ResponseResult = {
  id: string;
  filenameFinal: string | null;
  libraryPath: string | null;
  dateTaken: number | null;
  city: string | null;
  country: string | null;
  width: number | null;
  height: number | null;
  faceCount: number;
  score: number;
  matchSource: MatchSource;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_MODES = ["text", "semantic", "hybrid"] as const;
type Mode = (typeof VALID_MODES)[number];

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const DEFAULT_PAGE = 1;

// ─── Text search ─────────────────────────────────────────────────────────────

async function textSearch(q: string): Promise<SearchResult[]> {
  const pattern = `%${q}%`;
  const rows = await dbClient.db
    .select({ id: photos.id })
    .from(photos)
    .where(
      or(
        like(photos.city, pattern),
        like(photos.country, pattern),
        like(photos.filenameFinal, pattern)
      )
    );
  return rows.map((r) => ({
    id: r.id,
    score: 0.5,
    matchSource: "text" as MatchSource,
  }));
}

// ─── Semantic search via CLIP bridge ─────────────────────────────────────────

type BridgeResponse = {
  results: { id: string; distance: number }[];
  query: string;
  n: number;
};

async function semanticSearch(q: string, n: number): Promise<SearchResult[]> {
  const bridgeUrl = process.env.CLIP_BRIDGE_URL;
  if (!bridgeUrl) {
    return [];
  }
  try {
    const url = `${bridgeUrl}/search?q=${encodeURIComponent(q)}&n=${n}`;
    const res = await fetch(url);
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as BridgeResponse;
    return data.results.map((r) => ({
      id: r.id,
      score: 1 - r.distance,
      matchSource: "semantic" as MatchSource,
    }));
  } catch {
    // Bridge unavailable — degrade gracefully to text-only
    return [];
  }
}

// ─── Merge logic ──────────────────────────────────────────────────────────────

function mergeResults(text: SearchResult[], semantic: SearchResult[]): SearchResult[] {
  const map = new Map<string, SearchResult>();

  for (const r of text) {
    map.set(r.id, { ...r });
  }

  for (const r of semantic) {
    const existing = map.get(r.id);
    if (existing) {
      // Present in both — take the higher score, mark as hybrid
      map.set(r.id, {
        id: r.id,
        score: Math.max(existing.score, r.score),
        matchSource: "hybrid",
      });
    } else {
      map.set(r.id, { ...r });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.score - a.score);
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;

  // Validate q
  const q = searchParams.get("q");
  if (!q || q.trim() === "") {
    return NextResponse.json({ error: "Missing required parameter: q" }, { status: 400 });
  }

  // Validate mode
  const modeParam = searchParams.get("mode") ?? "hybrid";
  if (!VALID_MODES.includes(modeParam as Mode)) {
    return NextResponse.json(
      { error: `Invalid mode "${modeParam}". Must be one of: ${VALID_MODES.join(", ")}` },
      { status: 400 }
    );
  }
  const mode = modeParam as Mode;

  // Validate and clamp limit
  const limitParam = Number.parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = Number.isNaN(limitParam) ? DEFAULT_LIMIT : Math.min(limitParam, MAX_LIMIT);

  // Validate page
  const pageParam = Number.parseInt(searchParams.get("page") ?? String(DEFAULT_PAGE), 10);
  const page = Number.isNaN(pageParam) || pageParam < 1 ? DEFAULT_PAGE : pageParam;

  try {
    // Run text and/or semantic search based on mode
    const [textResults, semanticResults] = await Promise.all([
      mode !== "semantic" ? textSearch(q) : Promise.resolve([] as SearchResult[]),
      mode !== "text" ? semanticSearch(q, limit) : Promise.resolve([] as SearchResult[]),
    ]);

    // Merge and sort
    const merged = mergeResults(textResults, semanticResults);

    // Apply pagination (text-only / hybrid results only)
    const offset = (page - 1) * limit;
    const paginated = merged.slice(offset, offset + limit);
    const total = merged.length;

    // Guard: empty result set — skip DB fetch if no IDs
    if (paginated.length === 0) {
      return NextResponse.json({
        results: [],
        query: q,
        mode,
        total: 0,
      });
    }

    // Fetch full photo rows for merged IDs only
    const ids = paginated.map((r) => r.id);
    const photoRows = await dbClient.db.select().from(photos).where(inArray(photos.id, ids));

    // Join scores back onto rows
    const scoreMap = new Map(paginated.map((r) => [r.id, r]));
    const photoMap = new Map<string, PhotoRow>(photoRows.map((p) => [p.id, p]));

    const results: ResponseResult[] = ids
      .map((id) => {
        const photo = photoMap.get(id);
        const searchResult = scoreMap.get(id);
        if (!photo || !searchResult) return null;
        return {
          id: photo.id,
          filenameFinal: photo.filenameFinal ?? null,
          libraryPath: photo.libraryPath ?? null,
          dateTaken: photo.dateTaken ?? null,
          city: photo.city ?? null,
          country: photo.country ?? null,
          width: photo.width ?? null,
          height: photo.height ?? null,
          faceCount: photo.faceCount ?? 0,
          score: searchResult.score,
          matchSource: searchResult.matchSource,
        };
      })
      .filter((r): r is ResponseResult => r !== null);

    return NextResponse.json({
      results,
      query: q,
      mode,
      total,
    });
  } catch (err) {
    console.error("[search] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
