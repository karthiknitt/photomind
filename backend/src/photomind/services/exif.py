"""
EXIF extraction service for PhotoMind.

Extracts metadata from photo files: date taken (as Unix timestamp UTC),
GPS coordinates (decimal degrees), camera make/model/software, and
image dimensions from the actual pixel data.

All EXIF fields are nullable — returns None when a tag is absent or
malformed. Dimensions always come from img.size (never EXIF tags).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError

logger = logging.getLogger(__name__)

# Pillow EXIF tag IDs used in this service
_TAG_DATE_TIME_ORIGINAL = 36867  # "DateTimeOriginal" → "2024:12:25 14:30:22"
_TAG_MAKE = 271  # "Make"             → "Apple"
_TAG_MODEL = 272  # "Model"            → "iPhone 14 Pro"
_TAG_SOFTWARE = 305  # "Software"         → "WhatsApp"
_TAG_GPS_INFO = 34853  # "GPSInfo"          → nested GPS IFD dict

# GPS sub-tag IDs (keys inside the GPSInfo dict)
_GPS_LATITUDE_REF = 1  # b"N" or b"S"
_GPS_LATITUDE = 2  # tuple of 3 IFDRational: (deg, min, sec)
_GPS_LONGITUDE_REF = 3  # b"E" or b"W"
_GPS_LONGITUDE = 4  # tuple of 3 IFDRational: (deg, min, sec)

# EXIF datetime format
_EXIF_DATE_FORMAT = "%Y:%m:%d %H:%M:%S"


@dataclass
class ExifData:
    """All metadata extracted from a single photo file."""

    # Date
    date_taken: int | None  # Unix timestamp UTC (from EXIF DateTimeOriginal)
    date_original_str: str | None  # Raw EXIF string e.g. "2024:12:25 14:30:22"

    # GPS (decimal degrees, nullable)
    gps_lat: float | None
    gps_lon: float | None

    # Camera
    camera_make: str | None  # e.g. "Apple"
    camera_model: str | None  # e.g. "iPhone 14 Pro"
    software: str | None  # e.g. "WhatsApp"

    # Dimensions (from actual image, not EXIF)
    width: int
    height: int


def _dms_to_decimal(dms: tuple[Any, Any, Any], ref: str) -> float:
    """
    Convert EXIF GPS DMS (degrees, minutes, seconds) rationals to decimal degrees.

    Args:
        dms: Tuple of 3 values (degrees, minutes, seconds). Each value may be
             an IFDRational, a plain float, or a tuple (numerator, denominator).
        ref: Hemisphere reference string — one of "N", "S", "E", "W".

    Returns:
        Decimal degrees. Negative for S or W hemispheres.
    """
    d = float(dms[0])
    m = float(dms[1])
    s = float(dms[2])
    decimal = d + m / 60.0 + s / 3600.0
    if ref in ("S", "W"):
        decimal = -decimal
    return decimal


def _parse_gps(gps_info: dict[int, Any]) -> tuple[float | None, float | None]:
    """
    Parse a GPSInfo dict into (lat, lon) decimal degrees.

    Returns (None, None) when required GPS tags are missing or malformed.
    """
    try:
        lat_ref_raw = gps_info.get(_GPS_LATITUDE_REF)
        lat_dms = gps_info.get(_GPS_LATITUDE)
        lon_ref_raw = gps_info.get(_GPS_LONGITUDE_REF)
        lon_dms = gps_info.get(_GPS_LONGITUDE)

        if not all([lat_ref_raw, lat_dms, lon_ref_raw, lon_dms]):
            return None, None

        # lat_ref_raw may be bytes (b"N") or str ("N")
        lat_ref = (
            lat_ref_raw.decode() if isinstance(lat_ref_raw, bytes) else str(lat_ref_raw)
        )
        lon_ref = (
            lon_ref_raw.decode() if isinstance(lon_ref_raw, bytes) else str(lon_ref_raw)
        )

        lat = _dms_to_decimal(lat_dms, lat_ref.strip())
        lon = _dms_to_decimal(lon_dms, lon_ref.strip())
        return lat, lon
    except Exception:
        logger.debug("Failed to parse GPS data", exc_info=True)
        return None, None


def _parse_date(date_str: str) -> int | None:
    """
    Convert an EXIF DateTimeOriginal string to a Unix timestamp (UTC).

    EXIF dates have no timezone embedded; we treat them as UTC per PhotoMind
    convention (users can apply timezone offsets later via geocoding).

    Returns None if the string is malformed or cannot be parsed.
    """
    try:
        dt = datetime.strptime(date_str.strip(), _EXIF_DATE_FORMAT)
        dt_utc = dt.replace(tzinfo=UTC)
        return int(dt_utc.timestamp())
    except (ValueError, AttributeError):
        logger.debug("Failed to parse EXIF date string: %r", date_str)
        return None


def _str_tag(raw: object) -> str | None:
    """Decode a raw EXIF string tag to str, or return None if absent/invalid."""
    if raw is None:
        return None
    if isinstance(raw, bytes):
        try:
            return raw.decode("utf-8", errors="replace").strip("\x00").strip()
        except Exception:
            return None
    return str(raw).strip()


def extract_exif(file_path: str | Path) -> ExifData:
    """
    Extract metadata from a photo file.

    Uses Pillow to read EXIF data. All EXIF fields are nullable —
    returns None if the tag is absent or malformed.

    GPS is converted from EXIF DMS rational format to decimal degrees.
    date_taken is converted from EXIF DateTimeOriginal to Unix timestamp UTC.
    width/height always come from the actual image (never EXIF).

    Args:
        file_path: Path to the image file (JPEG, PNG, HEIC, etc.)

    Returns:
        ExifData with all available metadata.

    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If the file cannot be opened as an image.
    """
    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(f"Image file not found: {path}")

    try:
        img = Image.open(path)
        img.verify()  # validate file integrity without loading full pixel data
    except (UnidentifiedImageError, Exception) as exc:
        raise ValueError(f"Cannot open {path} as an image: {exc}") from exc

    # Re-open after verify() — Pillow requires reopening after verify
    try:
        img = Image.open(path)
    except Exception as exc:
        raise ValueError(f"Cannot open {path} as an image: {exc}") from exc

    width, height = img.size

    # Retrieve raw EXIF dict (tag_id → value); None if image has no EXIF
    raw_exif: dict[int, Any] | None = None
    try:
        raw_exif = img._getexif()  # type: ignore[attr-defined]  # Pillow private API
    except (AttributeError, Exception):
        raw_exif = None

    # --- Extract individual tags ---
    date_original_str: str | None = None
    date_taken: int | None = None
    gps_lat: float | None = None
    gps_lon: float | None = None
    camera_make: str | None = None
    camera_model: str | None = None
    software: str | None = None

    if raw_exif:
        # Date
        raw_date = raw_exif.get(_TAG_DATE_TIME_ORIGINAL)
        if raw_date is not None:
            date_original_str = _str_tag(raw_date)
            if date_original_str:
                date_taken = _parse_date(date_original_str)

        # Camera
        camera_make = _str_tag(raw_exif.get(_TAG_MAKE))
        camera_model = _str_tag(raw_exif.get(_TAG_MODEL))
        software = _str_tag(raw_exif.get(_TAG_SOFTWARE))

        # GPS
        gps_info = raw_exif.get(_TAG_GPS_INFO)
        if gps_info:
            gps_lat, gps_lon = _parse_gps(gps_info)

    return ExifData(
        date_taken=date_taken,
        date_original_str=date_original_str,
        gps_lat=gps_lat,
        gps_lon=gps_lon,
        camera_make=camera_make,
        camera_model=camera_model,
        software=software,
        width=width,
        height=height,
    )
