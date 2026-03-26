"""
PhotoMind worker daemon.

run_scan() performs one full scan cycle:
  1. Open ChromaDB collection (shared across all sources in the scan)
  2. Load known source paths from DB (pre-batch, O(1) per file lookup)
  3. Load known pHashes + existing filenames for dedup/rename
  4. For each configured source:
     a. List all files recursively via rclone
     b. Filter: images only, not yet in DB
     c. Process each file through the 15-stage pipeline
  5. Rclone errors for a single source are logged and skipped; other
     sources continue normally.

The daemon does NOT loop here — the scheduler (scheduler.py) wraps
run_scan() in a periodic loop with configurable sleep intervals.
"""

from __future__ import annotations

import logging
from pathlib import Path

from photomind.config import PhotoMindConfig
from photomind.services import clip, rclone
from photomind.services.photos_db import (
    get_existing_filenames,
    get_phashes,
    get_processed_source_paths,
)
from photomind.services.rclone import RcloneError
from photomind.worker.pipeline import process_photo

logger = logging.getLogger(__name__)

# Supported image extensions (lowercase) — videos and documents are excluded
_IMAGE_EXTENSIONS: frozenset[str] = frozenset(
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


def _is_image(filename: str) -> bool:
    """Return True if the file has a recognised image extension."""
    return Path(filename).suffix.lower() in _IMAGE_EXTENSIONS


def run_scan(config: PhotoMindConfig) -> None:
    """Run one complete scan cycle across all configured sources.

    Downloads nothing permanently — each file is downloaded to tmp_path,
    processed, uploaded to the library, and the tmp copy is deleted by
    the pipeline. Pre-loads DB state once per scan (not per file).

    Args:
        config: Loaded PhotoMindConfig with sources, paths, and pipeline tuning.
    """
    db_path = config.database_path

    logger.info("Scan started — %d source(s) configured", len(config.sources))

    # Open ChromaDB once for the whole scan
    chroma_collection = clip.get_chroma_collection(config.chroma_db_path)

    # Pre-load DB state once — O(1) lookups per file
    known_source_paths = get_processed_source_paths(db_path)
    known_phashes = get_phashes(db_path)
    existing_filenames = get_existing_filenames(db_path)

    total_new = 0
    total_skipped = 0

    for source in config.sources:
        logger.info(
            "Scanning source %r at %s:%s",
            source.label,
            source.remote,
            source.scan_path,
        )

        try:
            remote_files = rclone.list_files(
                source.remote, source.scan_path, recursive=True
            )
        except RcloneError as exc:
            logger.error(
                "rclone list failed for source %r — skipping: %s",
                source.label,
                exc,
            )
            continue

        # Filter: images only, not already in DB
        new_files = [
            rf
            for rf in remote_files
            if not rf.is_dir
            and _is_image(rf.name)
            and (source.remote, rf.path) not in known_source_paths
        ]

        skipped = len(remote_files) - len(new_files)
        total_skipped += skipped
        total_new += len(new_files)

        logger.info(
            "Source %r: %d new file(s), %d skipped (already processed or non-image)",
            source.label,
            len(new_files),
            skipped,
        )

        for rf in new_files:
            process_photo(
                config=config,
                source_remote=source.remote,
                source_path=rf.path,
                db_path=db_path,
                chroma_collection=chroma_collection,
                known_phashes=known_phashes,
                existing_filenames=existing_filenames,
            )

    logger.info(
        "Scan complete — %d new file(s) processed, %d skipped",
        total_new,
        total_skipped,
    )
