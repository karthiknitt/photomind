"""Thumbnail generation service for PhotoMind.

Generates a 400px (longest side) JPEG thumbnail from a source image.
Aspect ratio is always preserved; images smaller than 400px are never upscaled.
EXIF data is stripped from thumbnails (privacy + file size).
RGBA and palette-mode images are converted to RGB before saving as JPEG.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from PIL import Image, UnidentifiedImageError

logger = logging.getLogger(__name__)

THUMBNAIL_SIZE = 400  # longest side in pixels
THUMBNAIL_QUALITY = 85  # JPEG quality

# photo_id must contain only safe characters — no path separators or traversal
_SAFE_PHOTO_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def _validate_photo_id(photo_id: str) -> None:
    """Raise ValueError if photo_id contains unsafe characters."""
    if not _SAFE_PHOTO_ID.match(photo_id):
        raise ValueError(f"Invalid photo_id {photo_id!r}: must match [A-Za-z0-9_-]+")


def generate_thumbnail(
    src_path: str | Path,
    dest_dir: str | Path,
    photo_id: str,
) -> Path:
    """Generate a 400px (longest side) JPEG thumbnail for a photo.

    - Preserves aspect ratio using Pillow's thumbnail() method
    - Converts RGBA/P mode images to RGB before saving as JPEG
    - Strips EXIF from thumbnail (privacy + size)
    - Saves as: <dest_dir>/<photo_id>.jpg
    - Creates dest_dir if it doesn't exist

    Args:
        src_path: path to the source image
        dest_dir: directory to save the thumbnail in
        photo_id: UUID used as the thumbnail filename stem

    Returns:
        Path to the saved thumbnail file

    Raises:
        FileNotFoundError: if src_path does not exist
        ValueError: if the file cannot be opened as an image
    """
    _validate_photo_id(photo_id)

    src_path = Path(src_path)
    dest_dir = Path(dest_dir)

    if not src_path.exists():
        raise FileNotFoundError(f"Source image not found: {src_path}")

    try:
        img = Image.open(src_path)
        img.load()  # force decode so corrupt files are caught here
    except UnidentifiedImageError as exc:
        raise ValueError(f"Cannot open {src_path} as an image: {exc}") from exc

    # thumbnail() modifies in-place and never upscales — perfect behaviour
    img.thumbnail((THUMBNAIL_SIZE, THUMBNAIL_SIZE), Image.LANCZOS)

    # JPEG does not support alpha or palette modes
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    elif img.mode != "RGB":
        img = img.convert("RGB")

    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / f"{photo_id}.jpg"

    # Save without EXIF (Pillow omits EXIF by default when not passed exif= kwarg)
    img.save(str(dest_path), "JPEG", quality=THUMBNAIL_QUALITY, optimize=True)

    logger.debug("Thumbnail saved: %s (from %s)", dest_path, src_path)
    return dest_path


def thumbnail_path(dest_dir: str | Path, photo_id: str) -> Path:
    """Return the expected thumbnail path without generating it."""
    _validate_photo_id(photo_id)
    return Path(dest_dir) / f"{photo_id}.jpg"
