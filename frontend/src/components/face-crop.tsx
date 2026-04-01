"use client";

import { useState } from "react";

// ─── Shared FaceCrop component ────────────────────────────────────────────────
// Renders a face bbox cropped from its photo thumbnail using CSS translate.
// Thumbnail is max 400px longest side; bbox coords are scaled accordingly.
// The face is centered in the tile so it looks correct regardless of size.
//
// Usage modes:
//   - Interactive (split/select): pass selected + onToggle
//   - Display-only (wizard comparison): omit selected/onToggle

export const CROP_PX = 88; // display size of each face crop tile

export interface FaceRow {
  id: string;
  photoId: string;
  bboxX: number | null;
  bboxY: number | null;
  bboxW: number | null;
  bboxH: number | null;
  detScore: number | null;
  photoWidth: number | null;
  photoHeight: number | null;
}

interface FaceCropProps {
  face: FaceRow;
  selected?: boolean;
  onToggle?: () => void;
  size?: number; // override tile size (defaults to CROP_PX)
}

export function FaceCrop({ face, selected = false, onToggle, size = CROP_PX }: FaceCropProps) {
  const [imgError, setImgError] = useState(false);

  const photoW = face.photoWidth ?? 400;
  const photoH = face.photoHeight ?? 400;
  const scale = Math.min(1, Math.min(400 / photoW, 400 / photoH));
  const thumbW = photoW * scale;
  const thumbH = photoH * scale;
  const bx = (face.bboxX ?? 0) * scale;
  const by = (face.bboxY ?? 0) * scale;
  const bw = Math.max(1, (face.bboxW ?? 80) * scale);
  const bh = Math.max(1, (face.bboxH ?? 80) * scale);
  const zoom = size / Math.max(bw, bh);

  // Center the face midpoint in the tile
  const imgLeft = size / 2 - (bx + bw / 2) * zoom;
  const imgTop = size / 2 - (by + bh / 2) * zoom;

  const interactive = onToggle !== undefined;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!interactive}
      className={`relative overflow-hidden rounded-lg border-2 bg-zinc-100 transition-all dark:bg-zinc-800 ${
        interactive
          ? selected
            ? "border-blue-500 ring-2 ring-blue-400 ring-offset-1"
            : "border-transparent hover:border-zinc-400"
          : "cursor-default border-transparent"
      }`}
      style={{ width: size, height: size }}
      title={interactive ? "Click to select" : undefined}
    >
      {imgError ? (
        /* Fallback: face silhouette */
        <div className="flex h-full w-full items-center justify-center text-zinc-400 dark:text-zinc-600">
          <svg
            className="h-1/2 w-1/2"
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
      ) : (
        /* biome-ignore lint/performance/noImgElement: face crop requires CSS sub-pixel translation not compatible with next/image wrapper */
        <img
          src={`/api/thumbnails/${face.photoId}`}
          alt=""
          onError={() => setImgError(true)}
          style={{
            position: "absolute",
            width: thumbW * zoom,
            height: thumbH * zoom,
            left: imgLeft,
            top: imgTop,
            pointerEvents: "none",
          }}
        />
      )}
      {selected && interactive && (
        <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500">
          <svg
            className="h-3 w-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
    </button>
  );
}
