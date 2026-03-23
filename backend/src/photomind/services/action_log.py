"""
action_log.py — SQLite action log writer for the PhotoMind daemon.

The Next.js frontend defines the action_log table via Drizzle ORM migrations.
This module writes to the same SQLite database using raw sqlite3, creating the
table with IF NOT EXISTS so the daemon can start logging before the migration
has run.

WAL journal mode is enabled so Python writes don't block Next.js reads.
Foreign keys are disabled because the photos table may not exist yet when
pipeline errors are logged.
"""

from __future__ import annotations

import sqlite3
import time
import uuid
from enum import StrEnum
from pathlib import Path


class ActionType(StrEnum):
    """Valid values for the action column in action_log."""

    COPIED = "COPIED"
    SKIPPED_DUPLICATE = "SKIPPED_DUPLICATE"
    SKIPPED_MEME = "SKIPPED_MEME"
    SKIPPED_ERROR = "SKIPPED_ERROR"
    INDEXED = "INDEXED"
    FACE_DETECTED = "FACE_DETECTED"
    CLUSTER_UPDATED = "CLUSTER_UPDATED"


_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS action_log (
    id        TEXT    PRIMARY KEY,
    photo_id  TEXT,
    action    TEXT    NOT NULL,
    detail    TEXT,
    timestamp INTEGER NOT NULL
)
"""

_INSERT_SQL = """
INSERT INTO action_log (id, photo_id, action, detail, timestamp)
VALUES (?, ?, ?, ?, ?)
"""

_SELECT_ALL_SQL = """
SELECT id, photo_id, action, detail, timestamp
FROM action_log
ORDER BY timestamp DESC
LIMIT ?
"""

_SELECT_BY_PHOTO_SQL = """
SELECT id, photo_id, action, detail, timestamp
FROM action_log
WHERE photo_id = ?
ORDER BY timestamp DESC
LIMIT ?
"""


def _open(db_path: str | Path) -> sqlite3.Connection:
    """Open a connection with WAL mode and FKs disabled."""
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=OFF")
    return conn


def _ensure_table(conn: sqlite3.Connection) -> None:
    """Create the action_log table if it doesn't already exist."""
    conn.execute(_CREATE_TABLE_SQL)


def _validate_action(action: ActionType | str) -> ActionType:
    """
    Coerce *action* to an ActionType member.

    Raises:
        ValueError: if *action* is not a recognised ActionType value.
    """
    try:
        return ActionType(action)
    except ValueError:
        valid = ", ".join(a.value for a in ActionType)
        raise ValueError(
            f"Invalid action {action!r}. Must be one of: {valid}"
        ) from None


def log_action(
    db_path: str | Path,
    action: ActionType | str,
    *,
    photo_id: str | None = None,
    detail: str | None = None,
    timestamp: int | None = None,
) -> str:
    """
    Write an entry to the action_log table.

    Creates the action_log table if it doesn't exist (so the Python daemon
    can start writing before the Next.js migration has run).

    Args:
        db_path:   Path to the SQLite database file.
        action:    One of the ActionType values.
        photo_id:  Optional UUID of the photo this action relates to.
        detail:    Optional JSON string or plain message.
        timestamp: Unix timestamp (defaults to current time).

    Returns:
        The UUID of the created log entry.

    Raises:
        ValueError: if *action* is not a valid ActionType.
    """
    validated_action = _validate_action(action)
    entry_id = str(uuid.uuid4())
    ts = timestamp if timestamp is not None else int(time.time())

    with _open(db_path) as conn:
        _ensure_table(conn)
        conn.execute(_INSERT_SQL, (entry_id, photo_id, validated_action, detail, ts))

    return entry_id


def get_recent_actions(
    db_path: str | Path,
    limit: int = 100,
    photo_id: str | None = None,
) -> list[dict[str, object]]:
    """
    Retrieve recent action log entries, newest first.

    Args:
        db_path:  Path to the SQLite database file.
        limit:    Maximum number of entries to return (default 100).
        photo_id: If given, filter to rows for this photo only.

    Returns:
        List of dicts with keys: id, photo_id, action, detail, timestamp.
    """
    with _open(db_path) as conn:
        _ensure_table(conn)
        conn.row_factory = sqlite3.Row

        if photo_id is not None:
            cursor = conn.execute(_SELECT_BY_PHOTO_SQL, (photo_id, limit))
        else:
            cursor = conn.execute(_SELECT_ALL_SQL, (limit,))

        rows = cursor.fetchall()

    return [dict(row) for row in rows]
