"""
Core pipeline for PhotoMind.

process_photo() orchestrates all 15 processing stages for a single photo:

  1.  Download       — rclone copy source remote → tmp dir
  2.  Hash           — SHA256 for exact-duplicate pre-check (stored in DB)
  3.  EXIF           — date, GPS, camera, dimensions
  4.  Meme check     — 5-signal classifier; bail-out if meme
  5.  Dedup          — pHash vs known library hashes; bail-out if duplicate
  6.  Thumbnail      — 400px JPEG thumbnail saved to thumbnails_path
  7.  CLIP embed     — 512-dim float16 vector
  8.  ChromaDB insert— upsert embedding
  9.  Zero-shot label— CLIP labels → (not written to DB this sprint)
  10. Face detect    — [STUB — Phase 3; InsightFace not yet integrated]
  11. Face cluster   — [STUB — Phase 3; periodic HDBSCAN job]
  12. Geocode        — GPS → city/state/country (offline)
  13. Rename         — generate final filename from metadata
  14. Upload         — rclone copy renamed file → output remote/library
  15. DB finalize    — mark DONE, write filename_final + action_log COPIED

The function is synchronous (max_concurrent=1 for Sprint 2.2).
Caller is responsible for loading known_phashes and existing_filenames
once per batch (not per photo) for efficiency.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

from photomind.config import PhotoMindConfig
from photomind.services import clip, geo, rclone
from photomind.services.action_log import ActionType, log_action
from photomind.services.dedup import compute_phash, is_duplicate
from photomind.services.exif import extract_exif
from photomind.services.meme import check_meme
from photomind.services.photos_db import PhotoRecord, create_photo, update_photo
from photomind.services.rename import generate_filename
from photomind.services.thumbnail import generate_thumbnail

if TYPE_CHECKING:
    import chromadb

logger = logging.getLogger(__name__)


class _BailOut(Exception):
    """Internal sentinel: photo processed but not copied (meme or duplicate)."""

    def __init__(self, action: ActionType, detail: str) -> None:
        self.action = action
        self.detail = detail


def process_photo(
    *,
    config: PhotoMindConfig,
    source_remote: str,
    source_path: str,
    db_path: str | Path,
    chroma_collection: chromadb.Collection,
    known_phashes: set[str],
    existing_filenames: set[str],
) -> str:
    """Process one photo through all 15 pipeline stages.

    Creates a photos row, downloads the file, processes it, uploads the
    result, and finalises the DB record. On any unrecoverable error the
    photo is marked ERROR and the exception is swallowed so the pipeline
    can continue to the next photo.

    Args:
        config:             Project configuration (paths, pipeline tuning).
        source_remote:      rclone remote name (e.g. "onedrive_karthik").
        source_path:        Full path to the file on the remote.
        db_path:            Path to the shared SQLite database.
        chroma_collection:  Open ChromaDB collection handle (shared per batch).
        known_phashes:      Set of existing pHash strings for dedup (pre-loaded).
        existing_filenames: Set of existing final filenames for rename collision.

    Returns:
        UUID string for the newly created photo record.
    """
    photo_id = str(uuid.uuid4())
    now = int(time.time())
    db = str(db_path)
    tmp_file: Path | None = None

    # Insert initial record so errors can be logged against a real photo_id
    create_photo(
        db_path,
        PhotoRecord(
            id=photo_id,
            source_remote=source_remote,
            source_path=source_path,
            status="PROCESSING",
            created_at=now,
            updated_at=now,
        ),
    )

    try:
        # ── Stage 1: Download ─────────────────────────────────────────────────
        logger.info(
            "[%s] Stage 1: download %s:%s", photo_id, source_remote, source_path
        )
        tmp_file = rclone.download_file(source_remote, source_path, config.tmp_path)

        # ── Stage 2: EXIF ─────────────────────────────────────────────────────
        logger.info("[%s] Stage 2: EXIF", photo_id)
        exif = extract_exif(tmp_file)
        file_size = tmp_file.stat().st_size

        update_photo(
            db_path,
            photo_id,
            date_taken=exif.date_taken,
            date_original_str=exif.date_original_str,
            gps_lat=exif.gps_lat,
            gps_lon=exif.gps_lon,
            camera_make=exif.camera_make,
            camera_model=exif.camera_model,
            software=exif.software,
            width=exif.width,
            height=exif.height,
            file_size=file_size,
        )

        # ── Stage 4: Meme check ───────────────────────────────────────────────
        logger.info("[%s] Stage 4: meme check", photo_id)
        meme_result = check_meme(
            software=exif.software,
            has_exif_date=exif.date_taken is not None,
            width=exif.width,
            height=exif.height,
            file_size=file_size,
        )

        if meme_result.is_meme:
            meme_reason = ",".join(meme_result.reasons)
            update_photo(db_path, photo_id, is_meme=True, meme_reason=meme_reason)
            raise _BailOut(
                ActionType.SKIPPED_MEME,
                json.dumps({"reasons": meme_result.reasons}),
            )

        # ── Stage 5: Dedup ────────────────────────────────────────────────────
        logger.info("[%s] Stage 5: dedup", photo_id)
        phash = compute_phash(tmp_file)
        update_photo(db_path, photo_id, phash=phash)

        dup, matching_hash = is_duplicate(
            phash,
            known_phashes,
            hamming_threshold=config.pipeline.dedup_hamming_threshold,
        )
        if dup:
            raise _BailOut(
                ActionType.SKIPPED_DUPLICATE,
                json.dumps({"matching_phash": matching_hash}),
            )
        known_phashes.add(phash)  # prevent intra-batch duplicates

        # ── Stage 6: Thumbnail ────────────────────────────────────────────────
        logger.info("[%s] Stage 6: thumbnail", photo_id)
        generate_thumbnail(tmp_file, config.thumbnails_path, photo_id)

        # ── Stage 7-9: CLIP embed + ChromaDB + zero-shot ─────────────────────
        logger.info("[%s] Stages 7-9: CLIP", photo_id)
        embedding = clip.embed_image(tmp_file)
        clip.insert_to_chroma(chroma_collection, photo_id, embedding)
        # Stage 9 zero-shot labeling deferred: requires a label taxonomy (Phase 3)
        update_photo(db_path, photo_id, clip_indexed=True)

        # ── Stages 10-11: Face detect / cluster ──────────────────────────────
        # TODO(Phase 3): wire InsightFace buffalo_sc here
        # face_results = face.detect(tmp_file)
        # face.store_faces(db_path, photo_id, face_results)
        logger.debug("[%s] Stages 10-11: face detect/cluster stub (Phase 3)", photo_id)

        # ── Stage 12: Geocode ─────────────────────────────────────────────────
        city = state = country = None
        if exif.gps_lat is not None and exif.gps_lon is not None:
            logger.info("[%s] Stage 12: geocode", photo_id)
            geo_result = geo.reverse_geocode(exif.gps_lat, exif.gps_lon)
            city = geo_result.get("city") or None
            state = geo_result.get("state") or None
            country = geo_result.get("country") or None
            update_photo(db_path, photo_id, city=city, state=state, country=country)

        # ── Stage 13: Rename ──────────────────────────────────────────────────
        logger.info("[%s] Stage 13: rename", photo_id)
        ext = tmp_file.suffix
        rename_result = generate_filename(
            file_path=tmp_file,
            date_taken=exif.date_taken,
            extension=ext,
            city=city,
            camera_model=exif.camera_model,
            person_names=None,  # Phase 3: populated from face clusters
            existing_names=existing_filenames,
        )
        final_name = rename_result.filename

        # Rename the local tmp file to the final name for upload
        renamed_tmp = tmp_file.parent / final_name
        tmp_file.rename(renamed_tmp)
        tmp_file = renamed_tmp  # update reference for cleanup

        # ── Stage 14: Upload ──────────────────────────────────────────────────
        logger.info("[%s] Stage 14: upload %s", photo_id, final_name)
        output_remote = config.output.remote
        output_path = config.output.path
        rclone.upload_file(tmp_file, output_remote, output_path)

        library_path = f"{output_path.rstrip('/')}/{final_name}"

        # ── Stage 15: DB finalize ─────────────────────────────────────────────
        logger.info("[%s] Stage 15: finalize", photo_id)
        update_photo(
            db_path,
            photo_id,
            status="DONE",
            filename_final=final_name,
            library_path=library_path,
        )
        log_action(db, ActionType.COPIED, photo_id=photo_id, detail=final_name)
        existing_filenames.add(final_name)
        logger.info("[%s] Done → %s", photo_id, final_name)

    except _BailOut as bail:
        update_photo(db_path, photo_id, status="DONE")
        log_action(db, bail.action, photo_id=photo_id, detail=bail.detail)
        logger.info("[%s] Bail-out: %s", photo_id, bail.action)

    except Exception as exc:
        logger.error("[%s] Pipeline error: %s", photo_id, exc, exc_info=True)
        update_photo(db_path, photo_id, status="ERROR", error_detail=str(exc))
        log_action(db, ActionType.SKIPPED_ERROR, photo_id=photo_id, detail=str(exc))

    finally:
        # Always clean up the tmp file
        if tmp_file is not None and tmp_file.exists():
            try:
                tmp_file.unlink()
            except OSError:
                logger.warning("[%s] Failed to remove tmp file %s", photo_id, tmp_file)

    return photo_id
