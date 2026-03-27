"use client";

import Image from "next/image";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClusterRow {
  id: string;
  label: string | null;
  photoCount: number;
  createdAt: number;
}

interface PhotoRow {
  id: string;
  filenameFinal: string | null;
  dateTaken: number | null;
  city: string | null;
  country: string | null;
  width: number | null;
  height: number | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

interface ClusterPhotosResponse {
  photos: PhotoRow[];
  pagination: Pagination;
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

function locationLabel(photo: PhotoRow): string {
  const parts = [photo.city, photo.country].filter(Boolean);
  return parts.join(", ") || "";
}

// ─── Inline label editor ──────────────────────────────────────────────────────

interface LabelEditorProps {
  clusterId: string;
  initialLabel: string | null;
  onSaved: (newLabel: string | null) => void;
}

function LabelEditor({ clusterId, initialLabel, onSaved }: LabelEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialLabel ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(initialLabel ?? "");
  }, [initialLabel]);

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
      onSaved(newLabel);
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
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={100}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-lg font-semibold text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
          placeholder="Enter name…"
          disabled={saving}
          aria-label="Edit cluster label"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(initialLabel ?? "");
            setEditing(false);
          }}
          disabled={saving}
          className="rounded px-2 py-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex items-center gap-2"
      title="Click to edit name"
    >
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {initialLabel ?? "Unknown"}
      </h1>
      <span className="text-sm text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 dark:text-zinc-600">
        Edit
      </span>
    </button>
  );
}

// ─── Photo card ───────────────────────────────────────────────────────────────

function PhotoCard({ photo }: { photo: PhotoRow }) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="group overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <div className="relative aspect-square w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        {!imgError ? (
          <Image
            src={`/api/thumbnails/${photo.id}`}
            alt={photo.filenameFinal ?? photo.id}
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
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3l18 18"
              />
            </svg>
          </div>
        )}
      </div>
      <div className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
        <p className="font-medium text-zinc-800 dark:text-zinc-200">
          {formatDate(photo.dateTaken)}
        </p>
        {locationLabel(photo) && <p className="truncate">{locationLabel(photo)}</p>}
      </div>
    </div>
  );
}

// ─── Cluster detail page ──────────────────────────────────────────────────────

const LIMIT = 48;

export default function FaceClusterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [cluster, setCluster] = useState<ClusterRow | null>(null);
  const [photosData, setPhotosData] = useState<ClusterPhotosResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loadingCluster, setLoadingCluster] = useState(true);
  const [loadingPhotos, setLoadingPhotos] = useState(true);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const [photosError, setPhotosError] = useState<string | null>(null);

  // Fetch cluster info
  useEffect(() => {
    setLoadingCluster(true);
    setClusterError(null);
    fetch(`/api/faces/clusters`)
      .then((res) => {
        if (!res.ok) throw new Error(`API error ${res.status}`);
        return res.json() as Promise<{ clusters: ClusterRow[]; total: number }>;
      })
      .then((json) => {
        const found = json.clusters.find((c) => c.id === id);
        if (!found) throw new Error("Cluster not found");
        setCluster(found);
      })
      .catch((e) => setClusterError(e instanceof Error ? e.message : "Failed to load cluster"))
      .finally(() => setLoadingCluster(false));
  }, [id]);

  // Fetch photos for this cluster
  const fetchPhotos = useCallback(
    (p: number) => {
      setLoadingPhotos(true);
      setPhotosError(null);
      fetch(`/api/faces/clusters/${id}/photos?page=${p}&limit=${LIMIT}`)
        .then((res) => {
          if (!res.ok) throw new Error(`API error ${res.status}`);
          return res.json() as Promise<ClusterPhotosResponse>;
        })
        .then((json) => {
          setPhotosData(json);
          setPage(p);
        })
        .catch((e) => setPhotosError(e instanceof Error ? e.message : "Failed to load photos"))
        .finally(() => setLoadingPhotos(false));
    },
    [id]
  );

  useEffect(() => {
    fetchPhotos(1);
  }, [fetchPhotos]);

  const handleLabelSaved = useCallback((newLabel: string | null) => {
    setCluster((prev) => (prev ? { ...prev, label: newLabel } : prev));
  }, []);

  const isLoading = loadingCluster || loadingPhotos;
  const error = clusterError ?? photosError;

  return (
    <div>
      {/* Back link */}
      <Link
        href="/faces"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        ← Back to Faces
      </Link>

      {/* Header */}
      <div className="mb-6 mt-2">
        {loadingCluster ? (
          <div className="h-8 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        ) : cluster ? (
          <LabelEditor clusterId={id} initialLabel={cluster.label} onSaved={handleLabelSaved} />
        ) : null}
        {cluster && (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {cluster.photoCount.toLocaleString()} {cluster.photoCount === 1 ? "photo" : "photos"}
          </p>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-24 text-zinc-400 dark:text-zinc-600">
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && photosData?.photos.length === 0 && (
        <div className="py-24 text-center text-sm text-zinc-400 dark:text-zinc-600">
          No photos found for this person.
        </div>
      )}

      {/* Photo grid */}
      {!isLoading && !error && photosData && photosData.photos.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {photosData.photos.map((photo) => (
              <PhotoCard key={photo.id} photo={photo} />
            ))}
          </div>

          {/* Pagination */}
          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => fetchPhotos(page - 1)}
              disabled={page <= 1 || loadingPhotos}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Previous
            </button>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              Page {page} of {Math.max(1, Math.ceil((photosData.pagination.total ?? 0) / LIMIT))}
            </span>
            <button
              type="button"
              onClick={() => fetchPhotos(page + 1)}
              disabled={!photosData.pagination.hasMore || loadingPhotos}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
