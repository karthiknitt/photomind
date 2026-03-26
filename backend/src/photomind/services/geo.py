"""Geo service for PhotoMind.

Converts GPS coordinates (lat/lon) to city/state/country metadata using the
``reverse_geocoder`` library, which is fully offline and bundles a SQLite DB
of ~225 k world cities — no API key required.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# Suppress the noisy loading banner that reverse_geocoder prints to stdout.
os.environ.setdefault("RG_VERBOSE", "0")

import reverse_geocoder  # noqa: E402 — must come after env var is set


def _validate_coords(lat: float, lon: float) -> None:
    """Raise ValueError if lat or lon is outside the valid WGS-84 range.

    Args:
        lat: latitude in decimal degrees.
        lon: longitude in decimal degrees.

    Raises:
        ValueError: if lat is outside [-90, 90].
        ValueError: if lon is outside [-180, 180].
    """
    if not -90 <= lat <= 90:
        raise ValueError(f"lat must be in [-90, 90], got {lat}")
    if not -180 <= lon <= 180:
        raise ValueError(f"lon must be in [-180, 180], got {lon}")


def _result_to_dict(rg_result: dict[str, Any]) -> dict[str, str]:
    """Map a raw reverse_geocoder result to our canonical schema.

    Args:
        rg_result: dict returned by ``reverse_geocoder.search()``.

    Returns:
        dict with keys "city", "state", "country" (all strings).
    """
    return {
        "city": str(rg_result.get("name", "")),
        "state": str(rg_result.get("admin1", "")),
        "country": str(rg_result.get("cc", "")),
    }


def reverse_geocode(lat: float, lon: float) -> dict[str, str]:
    """Convert GPS coordinates to location metadata.

    Args:
        lat: latitude in decimal degrees (-90 to 90).
        lon: longitude in decimal degrees (-180 to 180).

    Returns:
        dict with keys: "city", "state", "country".
        All values are strings. If a field is unavailable, the value is "".

    Raises:
        ValueError: if lat is outside [-90, 90] or lon is outside [-180, 180].
    """
    _validate_coords(lat, lon)
    logger.debug("reverse_geocode lat=%s lon=%s", lat, lon)
    results: list[dict[str, Any]] = reverse_geocoder.search([(lat, lon)], verbose=False)
    if not results:
        logger.warning("reverse_geocoder returned empty result for (%s, %s)", lat, lon)
        return {"city": "", "state": "", "country": ""}
    return _result_to_dict(results[0])


def batch_reverse_geocode(
    coords: list[tuple[float, float]],
) -> list[dict[str, str]]:
    """Convert multiple GPS coordinates to location metadata in one call.

    More efficient than calling reverse_geocode() in a loop because
    ``reverse_geocoder.search()`` accepts a list natively.

    Args:
        coords: list of (lat, lon) tuples.

    Returns:
        list of dicts, same order as input, each with keys:
        "city", "state", "country".

    Raises:
        ValueError: if coords is empty.
        ValueError: if any coordinate is out of valid range.
    """
    if not coords:
        raise ValueError("coords must not be empty")

    for lat, lon in coords:
        _validate_coords(lat, lon)

    logger.info("batch_reverse_geocode: processing %d coordinates", len(coords))
    results: list[dict[str, Any]] = reverse_geocoder.search(coords, verbose=False)
    if len(results) != len(coords):
        raise RuntimeError(
            f"reverse_geocoder returned {len(results)} results for {len(coords)} inputs"
        )
    return [_result_to_dict(r) for r in results]
