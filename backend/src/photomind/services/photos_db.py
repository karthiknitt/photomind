"""
photos_db — SQLite writer for the photos table.

Mirrors the action_log.py pattern: raw sqlite3 with WAL mode + FK off.
The photos table is created by Drizzle ORM migrations on the Next.js side;
this module writes to it from the Python pipeline without needing Drizzle.

Column names match the Drizzle schema in frontend/src/lib/db/schema.ts exactly.
"""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path


@dataclass
class PhotoRecord:
    """Represents a row in the photos table.

    Required fields match NOT NULL columns in the Drizzle schema.
    All other fields default to None / False / 0.
    """

    # Required
    id: str
    source_remote: str
    source_path: str
    status: str  # QUEUED | PROCESSING | DONE | ERROR
    created_at: int
    updated_at: int

    # Optional metadata — populated progressively through pipeline stages
    library_path: str | None = None
    filename_final: str | None = None
    date_taken: int | None = None
    date_original_str: str | None = None
    gps_lat: float | None = None
    gps_lon: float | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    camera_make: str | None = None
    camera_model: str | None = None
    software: str | None = None
    width: int | None = None
    height: int | None = None
    file_size: int | None = None
    phash: str | None = None
    is_meme: bool = False
    meme_reason: str | None = None
    clip_indexed: bool = False
    face_count: int = 0
    error_detail: str | None = None


_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS photos (
    id                TEXT    PRIMARY KEY,
    source_remote     TEXT    NOT NULL,
    source_path       TEXT    NOT NULL,
    library_path      TEXT,
    filename_final    TEXT,
    date_taken        INTEGER,
    date_original_str TEXT,
    gps_lat           REAL,
    gps_lon           REAL,
    city              TEXT,
    state             TEXT,
    country           TEXT,
    camera_make       TEXT,
    camera_model      TEXT,
    software          TEXT,
    width             INTEGER,
    height            INTEGER,
    file_size         INTEGER,
    phash             TEXT,
    is_meme           INTEGER NOT NULL DEFAULT 0,
    meme_reason       TEXT,
    clip_indexed      INTEGER NOT NULL DEFAULT 0,
    face_count        INTEGER NOT NULL DEFAULT 0,
    status            TEXT    NOT NULL DEFAULT 'QUEUED',
    error_detail      TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
)
"""

_INSERT_SQL = """
INSERT INTO photos (
    id, source_remote, source_path, library_path, filename_final,
    date_taken, date_original_str, gps_lat, gps_lon,
    city, state, country, camera_make, camera_model, software,
    width, height, file_size, phash,
    is_meme, meme_reason, clip_indexed, face_count,
    status, error_detail, created_at, updated_at
) VALUES (
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?
)
"""

# Columns that update_photo supports (all optional columns)
_UPDATABLE_COLUMNS = {
    "library_path",
    "filename_final",
    "date_taken",
    "date_original_str",
    "gps_lat",
    "gps_lon",
    "city",
    "state",
    "country",
    "camera_make",
    "camera_model",
    "software",
    "width",
    "height",
    "file_size",
    "phash",
    "is_meme",
    "meme_reason",
    "clip_indexed",
    "face_count",
    "status",
    "error_detail",
    "updated_at",
}


@contextmanager
def _open(db_path: str | Path) -> Generator[sqlite3.Connection, None, None]:
    """Open a WAL connection, commit/rollback, and always close."""
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=OFF")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def create_photo(db_path: str | Path, record: PhotoRecord) -> None:
    """Insert a new row into the photos table.

    Creates the table if it doesn't exist (so the daemon can start
    writing before the Next.js Drizzle migration has run).

    Args:
        db_path: Path to the SQLite database file.
        record:  PhotoRecord with all fields to insert.

    Raises:
        sqlite3.IntegrityError: if a row with the same id already exists.
    """
    with _open(db_path) as conn:
        conn.execute(_CREATE_TABLE_SQL)
        conn.execute(
            _INSERT_SQL,
            (
                record.id,
                record.source_remote,
                record.source_path,
                record.library_path,
                record.filename_final,
                record.date_taken,
                record.date_original_str,
                record.gps_lat,
                record.gps_lon,
                record.city,
                record.state,
                record.country,
                record.camera_make,
                record.camera_model,
                record.software,
                record.width,
                record.height,
                record.file_size,
                record.phash,
                int(record.is_meme),
                record.meme_reason,
                int(record.clip_indexed),
                record.face_count,
                record.status,
                record.error_detail,
                record.created_at,
                record.updated_at,
            ),
        )


def update_photo(
    db_path: str | Path,
    photo_id: str,
    **fields: object,
) -> None:
    """Update one or more columns on an existing photos row.

    Always bumps updated_at to the current time unless explicitly provided.

    Args:
        db_path:  Path to the SQLite database file.
        photo_id: UUID of the photo to update.
        **fields: Column name → value pairs to set. Unknown columns are ignored.

    Example::

        update_photo(db_path, photo_id, status="DONE", filename_final="foo.jpg")
    """
    # Filter to known columns; coerce booleans to int for sqlite3 consistency
    _BOOL_COLS = {"is_meme", "clip_indexed"}
    updates = {
        k: (int(v) if k in _BOOL_COLS and isinstance(v, bool) else v)  # type: ignore[arg-type]
        for k, v in fields.items()
        if k in _UPDATABLE_COLUMNS
    }

    # Always bump updated_at unless caller provides it
    if "updated_at" not in updates:
        updates["updated_at"] = int(time.time())

    if not updates:
        return

    set_clause = ", ".join(f"{col} = ?" for col in updates)
    values = list(updates.values())
    values.append(photo_id)

    with _open(db_path) as conn:
        conn.execute(_CREATE_TABLE_SQL)
        conn.execute(f"UPDATE photos SET {set_clause} WHERE id = ?", values)  # noqa: S608


def get_phashes(db_path: str | Path) -> set[str]:
    """Return all non-null phash values from the photos table.

    Used by the pipeline to load existing hashes once per batch before
    running per-photo dedup checks.

    Args:
        db_path: Path to the SQLite database file.

    Returns:
        Set of phash strings (may be empty).
    """
    with _open(db_path) as conn:
        conn.execute(_CREATE_TABLE_SQL)
        rows = conn.execute(
            "SELECT phash FROM photos WHERE phash IS NOT NULL"
        ).fetchall()
    return {row[0] for row in rows}


def get_processed_source_paths(db_path: str | Path) -> set[tuple[str, str]]:
    """Return (source_remote, source_path) pairs for all photos already in the DB.

    Used by the daemon to skip files that have already been processed (any status).
    Returns a set of tuples for O(1) membership checks per file in a scan batch.

    Args:
        db_path: Path to the SQLite database file.

    Returns:
        Set of (remote, path) tuples (may be empty if no photos exist yet).
    """
    with _open(db_path) as conn:
        conn.execute(_CREATE_TABLE_SQL)
        rows = conn.execute(
            "SELECT source_remote, source_path FROM photos"
        ).fetchall()
    return {(row[0], row[1]) for row in rows}


def get_existing_filenames(db_path: str | Path) -> set[str]:
    """Return all non-null filename_final values from the photos table.

    Used by the rename service for collision detection.

    Args:
        db_path: Path to the SQLite database file.

    Returns:
        Set of filename strings (may be empty).
    """
    with _open(db_path) as conn:
        conn.execute(_CREATE_TABLE_SQL)
        rows = conn.execute(
            "SELECT filename_final FROM photos WHERE filename_final IS NOT NULL"
        ).fetchall()
    return {row[0] for row in rows}
