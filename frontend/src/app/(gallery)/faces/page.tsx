"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClusterRow {
  id: string;
  label: string | null;
  photoCount: number;
  createdAt: number;
  representativePhotoId: string | null;
}

interface ClustersResponse {
  clusters: ClusterRow[];
  total: number;
}

// ─── Inline label editor ──────────────────────────────────────────────────────

interface LabelEditorProps {
  clusterId: string;
  initialLabel: string | null;
  index: number;
  onSaved: (id: string, newLabel: string | null) => void;
}

function LabelEditor({ clusterId, initialLabel, index, onSaved }: LabelEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialLabel ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayLabel = initialLabel ?? `Unknown #${index + 1}`;

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/faces/clusters/${clusterId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: value }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const newLabel = value === "" ? null : value;
      onSaved(clusterId, newLabel);
      setEditing(false);
    } catch {
      // keep editor open on error
    } finally {
      setSaving(false);
    }
  }, [clusterId, value, onSaved]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") handleSave();
      if (e.key === "Escape") {
        setValue(initialLabel ?? "");
        setEditing(false);
      }
    },
    [handleSave, initialLabel]
  );

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={100}
          className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
          placeholder="Enter name…"
          disabled={saving}
          aria-label="Edit cluster label"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="shrink-0 rounded bg-blue-600 px-1.5 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(initialLabel ?? "");
            setEditing(false);
          }}
          disabled={saving}
          className="shrink-0 rounded px-1 py-0.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="w-full truncate text-left text-xs font-medium text-zinc-800 hover:text-blue-600 dark:text-zinc-200 dark:hover:text-blue-400"
      title="Click to edit name"
    >
      {displayLabel}
    </button>
  );
}

// ─── Cluster card ─────────────────────────────────────────────────────────────

interface ClusterCardProps {
  cluster: ClusterRow;
  index: number;
  onLabelSaved: (id: string, newLabel: string | null) => void;
}

function ClusterCard({ cluster, index, onLabelSaved }: ClusterCardProps) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="group overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      {/* Thumbnail — clicking navigates to cluster detail */}
      <Link href={`/faces/${cluster.id}`} className="block">
        <div className="relative aspect-square w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
          {cluster.representativePhotoId && !imgError ? (
            <Image
              src={`/api/thumbnails/${cluster.representativePhotoId}`}
              alt={cluster.label ?? `Face cluster ${index + 1}`}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
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
                  d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                />
              </svg>
            </div>
          )}
        </div>
      </Link>

      {/* Label + count */}
      <div className="px-2 py-2">
        <LabelEditor
          clusterId={cluster.id}
          initialLabel={cluster.label}
          index={index}
          onSaved={onLabelSaved}
        />
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
          {cluster.photoCount.toLocaleString()} {cluster.photoCount === 1 ? "photo" : "photos"}
        </p>
      </div>
    </div>
  );
}

// ─── Faces page ───────────────────────────────────────────────────────────────

export default function FacesPage() {
  const [data, setData] = useState<ClustersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/faces/clusters")
      .then((res) => {
        if (!res.ok) throw new Error(`API error ${res.status}`);
        return res.json() as Promise<ClustersResponse>;
      })
      .then((json) => setData(json))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load faces"))
      .finally(() => setLoading(false));
  }, []);

  const handleLabelSaved = useCallback((id: string, newLabel: string | null) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        clusters: prev.clusters.map((c) => (c.id === id ? { ...c, label: newLabel } : c)),
      };
    });
  }, []);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Faces</h1>
        {data && (
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {data.total.toLocaleString()} {data.total === 1 ? "person" : "people"} detected
          </p>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-24 text-zinc-400 dark:text-zinc-600">
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && data?.clusters.length === 0 && (
        <div className="py-24 text-center text-sm text-zinc-400 dark:text-zinc-600">
          No faces detected yet. Run the pipeline to detect faces.
        </div>
      )}

      {/* Cluster grid */}
      {!loading && !error && data && data.clusters.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {data.clusters.map((cluster, i) => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              index={i}
              onLabelSaved={handleLabelSaved}
            />
          ))}
        </div>
      )}
    </div>
  );
}
