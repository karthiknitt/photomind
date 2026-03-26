"""
Rename service for PhotoMind.

Generates the final filename for a processed photo using this convention:

    YYYY-MM-DD_HHMMSS_[City]_[Person1-Person2]_[CameraModel]_[4chars].ext

Rules:
- 4-char salt = first 4 hex chars of the file's SHA256 (deterministic)
- Optional segments (city, persons, camera) are omitted when absent
- Missing date falls back to file mtime
- Extensions always lowercased
- Spaces → hyphens; non-alphanumeric/hyphen characters stripped
- Max 200 chars: drop camera model first, then city, then persons
- Collisions: append _v2, _v3, ... until unique
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_MAX_FILENAME_LEN = 200


@dataclass
class RenameResult:
    """Result of generating a final filename for a photo."""

    filename: str  # e.g. "2024-12-25_143022_Ooty_Karthik-Priya_iPhone14Pro_a3f2.jpg"


def _sha256_salt(file_path: Path) -> str:
    """Return the first 4 hex chars of the file's SHA256."""
    h = hashlib.sha256()
    with file_path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:4]


def _date_prefix(date_taken: int | None, file_path: Path) -> str:
    """Return YYYY-MM-DD_HHMMSS from date_taken (Unix ts UTC) or file mtime."""
    if date_taken is not None:
        ts = date_taken
    else:
        ts = int(file_path.stat().st_mtime)
        logger.debug(
            "No date_taken for %s — falling back to mtime %d", file_path.name, ts
        )
    dt = datetime.fromtimestamp(ts, tz=UTC)
    return dt.strftime("%Y-%m-%d_%H%M%S")


def _sanitize(value: str) -> str:
    """Strip special chars; spaces → hyphens. Keep alphanumerics and hyphens."""
    # Replace spaces with hyphens first
    value = value.replace(" ", "-")
    # Remove anything that isn't alphanumeric or hyphen
    value = re.sub(r"[^A-Za-z0-9\-]", "", value)
    # Collapse multiple hyphens
    value = re.sub(r"-{2,}", "-", value)
    return value.strip("-")


def _build_stem(
    date_prefix: str,
    salt: str,
    *,
    city: str | None,
    person_names: list[str] | None,
    camera_model: str | None,
) -> str:
    """Assemble the filename stem (without extension) from provided segments."""
    parts = [date_prefix]

    if city:
        sanitized = _sanitize(city)
        if sanitized:
            parts.append(sanitized)

    if person_names:
        names = [_sanitize(n) for n in person_names if n and _sanitize(n)]
        if names:
            parts.append("-".join(names))

    if camera_model:
        sanitized = _sanitize(camera_model)
        if sanitized:
            parts.append(sanitized)

    parts.append(salt)
    return "_".join(parts)


def _fits(stem: str, ext: str) -> bool:
    return len(stem + ext) <= _MAX_FILENAME_LEN


def _choose_stem(
    date_prefix: str,
    salt: str,
    *,
    city: str | None,
    person_names: list[str] | None,
    camera_model: str | None,
    ext: str,
) -> str:
    """Return a stem that fits within _MAX_FILENAME_LEN, dropping segments as needed."""
    # Try all segments, then progressively drop optional ones
    for cam, cit, pers in [
        (camera_model, city, person_names),  # all segments
        (None, city, person_names),  # drop camera first
        (None, None, person_names),  # drop city next
        (None, None, None),  # drop persons last — date+salt always kept
    ]:
        stem = _build_stem(
            date_prefix, salt, city=cit, person_names=pers, camera_model=cam
        )
        if _fits(stem, ext):
            if cam != camera_model or cit != city or pers != person_names:
                logger.debug(
                    "Truncated filename >200 chars (cam=%s city=%s pers=%s dropped)",
                    cam is None,
                    cit is None,
                    pers is None,
                )
            return stem
    # Fallback: minimal stem (date + salt), truncate if somehow still too long
    return _build_stem(
        date_prefix, salt, city=None, person_names=None, camera_model=None
    )


def _resolve_collision(base_stem: str, ext: str, existing: set[str]) -> str:
    """Return a unique filename, appending _v2/_v3/... if base already exists."""
    candidate = base_stem + ext
    if candidate not in existing:
        return candidate
    v = 2
    while True:
        candidate = f"{base_stem}_v{v}{ext}"
        if candidate not in existing:
            return candidate
        v += 1


def generate_filename(
    *,
    file_path: str | Path,
    date_taken: int | None,
    extension: str,
    city: str | None = None,
    camera_model: str | None = None,
    person_names: list[str] | None = None,
    existing_names: set[str] | None = None,
) -> RenameResult:
    """Generate the final filename for a processed photo.

    Args:
        file_path:      Path to the local file (used for SHA256 salt + mtime fallback).
        date_taken:     Unix timestamp UTC from EXIF, or None to fall back to mtime.
        extension:      File extension including dot (e.g. ".jpg" or "jpg").
                        Always normalized to lowercase.
        city:           City name from reverse geocoding. None or "" to omit.
        camera_model:   Camera model from EXIF. None to omit segment entirely.
        person_names:   Ordered list of recognized person names. None or [] to omit.
        existing_names: Set of filenames already in the library for collision detection.
                        None treated as empty (no collisions possible).

    Returns:
        :class:`RenameResult` with the generated filename.

    Raises:
        FileNotFoundError: If file_path does not exist.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")

    # Normalize extension
    ext = extension if extension.startswith(".") else f".{extension}"
    ext = ext.lower()

    salt = _sha256_salt(path)
    date_prefix = _date_prefix(date_taken, path)

    stem = _choose_stem(
        date_prefix,
        salt,
        city=city or None,  # treat "" as None
        person_names=person_names or None,
        camera_model=camera_model,
        ext=ext,
    )

    filename = _resolve_collision(stem, ext, existing_names or set())

    return RenameResult(filename=filename)
