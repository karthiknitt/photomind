"""
import_jobs_db — SQLite CRUD helpers for the import_jobs table.

Mirrors the photos_db.py pattern: raw sqlite3 with WAL mode + FK off.
The import_jobs table is created by Drizzle ORM migrations on the Next.js
side; this module bootstraps it with CREATE TABLE IF NOT EXISTS so Python
can write records before the migration has run.
"""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ImportJobRecord:
    """Represents a row in the import_jobs table."""

    id: str
    status: str  # RUNNING | DONE | ERROR
    local_path: str
    label: str | None
    total_count: int | None
    processed_count: int
    error_count: int
    created_at: int
    finished_at: int | None


_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS import_jobs (
    id              TEXT    PRIMARY KEY,
    status          TEXT    NOT NULL DEFAULT 'RUNNING',
    local_path      TEXT    NOT NULL,
    label           TEXT,
    total_count     INTEGER,
    processed_count INTEGER NOT NULL DEFAULT 0,
    error_count     INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    finished_at     INTEGER
)
"""

_INSERT_SQL = """
INSERT INTO import_jobs (id, status, local_path, label, total_count, processed_count,
                          error_count, created_at, finished_at)
VALUES (?, 'RUNNING', ?, ?, NULL, 0, 0, ?, NULL)
"""

_SELECT_BY_ID_SQL = """
SELECT id, status, local_path, label, total_count, processed_count,
       error_count, created_at, finished_at
FROM import_jobs
WHERE id = ?
"""

_SELECT_ALL_SQL = """
SELECT id, status, local_path, label, total_count, processed_count,
       error_count, created_at, finished_at
FROM import_jobs
ORDER BY created_at DESC, rowid DESC
LIMIT ?
"""

# Columns allowed to be updated via update_import_job
_UPDATABLE_COLUMNS: frozenset[str] = frozenset(
    {
        "status",
        "total_count",
        "processed_count",
        "error_count",
        "finished_at",
    }
)


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


def _row_to_record(row: tuple[object, ...]) -> ImportJobRecord:
    """Convert a raw sqlite3 row tuple to an ImportJobRecord."""
    return ImportJobRecord(
        id=str(row[0]),
        status=str(row[1]),
        local_path=str(row[2]),
        label=str(row[3]) if row[3] is not None else None,
        total_count=int(row[4]) if row[4] is not None else None,  # type: ignore[arg-type]
        processed_count=int(row[5]),  # type: ignore[arg-type]
        error_count=int(row[6]),  # type: ignore[arg-type]
        created_at=int(row[7]),  # type: ignore[arg-type]
        finished_at=int(row[8]) if row[8] is not None else None,
    )


def create_import_job(
    db_path: str | Path,
    job_id: str,
    local_path: str,
    label: str | None,
) -> None:
    """Insert a new import_jobs row with status=RUNNING.

    Creates the table if it doesn't exist so the Python runner can write
    records before the Next.js Drizzle migration has run.

    Args:
        db_path:    Path to the SQLite database file.
        job_id:     UUID string for this job.
        local_path: Absolute path to the directory being imported.
        label:      Optional human-readable label for the import.
    """
    now = int(time.time())
    with _open(db_path) as conn:
        conn.execute(_CREATE_TABLE_SQL)
        conn.execute(_INSERT_SQL, (job_id, local_path, label, now))


def update_import_job(
    db_path: str | Path,
    job_id: str,
    **fields: object,
) -> None:
    """Update one or more columns on an existing import_jobs row.

    Args:
        db_path:  Path to the SQLite database file.
        job_id:   UUID of the job to update.
        **fields: Column name → value pairs to set. Unknown columns are ignored.
    """
    updates = {k: v for k, v in fields.items() if k in _UPDATABLE_COLUMNS}

    if not updates:
        return

    set_clause = ", ".join(f"{col} = ?" for col in updates)
    values = list(updates.values())
    values.append(job_id)

    with _open(db_path) as conn:
        conn.execute(_CREATE_TABLE_SQL)
        conn.execute(  # noqa: S608
            f"UPDATE import_jobs SET {set_clause} WHERE id = ?", values
        )


def get_import_job(
    db_path: str | Path,
    job_id: str,
) -> ImportJobRecord | None:
    """Retrieve a single import_jobs row by id.

    Args:
        db_path: Path to the SQLite database file.
        job_id:  UUID of the job to fetch.

    Returns:
        ImportJobRecord if found, None otherwise.
    """
    with _open(db_path) as conn:
        conn.execute(_CREATE_TABLE_SQL)
        row = conn.execute(_SELECT_BY_ID_SQL, (job_id,)).fetchone()

    if row is None:
        return None
    return _row_to_record(row)


def list_import_jobs(
    db_path: str | Path,
    limit: int = 20,
) -> list[ImportJobRecord]:
    """Return recent import jobs ordered by created_at descending.

    Args:
        db_path: Path to the SQLite database file.
        limit:   Maximum number of rows to return (default 20).

    Returns:
        List of ImportJobRecord instances, newest first.
    """
    with _open(db_path) as conn:
        conn.execute(_CREATE_TABLE_SQL)
        rows = conn.execute(_SELECT_ALL_SQL, (limit,)).fetchall()

    return [_row_to_record(row) for row in rows]
