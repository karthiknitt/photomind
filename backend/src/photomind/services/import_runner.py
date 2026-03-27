"""
import_runner — one-time local folder import job runner.

run_import_job() scans a local directory for image files and processes each
new file through the existing 15-stage pipeline. Progress is tracked in the
import_jobs SQLite table in real time so the frontend can poll for live updates.

Designed to run in a thread or subprocess launched by the Next.js API route.
"""

from __future__ import annotations

import logging
import time

from photomind.config import PhotoMindConfig
from photomind.services import clip
from photomind.services.import_jobs_db import update_import_job
from photomind.services.local_scanner import list_local_files
from photomind.services.photos_db import (
    get_existing_filenames,
    get_phashes,
    get_processed_source_paths,
)
from photomind.worker.pipeline import process_photo

logger = logging.getLogger(__name__)


def run_import_job(
    job_id: str,
    local_path: str,
    db_path: str,
    config: PhotoMindConfig,
) -> None:
    """Run a one-time import of all images in local_path.

    Flow:
    1. List all images via local_scanner.list_local_files(local_path)
    2. Filter out files already in the DB (source_remote = 'local:<local_path>')
    3. Update import_jobs: total_count = len(new_files), status = RUNNING
    4. Load known_phashes, existing_filenames from DB (once)
    5. Open ChromaDB collection once
    6. For each new file:
       a. Call process_photo() — it handles its own per-file errors internally
       b. Increment processed_count and update import_jobs after each file
    7. Set status = DONE, finished_at = now
    8. On any unhandled exception: set status = ERROR, finished_at = now

    Args:
        job_id:     UUID of the import_jobs row (created by the API before this call).
        local_path: Absolute path to the local directory to import.
        db_path:    Path to the shared SQLite database.
        config:     Loaded PhotoMindConfig (paths, pipeline tuning).
    """
    source_remote = f"local:{local_path}"

    try:
        # ── Step 1: Discover all image files ─────────────────────────────────
        all_files = list_local_files(local_path)
        logger.info(
            "[job=%s] Discovered %d image file(s) in %s",
            job_id,
            len(all_files),
            local_path,
        )

        # ── Step 2: Filter to new (unprocessed) files ─────────────────────────
        known_source_paths = get_processed_source_paths(db_path)
        new_files = [
            lf for lf in all_files if (source_remote, lf.path) not in known_source_paths
        ]

        skipped = len(all_files) - len(new_files)
        logger.info(
            "[job=%s] %d new file(s), %d already processed — skipping",
            job_id,
            len(new_files),
            skipped,
        )

        # ── Step 3: Update import_jobs with total count ───────────────────────
        update_import_job(db_path, job_id, total_count=len(new_files))

        if not new_files:
            update_import_job(
                db_path,
                job_id,
                status="DONE",
                finished_at=int(time.time()),
            )
            logger.info("[job=%s] No new files to process — DONE", job_id)
            return

        # ── Step 4: Pre-load DB state once for the whole job ─────────────────
        known_phashes = get_phashes(db_path)
        existing_filenames = get_existing_filenames(db_path)

        # ── Step 5: Open ChromaDB collection once ────────────────────────────
        chroma_collection = clip.get_chroma_collection(config.chroma_db_path)

        # ── Step 6: Process each new file ────────────────────────────────────
        processed_count = 0

        for lf in new_files:
            logger.debug("[job=%s] Processing %s", job_id, lf.path)
            # process_photo catches its own per-file errors internally and logs them.
            # We don't catch here so per-file failures don't abort the entire job.
            process_photo(
                config=config,
                source_remote=source_remote,
                source_path=lf.path,
                db_path=db_path,
                chroma_collection=chroma_collection,
                known_phashes=known_phashes,
                existing_filenames=existing_filenames,
            )
            processed_count += 1
            update_import_job(db_path, job_id, processed_count=processed_count)

        # ── Step 7: Mark DONE ─────────────────────────────────────────────────
        update_import_job(
            db_path,
            job_id,
            status="DONE",
            finished_at=int(time.time()),
        )
        logger.info(
            "[job=%s] Import complete — %d file(s) processed",
            job_id,
            processed_count,
        )

    except Exception as exc:  # noqa: BLE001
        # ── Step 8: Catastrophic failure — mark ERROR ─────────────────────────
        logger.error(
            "[job=%s] Catastrophic failure: %s",
            job_id,
            exc,
            exc_info=True,
        )
        update_import_job(
            db_path,
            job_id,
            status="ERROR",
            finished_at=int(time.time()),
        )
