"""
local_scanner — os.walk-based scanner for local filesystem paths.

Provides list_local_files() as the primary interface for scanning USB drives,
HDDs, and Android MTP mounts. The output LocalFile shape is structurally
similar to rclone.RemoteFile so the daemon can dispatch uniformly.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS: frozenset[str] = frozenset(
    {
        ".jpg",
        ".jpeg",
        ".png",
        ".heic",
        ".heif",
        ".tiff",
        ".tif",
        ".webp",
        ".bmp",
        ".gif",
    }
)


@dataclass
class LocalFile:
    """Represents a single image file on the local filesystem."""

    path: str  # absolute path to the file
    name: str  # filename only
    size: int  # bytes


def list_local_files(root: str) -> list[LocalFile]:
    """Recursively list all image files under root.

    Symlinks are skipped (followlinks=False). Directories are excluded.
    Only files whose suffix matches IMAGE_EXTENSIONS (case-insensitive)
    are returned.

    Args:
        root: Absolute path to the root directory to scan (e.g. ``"/mnt/usb"``).

    Returns:
        List of :class:`LocalFile` objects, one per discovered image file.
        Files where :func:`os.path.getsize` raises are skipped with a warning.
    """
    results: list[LocalFile] = []
    root_path = Path(root).resolve()

    for dirpath, dirnames, filenames in os.walk(str(root_path), followlinks=False):
        # Remove symlinked subdirectories in-place so os.walk won't descend into them
        dirnames[:] = [
            d for d in dirnames if not os.path.islink(os.path.join(dirpath, d))
        ]

        for filename in filenames:
            abs_path = os.path.join(dirpath, filename)

            # Skip symlinks
            if os.path.islink(abs_path):
                continue

            # Filter by image extension (case-insensitive)
            suffix = Path(filename).suffix.lower()
            if suffix not in IMAGE_EXTENSIONS:
                continue

            try:
                size = os.path.getsize(abs_path)
            except OSError:
                logger.warning("Could not get size for %s — skipping", abs_path)
                continue

            results.append(LocalFile(path=abs_path, name=filename, size=size))

    return results
