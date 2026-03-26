"""
Meme detection service for PhotoMind.

Classifies an image as a "meme/forward" using six signals:

  HIGH   (fires alone):
    1. CLIP zero-shot top-3 labels contain "meme", "text overlay",
       or "screenshot"  [optional — Phase 2; pass clip_labels=None to skip]

  MEDIUM (need ≥2 medium/low):
    2. EXIF software field contains "whatsapp" (case-insensitive)
       NOTE: downgraded from HIGH — many real family photos are shared via
       WhatsApp and carry this tag. Alone it is no longer sufficient.
    3. Filename matches a WhatsApp file-naming pattern
       (IMG-YYYYMMDD-WA####.*  |  VID-YYYYMMDD-WA####.*  |  "WhatsApp Image …")
    4. Aspect ratio matches 9:16, 1:1, or 16:9 within ±2% tolerance
    5. No EXIF date present

  LOW    (counts toward medium/low total):
    6. File size < 150 KB when the longest image side > 500 px

Decision: is_meme = True  if any HIGH signal fires
                          OR the count of medium+low signals ≥ 2
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

# Aspect ratios considered "meme-like": (width/height target, label)
_MEME_RATIOS: list[tuple[float, str]] = [
    (9 / 16, "9:16"),
    (1 / 1, "1:1"),
    (16 / 9, "16:9"),
]
_RATIO_TOLERANCE = 0.02  # ±2%

_CLIP_MEME_LABELS = {"meme", "text overlay", "screenshot"}
_FILE_SIZE_THRESHOLD = 150_000  # bytes (< 150 KB)
_MIN_SIDE_FOR_SIZE_SIGNAL = 500  # px

# WhatsApp file-naming conventions:
#   IMG-20240101-WA0001.jpg  (saved from Android WhatsApp)
#   VID-20240101-WA0001.mp4  (video saved from WhatsApp)
#   WhatsApp Image 2024-01-01 at 14.35.22.jpeg  (downloaded on some platforms)
_WHATSAPP_FILENAME_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"IMG-\d{8}-WA\d+\.", re.IGNORECASE),
    re.compile(r"VID-\d{8}-WA\d+\.", re.IGNORECASE),
    re.compile(r"WhatsApp\s+(?:Image|Video|Audio)\s+\d{4}-\d{2}-\d{2}", re.IGNORECASE),
]


@dataclass
class MemeCheckResult:
    """Result of a meme detection check."""

    is_meme: bool
    reasons: list[str] = field(default_factory=list)


def _check_whatsapp_software(software: str | None) -> str | None:
    """Return a reason string if software contains 'whatsapp', else None.

    MEDIUM signal — a second corroborating signal is required for meme classification.
    """
    if software and "whatsapp" in software.lower():
        return f"whatsapp software field: {software!r}"
    return None


def _check_whatsapp_filename(filename: str | None) -> str | None:
    """Return a reason string if filename matches a WhatsApp naming pattern.

    Accepts a full path or bare filename — only the basename is tested.
    MEDIUM signal — a second corroborating signal is required.
    """
    if not filename:
        return None
    name = Path(filename).name
    for pattern in _WHATSAPP_FILENAME_PATTERNS:
        if pattern.search(name):
            return f"WhatsApp filename pattern: {name!r}"
    return None


def _check_clip(clip_labels: list[str] | None) -> str | None:
    """Return a reason string if any of the top-3 CLIP labels is meme-like."""
    if clip_labels is None:
        return None
    for label in clip_labels[:3]:
        if label.lower() in _CLIP_MEME_LABELS:
            return f"clip label in top-3: {label!r}"
    return None


def _check_aspect_ratio(width: int | None, height: int | None) -> str | None:
    """Return a reason string if the aspect ratio is meme-like (±2%)."""
    if not width or not height:
        return None
    ratio = width / height
    for target, label in _MEME_RATIOS:
        if abs(ratio - target) / target <= _RATIO_TOLERANCE:
            return f"aspect ratio matches {label} (actual {ratio:.3f})"
    return None


def _check_no_exif_date(has_exif_date: bool) -> str | None:
    """Return a reason string when no EXIF date is present."""
    if not has_exif_date:
        return "no EXIF date"
    return None


def _check_file_size(
    file_size: int | None, width: int | None, height: int | None
) -> str | None:
    """Return a reason string when file is suspiciously small for its dimensions."""
    if file_size is None or width is None or height is None:
        return None
    longest = max(width, height)
    if longest > _MIN_SIDE_FOR_SIZE_SIGNAL and file_size < _FILE_SIZE_THRESHOLD:
        return (
            f"file size {file_size:,} B < 150 KB "
            f"for {longest}px image (likely compressed forward)"
        )
    return None


def check_meme(
    *,
    software: str | None = None,
    filename: str | None = None,
    has_exif_date: bool = True,
    width: int | None = None,
    height: int | None = None,
    file_size: int | None = None,
    clip_labels: list[str] | None = None,
) -> MemeCheckResult:
    """Classify an image as a meme/forward using six weighted signals.

    All parameters are keyword-only so callers can pass exactly the data
    they have without constructing a container.

    Args:
        software:      EXIF Software field (e.g. "WhatsApp 2.24.1"). None OK.
        filename:      Source filename or full path (basename is tested against
                       WhatsApp naming patterns). None skips this signal.
        has_exif_date: False if no date was found in EXIF.
        width:         Image width in pixels. None if unknown.
        height:        Image height in pixels. None if unknown.
        file_size:     File size in bytes. None if unknown.
        clip_labels:   Ordered CLIP zero-shot labels (Phase 2+). None skips.

    Returns:
        :class:`MemeCheckResult` with ``is_meme`` and ``reasons``.
    """
    high_reasons: list[str] = []
    medium_low_reasons: list[str] = []

    # HIGH signal (fires alone)
    if (r := _check_clip(clip_labels)) is not None:
        high_reasons.append(r)

    # MEDIUM signals (need ≥2 medium/low combined)
    if (r := _check_whatsapp_software(software)) is not None:
        medium_low_reasons.append(r)
    if (r := _check_whatsapp_filename(filename)) is not None:
        medium_low_reasons.append(r)
    if (r := _check_aspect_ratio(width, height)) is not None:
        medium_low_reasons.append(r)
    if (r := _check_no_exif_date(has_exif_date)) is not None:
        medium_low_reasons.append(r)

    # LOW signal
    if (r := _check_file_size(file_size, width, height)) is not None:
        medium_low_reasons.append(r)

    is_meme = bool(high_reasons) or len(medium_low_reasons) >= 2

    all_reasons = high_reasons + medium_low_reasons if is_meme else []

    if is_meme:
        logger.debug(
            "Meme detected — high=%d, medium_low=%d: %s",
            len(high_reasons),
            len(medium_low_reasons),
            "; ".join(all_reasons),
        )

    return MemeCheckResult(is_meme=is_meme, reasons=all_reasons)
