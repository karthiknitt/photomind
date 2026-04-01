"use client";

// ─── Shared FaceCrop component ────────────────────────────────────────────────
// Renders a face bbox cropped from its photo thumbnail using CSS background-image.
// Thumbnail is max 400px longest side; bbox coords are scaled accordingly.
// The face is centered in the tile so it looks correct regardless of size.
//
// Uses background-image + background-size + background-position instead of an
// absolutely-positioned <img> — background images are always clipped to their
// element bounds without relying on overflow:hidden (which has cross-browser
// quirks on <button> elements for absolutely-positioned children).
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
  const bgX = size / 2 - (bx + bw / 2) * zoom;
  const bgY = size / 2 - (by + bh / 2) * zoom;

  const interactive = onToggle !== undefined;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!interactive}
      className={`relative rounded-lg border-2 transition-all ${
        interactive
          ? selected
            ? "border-blue-500 ring-2 ring-blue-400 ring-offset-1"
            : "border-transparent hover:border-zinc-400"
          : "cursor-default border-transparent"
      }`}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(/api/thumbnails/${face.photoId})`,
        backgroundSize: `${thumbW * zoom}px ${thumbH * zoom}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        backgroundRepeat: "no-repeat",
        backgroundColor: "rgb(39 39 42)", // zinc-800 fallback while loading
      }}
      title={interactive ? "Click to select" : undefined}
    >
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
