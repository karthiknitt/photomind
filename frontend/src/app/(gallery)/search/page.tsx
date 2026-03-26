"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "text" | "semantic" | "hybrid";

interface SearchResult {
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
  matchSource: "text" | "semantic" | "hybrid";
}

interface SearchResponse {
  results: SearchResult[];
  query: string;
  mode: Mode;
  total: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const SOURCE_STYLES: Record<string, string> = {
  text: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  semantic: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  hybrid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

// ─── Result card ──────────────────────────────────────────────────────────────

function ResultCard({ result }: { result: SearchResult }) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="group overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      {/* Thumbnail */}
      <div className="relative aspect-square w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        {!imgError ? (
          <Image
            src={`/api/thumbnails/${result.id}`}
            alt={result.filenameFinal ?? result.id}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover transition-transform group-hover:scale-105"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-400 dark:text-zinc-600">
            <svg
              className="h-10 w-10"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3l18 18"
              />
            </svg>
          </div>
        )}

        {/* Score badge */}
        <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {(result.score * 100).toFixed(0)}%
        </div>
      </div>

      {/* Metadata */}
      <div className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
        <p className="font-medium text-zinc-800 dark:text-zinc-200">
          {formatDate(result.dateTaken)}
        </p>
        {(result.city || result.country) && (
          <p className="truncate">{[result.city, result.country].filter(Boolean).join(", ")}</p>
        )}
        <span
          className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_STYLES[result.matchSource]}`}
        >
          {result.matchSource}
        </span>
      </div>
    </div>
  );
}

// ─── Search page ──────────────────────────────────────────────────────────────

const MODES: { value: Mode; label: string }[] = [
  { value: "hybrid", label: "Hybrid" },
  { value: "semantic", label: "Semantic" },
  { value: "text", label: "Text" },
];

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("hybrid");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (q: string, m: Mode, signal: AbortSignal) => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&mode=${m}&limit=48`, {
        signal,
      });
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const json = (await res.json()) as SearchResponse;
      setResults(json);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return; // stale request — ignore
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce 400ms; abort any in-flight request when query/mode changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      runSearch(query, mode, abortRef.current.signal);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [query, mode, runSearch]);

  return (
    <div>
      {/* Search header */}
      <div className="mb-6">
        <h1 className="mb-4 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Search</h1>

        {/* Search bar + mode selector */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search photos by location, scene, or description…"
              className="w-full rounded-lg border border-zinc-300 bg-white py-2.5 pl-9 pr-4 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm transition focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
              aria-label="Search query"
            />
          </div>

          {/* Mode selector */}
          <div className="flex overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
            {MODES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  mode === value
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* States */}
      {!query.trim() && (
        <div className="py-24 text-center text-sm text-zinc-400 dark:text-zinc-600">
          Type to search across your photo library
        </div>
      )}

      {loading && (
        <div className="py-24 text-center text-sm text-zinc-400 dark:text-zinc-600">Searching…</div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {!loading && !error && results && results.results.length === 0 && (
        <div className="py-24 text-center text-sm text-zinc-400 dark:text-zinc-600">
          No results for &ldquo;{results.query}&rdquo;
        </div>
      )}

      {!loading && !error && results && results.results.length > 0 && (
        <>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            {results.total} result{results.total !== 1 ? "s" : ""} for &ldquo;{results.query}&rdquo;
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {results.results.map((result) => (
              <ResultCard key={result.id} result={result} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
