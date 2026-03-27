"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardStats {
  total: number;
  done: number;
  queued: number;
  processing: number;
  error: number;
  memes: number;
  faces: number;
  faceClusters: number;
  clipIndexed: number;
  totalSizeBytes: number | null;
}

interface ActivityEntry {
  id: string;
  photoId: string | null;
  action: string;
  detail: string | null;
  timestamp: number;
}

interface DashboardData {
  stats: DashboardStats;
  recentActivity: ActivityEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(1)} ${units[unit]}`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function truncate(str: string | null, max: number): string {
  if (!str) return "—";
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

// ─── Action badge colours ─────────────────────────────────────────────────────

const ACTION_COLOURS: Record<string, string> = {
  COPIED: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  INDEXED: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  FACE_DETECTED: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  CLUSTER_UPDATED: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  SKIPPED_DUPLICATE: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  SKIPPED_MEME: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  SKIPPED_ERROR: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

function actionBadgeClass(action: string): string {
  return ACTION_COLOURS[action] ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  highlight?: "red" | "yellow" | "none";
}

function StatCard({ label, value, highlight = "none" }: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 px-5 py-4 shadow-sm",
        highlight === "red" && Number(value) > 0
          ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30"
          : "",
        highlight === "yellow" && Number(value) > 0
          ? "border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30"
          : ""
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          highlight === "red" && Number(value) > 0 ? "text-red-600 dark:text-red-400" : "",
          highlight === "yellow" && Number(value) > 0 ? "text-yellow-600 dark:text-yellow-400" : "",
          highlight === "none" ? "text-zinc-900 dark:text-zinc-50" : ""
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ─── Pipeline Health Bar ──────────────────────────────────────────────────────

function PipelineBar({ stats }: { stats: DashboardStats }) {
  const { total, done, queued, processing, error } = stats;

  if (total === 0) {
    return (
      <div className="h-4 rounded-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full w-full bg-zinc-200 dark:bg-zinc-700 rounded-full" />
      </div>
    );
  }

  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;

  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        {done > 0 && (
          <div
            className="h-full bg-green-500 transition-all"
            style={{ width: pct(done) }}
            title={`Done: ${done} (${pct(done)})`}
          />
        )}
        {queued > 0 && (
          <div
            className="h-full bg-yellow-400 transition-all"
            style={{ width: pct(queued) }}
            title={`Queued: ${queued} (${pct(queued)})`}
          />
        )}
        {processing > 0 && (
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: pct(processing) }}
            title={`Processing: ${processing} (${pct(processing)})`}
          />
        )}
        {error > 0 && (
          <div
            className="h-full bg-red-500 transition-all"
            style={{ width: pct(error) }}
            title={`Error: ${error} (${pct(error)})`}
          />
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-full bg-green-500" />
          Done {done}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-full bg-yellow-400" />
          Queued {queued}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-full bg-blue-500" />
          Processing {processing}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-full bg-red-500" />
          Error {error}
        </span>
      </div>
    </div>
  );
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">No activity yet.</p>
    );
  }

  return (
    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-start gap-3 py-3 text-sm">
          <span className="mt-0.5 shrink-0 font-mono text-xs text-zinc-400 dark:text-zinc-500 tabular-nums w-36">
            {formatTimestamp(entry.timestamp)}
          </span>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium",
              actionBadgeClass(entry.action)
            )}
          >
            {entry.action}
          </span>
          <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">
            {truncate(entry.detail, 80)}
          </span>
          {entry.photoId && (
            <span className="shrink-0 font-mono text-xs text-zinc-400 dark:text-zinc-500">
              {entry.photoId.slice(0, 8)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const json = (await res.json()) as DashboardData;
      setData(json);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ── Empty state ──
  if (!loading && !error && data?.stats.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-4xl">📷</p>
        <h2 className="mt-4 text-lg font-semibold text-zinc-800 dark:text-zinc-100">
          No photos processed yet
        </h2>
        <p className="mt-2 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          The pipeline will start scanning when the daemon runs.
        </p>
        <button
          type="button"
          onClick={fetchData}
          className="mt-6 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          Refresh
        </button>
      </div>
    );
  }

  const stats = data?.stats ?? {
    total: 0,
    done: 0,
    queued: 0,
    processing: 0,
    error: 0,
    memes: 0,
    faces: 0,
    faceClusters: 0,
    clipIndexed: 0,
    totalSizeBytes: null,
  };

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Processing Dashboard
          </h1>
          {lastRefreshed && (
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              Last refreshed {lastRefreshed.toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={fetchData}
          disabled={loading}
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          Failed to load dashboard data: {error}
        </div>
      )}

      {/* ── Section 1: Library overview stat cards ── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Library Overview
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Total Photos" value={stats.total.toLocaleString()} />
          <StatCard label="Processed" value={stats.done.toLocaleString()} />
          <StatCard label="Queued" value={stats.queued.toLocaleString()} highlight="yellow" />
          <StatCard label="Errors" value={stats.error.toLocaleString()} highlight="red" />
          <StatCard label="Memes Filtered" value={stats.memes.toLocaleString()} />
          <StatCard label="Faces Detected" value={stats.faces.toLocaleString()} />
          <StatCard label="Face Clusters" value={stats.faceClusters.toLocaleString()} />
          <StatCard label="CLIP Indexed" value={stats.clipIndexed.toLocaleString()} />
          <StatCard label="Library Size" value={formatBytes(stats.totalSizeBytes)} />
        </div>
      </section>

      {/* ── Section 2: Pipeline health bar ── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Pipeline Health
        </h2>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4 shadow-sm">
          <PipelineBar stats={stats} />
        </div>
      </section>

      {/* ── Section 3: Recent activity feed ── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Recent Activity
        </h2>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 shadow-sm max-h-[480px] overflow-y-auto">
          <ActivityFeed entries={data?.recentActivity ?? []} />
        </div>
      </section>
    </div>
  );
}
