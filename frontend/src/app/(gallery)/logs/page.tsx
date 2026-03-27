"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionEnum =
  | "COPIED"
  | "SKIPPED_DUPLICATE"
  | "SKIPPED_MEME"
  | "SKIPPED_ERROR"
  | "INDEXED"
  | "FACE_DETECTED"
  | "CLUSTER_UPDATED";

interface LogRow {
  id: string;
  photoId: string | null;
  action: ActionEnum;
  detail: string | null;
  timestamp: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

interface LogsResponse {
  logs: LogRow[];
  pagination: Pagination;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ACTIONS: ActionEnum[] = [
  "COPIED",
  "SKIPPED_DUPLICATE",
  "SKIPPED_MEME",
  "SKIPPED_ERROR",
  "INDEXED",
  "FACE_DETECTED",
  "CLUSTER_UPDATED",
];

const ACTION_BADGE_CLASSES: Record<ActionEnum, string> = {
  COPIED:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
  SKIPPED_DUPLICATE:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
  SKIPPED_MEME:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
  SKIPPED_ERROR:
    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
  INDEXED:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  FACE_DETECTED:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800",
  CLUSTER_UPDATED:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800",
};

const LIMIT = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(unix: number): string {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function truncate(text: string | null, maxLen: number): string {
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

// ─── ActionBadge ─────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: ActionEnum }) {
  return (
    <Badge variant="outline" className={`text-xs font-medium ${ACTION_BADGE_CLASSES[action]}`}>
      {action}
    </Badge>
  );
}

// ─── LogsPage ─────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<ActionEnum | "ALL">("ALL");
  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
      });
      if (actionFilter !== "ALL") {
        params.set("action", actionFilter);
      }
      const res = await fetch(`/api/logs?${params.toString()}`);
      if (res.ok) {
        const json = (await res.json()) as LogsResponse;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  // Fetch on mount and whenever page/filter changes
  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh interval
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        void fetchLogs();
      }, 10_000);
    } else {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, fetchLogs]);

  function handleActionChange(value: string) {
    setActionFilter(value as ActionEnum | "ALL");
    setPage(1);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.pagination.total / LIMIT)) : 1;
  const isFirstPage = page === 1;
  const isLastPage = data ? !data.pagination.hasMore : true;

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Action Log
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Audit trail of pipeline actions — copy, index, dedup, face detection
          </p>
        </div>
        {/* Auto-refresh toggle */}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="h-4 w-4 accent-zinc-700 dark:accent-zinc-300"
          />
          Auto-refresh
        </label>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <Select value={actionFilter} onValueChange={handleActionChange}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All actions</SelectItem>
            {VALID_ACTIONS.map((action) => (
              <SelectItem key={action} value={action}>
                {action}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {loading && <span className="text-xs text-zinc-500 dark:text-zinc-400">Loading…</span>}
        {data && !loading && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {data.pagination.total.toLocaleString()} entries
          </span>
        )}
      </div>

      {/* Log table */}
      {data && data.logs.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No log entries yet. The pipeline hasn&apos;t run or no photos have been processed.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-200 dark:border-zinc-800">
                <TableHead className="w-44 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Timestamp
                </TableHead>
                <TableHead className="w-44 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Action
                </TableHead>
                <TableHead className="w-28 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Photo
                </TableHead>
                <TableHead className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Detail
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.logs ?? []).map((entry) => (
                <TableRow key={entry.id} className="border-zinc-100 dark:border-zinc-800">
                  <TableCell className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    {formatTimestamp(entry.timestamp)}
                  </TableCell>
                  <TableCell>
                    <ActionBadge action={entry.action} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {entry.photoId ? entry.photoId.slice(0, 8) : "—"}
                  </TableCell>
                  <TableCell
                    className="max-w-xs truncate text-xs text-zinc-600 dark:text-zinc-400"
                    title={entry.detail ?? undefined}
                  >
                    {truncate(entry.detail, 100)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination controls */}
      {data && data.pagination.total > 0 && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, data.pagination.total)} of{" "}
            {data.pagination.total.toLocaleString()}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isFirstPage}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={isLastPage}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
