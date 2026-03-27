"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhotoRow {
  id: string;
  filenameFinal: string | null;
  libraryPath: string | null;
  dateTaken: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  width: number | null;
  height: number | null;
  fileSize: number | null;
  isMeme: boolean;
  faceCount: number;
  clipIndexed: boolean;
  status: string;
  createdAt: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

interface PhotosResponse {
  photos: PhotoRow[];
  pagination: Pagination;
}

interface FaceDetail {
  id: string;
  clusterId: string | null;
  clusterLabel: string | null;
  bboxX: number | null;
  bboxY: number | null;
  bboxW: number | null;
  bboxH: number | null;
  detScore: number | null;
}

interface PhotoDetail {
  id: string;
  filenameFinal: string | null;
  dateTaken: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  width: number | null;
  height: number | null;
  fileSize: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
  isMeme: boolean;
  faceCount: number;
  clipIndexed: boolean;
  status: string;
  createdAt: number;
}

interface PhotoDetailResponse {
  photo: PhotoDetail;
  faces: FaceDetail[];
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

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function locationLabel(photo: PhotoRow | PhotoDetail): string {
  const parts = [photo.city, photo.country].filter(Boolean);
  return parts.join(", ") || "";
}

// ─── Photo detail dialog ───────────────────────────────────────────────────────

function PhotoDetailDialog({
  photoId,
  open,
  onClose,
}: {
  photoId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<PhotoDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (!photoId || !open) {
      setDetail(null);
      setImgError(false);
      return;
    }

    setLoading(true);
    setImgError(false);
    fetch(`/api/photos/${photoId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`API error ${res.status}`);
        return res.json() as Promise<PhotoDetailResponse>;
      })
      .then((data) => {
        setDetail(data);
      })
      .catch((err) => {
        console.error("[PhotoDetailDialog] fetch error:", err);
      })
      .finally(() => setLoading(false));
  }, [photoId, open]);

  const photo = detail?.photo ?? null;
  const faces = detail?.faces ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="max-w-4xl w-full max-h-[90vh] overflow-y-auto p-0">
        <div className="flex flex-col md:flex-row h-full">
          {/* Left: large thumbnail */}
          <div className="relative flex-1 min-h-64 bg-zinc-900 flex items-center justify-center md:max-h-[90vh]">
            {loading && (
              <div className="flex items-center justify-center p-12 text-zinc-500">
                <span className="text-sm">Loading…</span>
              </div>
            )}
            {!loading && photoId && !imgError && (
              <Image
                src={`/api/thumbnails/${photoId}`}
                alt={photo?.filenameFinal ?? photoId}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-contain"
                onError={() => setImgError(true)}
              />
            )}
            {!loading && imgError && (
              <div className="flex flex-col items-center justify-center gap-2 text-zinc-500 p-12">
                <svg
                  className="h-12 w-12"
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
                <span className="text-sm">Preview unavailable</span>
              </div>
            )}
          </div>

          {/* Right: metadata panel */}
          <div className="w-full md:w-80 flex flex-col shrink-0 border-t md:border-t-0 md:border-l border-zinc-200 dark:border-zinc-800">
            <DialogHeader className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
              <DialogTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                {photo?.filenameFinal ?? (loading ? "Loading…" : "—")}
              </DialogTitle>
            </DialogHeader>

            {!loading && photo && (
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
                {/* Date */}
                <MetaRow label="Date" value={formatDate(photo.dateTaken)} />

                {/* Location */}
                {locationLabel(photo) && <MetaRow label="Location" value={locationLabel(photo)} />}

                {/* Camera */}
                {(photo.cameraMake ?? photo.cameraModel) && (
                  <MetaRow
                    label="Camera"
                    value={[photo.cameraMake, photo.cameraModel].filter(Boolean).join(" ")}
                  />
                )}

                {/* Dimensions */}
                {photo.width && photo.height && (
                  <MetaRow label="Dimensions" value={`${photo.width} × ${photo.height}`} />
                )}

                {/* File size */}
                {photo.fileSize && <MetaRow label="Size" value={formatSize(photo.fileSize)} />}

                {/* Face count */}
                <MetaRow
                  label="Faces"
                  value={photo.faceCount > 0 ? String(photo.faceCount) : "None"}
                />

                {/* GPS */}
                {photo.gpsLat != null && photo.gpsLon != null && (
                  <MetaRow
                    label="GPS"
                    value={`${photo.gpsLat.toFixed(4)}, ${photo.gpsLon.toFixed(4)}`}
                  />
                )}

                {/* Status */}
                <MetaRow label="Status" value={photo.status} />

                {/* Faces list */}
                {faces.length > 0 && (
                  <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
                      People
                    </p>
                    <ul className="space-y-1">
                      {faces.map((face) => (
                        <li
                          key={face.id}
                          className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200"
                        >
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 text-xs font-medium">
                            {(face.clusterLabel ?? "?")[0].toUpperCase()}
                          </span>
                          <span>{face.clusterLabel ?? "Unknown"}</span>
                          {face.detScore != null && (
                            <span className="ml-auto text-xs text-zinc-400">
                              {(face.detScore * 100).toFixed(0)}%
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {loading && (
              <div className="flex-1 flex items-center justify-center p-8 text-zinc-400">
                <span className="text-sm">Loading metadata…</span>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-zinc-500 dark:text-zinc-400 shrink-0">{label}</span>
      <span className="text-right text-zinc-800 dark:text-zinc-200 truncate">{value}</span>
    </div>
  );
}

// ─── Photo card ───────────────────────────────────────────────────────────────

function PhotoCard({ photo, onClick }: { photo: PhotoRow; onClick: () => void }) {
  const [imgError, setImgError] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 cursor-pointer text-left"
    >
      {/* Thumbnail */}
      <div className="relative aspect-square w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        {!imgError ? (
          <Image
            src={`/api/thumbnails/${photo.id}`}
            alt={photo.filenameFinal ?? photo.id}
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
      </div>

      {/* Metadata */}
      <div className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
        <p className="font-medium text-zinc-800 dark:text-zinc-200">
          {formatDate(photo.dateTaken)}
        </p>
        {locationLabel(photo) && <p className="truncate">{locationLabel(photo)}</p>}
        <div className="mt-1 flex items-center gap-2 text-zinc-400 dark:text-zinc-500">
          {photo.width && photo.height && (
            <span>
              {photo.width}×{photo.height}
            </span>
          )}
          {photo.fileSize && <span>{formatSize(photo.fileSize)}</span>}
          {photo.faceCount > 0 && (
            <span>
              {photo.faceCount} {photo.faceCount === 1 ? "face" : "faces"}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Gallery page ─────────────────────────────────────────────────────────────

const LIMIT = 48;

export default function GalleryPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PhotosResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/photos?page=${p}&limit=${LIMIT}&status=DONE`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const json = (await res.json()) as PhotosResponse;
      setData(json);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load photos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  return (
    <div>
      {/* Header row */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Gallery</h1>
          {data && (
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              {data.pagination.total.toLocaleString()} photos
            </p>
          )}
        </div>
        <Link
          href="/search"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Search
        </Link>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-24 text-zinc-400 dark:text-zinc-600">
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && data?.photos.length === 0 && (
        <div className="py-24 text-center text-sm text-zinc-400 dark:text-zinc-600">
          No photos yet. Run the daemon to start processing.
        </div>
      )}

      {/* Photo grid */}
      {!loading && !error && data && data.photos.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {data.photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                onClick={() => setSelectedPhotoId(photo.id)}
              />
            ))}
          </div>

          {/* Pagination */}
          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => fetchPage(page - 1)}
              disabled={page <= 1 || loading}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Previous
            </button>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              Page {page} of {Math.max(1, Math.ceil(data.pagination.total / LIMIT))}
            </span>
            <button
              type="button"
              onClick={() => fetchPage(page + 1)}
              disabled={!data.pagination.hasMore || loading}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Next
            </button>
          </div>
        </>
      )}

      {/* Photo detail dialog */}
      <PhotoDetailDialog
        photoId={selectedPhotoId}
        open={selectedPhotoId !== null}
        onClose={() => setSelectedPhotoId(null)}
      />
    </div>
  );
}
