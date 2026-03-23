"""
Tests for the action_log service.

All tests use real SQLite (in-memory or tmp_path) — no mocking needed.
TDD: written before implementation, expected to FAIL initially.
"""

import sqlite3
import time
import uuid

import pytest

from photomind.services.action_log import ActionType, get_recent_actions, log_action


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_db(tmp_path):
    """Return a path to a fresh SQLite database file."""
    return str(tmp_path / "test.db")


def connect(db_path: str) -> sqlite3.Connection:
    return sqlite3.connect(db_path)


# ---------------------------------------------------------------------------
# ActionType enum
# ---------------------------------------------------------------------------


class TestActionType:
    def test_all_expected_values_exist(self):
        """All 7 ActionType values are defined."""
        expected = {
            "COPIED",
            "SKIPPED_DUPLICATE",
            "SKIPPED_MEME",
            "SKIPPED_ERROR",
            "INDEXED",
            "FACE_DETECTED",
            "CLUSTER_UPDATED",
        }
        actual = {a.value for a in ActionType}
        assert actual == expected

    def test_str_enum_behaviour(self):
        """ActionType members compare equal to their string values."""
        assert ActionType.COPIED == "COPIED"
        assert str(ActionType.INDEXED) == "INDEXED"


# ---------------------------------------------------------------------------
# log_action — core behaviour
# ---------------------------------------------------------------------------


class TestLogAction:
    def test_inserts_row_with_correct_action(self, tmp_path):
        """log_action writes a row with the correct action value."""
        db_path = make_db(tmp_path)
        log_action(db_path, ActionType.COPIED, photo_id="photo-1", detail="src.jpg")

        with connect(db_path) as conn:
            row = conn.execute("SELECT action FROM action_log").fetchone()
        assert row[0] == "COPIED"

    def test_inserts_row_with_correct_photo_id(self, tmp_path):
        """log_action stores the supplied photo_id."""
        db_path = make_db(tmp_path)
        log_action(db_path, ActionType.INDEXED, photo_id="abc-123")

        with connect(db_path) as conn:
            row = conn.execute("SELECT photo_id FROM action_log").fetchone()
        assert row[0] == "abc-123"

    def test_inserts_row_with_correct_detail(self, tmp_path):
        """log_action stores the detail string exactly."""
        db_path = make_db(tmp_path)
        log_action(db_path, ActionType.SKIPPED_ERROR, detail='{"reason": "corrupt"}')

        with connect(db_path) as conn:
            row = conn.execute("SELECT detail FROM action_log").fetchone()
        assert row[0] == '{"reason": "corrupt"}'

    def test_returns_valid_uuid(self, tmp_path):
        """log_action returns a string that parses as a valid UUID."""
        db_path = make_db(tmp_path)
        result = log_action(db_path, ActionType.COPIED)
        parsed = uuid.UUID(result)  # raises ValueError if invalid
        assert str(parsed) == result

    def test_returned_uuid_matches_stored_id(self, tmp_path):
        """The returned UUID is the same id stored in the database."""
        db_path = make_db(tmp_path)
        returned_id = log_action(db_path, ActionType.INDEXED)

        with connect(db_path) as conn:
            row = conn.execute("SELECT id FROM action_log").fetchone()
        assert row[0] == returned_id

    def test_uses_current_time_when_timestamp_not_provided(self, tmp_path):
        """Default timestamp is close to the current Unix time (within 5 s)."""
        db_path = make_db(tmp_path)
        before = int(time.time())
        log_action(db_path, ActionType.COPIED)
        after = int(time.time())

        with connect(db_path) as conn:
            row = conn.execute("SELECT timestamp FROM action_log").fetchone()
        assert before <= row[0] <= after + 1

    def test_accepts_explicit_timestamp(self, tmp_path):
        """A supplied timestamp is stored verbatim."""
        db_path = make_db(tmp_path)
        ts = 1_700_000_000
        log_action(db_path, ActionType.COPIED, timestamp=ts)

        with connect(db_path) as conn:
            row = conn.execute("SELECT timestamp FROM action_log").fetchone()
        assert row[0] == ts

    def test_accepts_none_photo_id(self, tmp_path):
        """photo_id may be None (source-level actions have no photo)."""
        db_path = make_db(tmp_path)
        log_action(db_path, ActionType.SKIPPED_ERROR, photo_id=None)

        with connect(db_path) as conn:
            row = conn.execute("SELECT photo_id FROM action_log").fetchone()
        assert row[0] is None

    def test_accepts_none_detail(self, tmp_path):
        """detail may be None."""
        db_path = make_db(tmp_path)
        log_action(db_path, ActionType.COPIED, detail=None)

        with connect(db_path) as conn:
            row = conn.execute("SELECT detail FROM action_log").fetchone()
        assert row[0] is None


# ---------------------------------------------------------------------------
# log_action — DDL / table creation
# ---------------------------------------------------------------------------


class TestLogActionDDL:
    def test_creates_table_if_not_exists(self, tmp_path):
        """log_action creates the action_log table when it is absent."""
        db_path = make_db(tmp_path)
        # Fresh DB — table does not exist yet
        log_action(db_path, ActionType.COPIED)

        with connect(db_path) as conn:
            tables = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='action_log'"
            ).fetchall()
        assert len(tables) == 1

    def test_idempotent_on_existing_table(self, tmp_path):
        """Calling log_action twice doesn't fail due to duplicate DDL."""
        db_path = make_db(tmp_path)
        log_action(db_path, ActionType.COPIED)
        log_action(db_path, ActionType.INDEXED)  # must not raise

        with connect(db_path) as conn:
            count = conn.execute("SELECT COUNT(*) FROM action_log").fetchone()[0]
        assert count == 2

    def test_works_when_table_already_exists(self, tmp_path):
        """log_action works on a DB that already has the action_log table."""
        db_path = make_db(tmp_path)
        # Pre-create the table (simulates Next.js migration running first)
        with connect(db_path) as conn:
            conn.execute(
                """
                CREATE TABLE action_log (
                    id TEXT PRIMARY KEY,
                    photo_id TEXT,
                    action TEXT NOT NULL,
                    detail TEXT,
                    timestamp INTEGER NOT NULL
                )
                """
            )
        log_action(db_path, ActionType.FACE_DETECTED, photo_id="p-99")

        with connect(db_path) as conn:
            count = conn.execute("SELECT COUNT(*) FROM action_log").fetchone()[0]
        assert count == 1

    def test_wal_journal_mode_enabled(self, tmp_path):
        """WAL mode is set so Python writes don't block Next.js reads."""
        db_path = make_db(tmp_path)
        log_action(db_path, ActionType.COPIED)

        with connect(db_path) as conn:
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        assert mode == "wal"


# ---------------------------------------------------------------------------
# log_action — error handling
# ---------------------------------------------------------------------------


class TestLogActionValidation:
    def test_raises_value_error_for_invalid_action_string(self, tmp_path):
        """log_action raises ValueError when action is not a valid ActionType."""
        db_path = make_db(tmp_path)
        with pytest.raises(ValueError):
            log_action(db_path, "NOT_A_VALID_ACTION")  # type: ignore[arg-type]

    def test_raises_value_error_for_empty_action(self, tmp_path):
        """Empty string is not a valid action."""
        db_path = make_db(tmp_path)
        with pytest.raises(ValueError):
            log_action(db_path, "")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# log_action — all ActionType values
# ---------------------------------------------------------------------------


class TestAllActionTypes:
    @pytest.mark.parametrize(
        "action",
        [
            ActionType.COPIED,
            ActionType.SKIPPED_DUPLICATE,
            ActionType.SKIPPED_MEME,
            ActionType.SKIPPED_ERROR,
            ActionType.INDEXED,
            ActionType.FACE_DETECTED,
            ActionType.CLUSTER_UPDATED,
        ],
    )
    def test_all_action_types_can_be_logged(self, tmp_path, action):
        """Every ActionType value can be written without error."""
        db_path = make_db(tmp_path)
        returned_id = log_action(db_path, action)
        assert uuid.UUID(returned_id)  # valid UUID


# ---------------------------------------------------------------------------
# get_recent_actions
# ---------------------------------------------------------------------------


class TestGetRecentActions:
    def test_returns_list_of_dicts(self, tmp_path):
        """get_recent_actions returns a list of dicts."""
        db_path = make_db(tmp_path)
        log_action(db_path, ActionType.COPIED)
        result = get_recent_actions(db_path)
        assert isinstance(result, list)
        assert isinstance(result[0], dict)

    def test_dict_has_required_keys(self, tmp_path):
        """Each dict contains id, photo_id, action, detail, timestamp."""
        db_path = make_db(tmp_path)
        log_action(db_path, ActionType.COPIED, photo_id="p1", detail="x")
        row = get_recent_actions(db_path)[0]
        assert set(row.keys()) == {"id", "photo_id", "action", "detail", "timestamp"}

    def test_returns_newest_first(self, tmp_path):
        """Entries are returned newest-first (descending timestamp)."""
        db_path = make_db(tmp_path)
        log_action(db_path, ActionType.COPIED, timestamp=1000)
        log_action(db_path, ActionType.INDEXED, timestamp=2000)
        log_action(db_path, ActionType.FACE_DETECTED, timestamp=3000)

        rows = get_recent_actions(db_path)
        timestamps = [r["timestamp"] for r in rows]
        assert timestamps == sorted(timestamps, reverse=True)

    def test_respects_limit_parameter(self, tmp_path):
        """limit parameter caps the number of returned rows."""
        db_path = make_db(tmp_path)
        for i in range(10):
            log_action(db_path, ActionType.COPIED, timestamp=i)

        rows = get_recent_actions(db_path, limit=3)
        assert len(rows) == 3

    def test_default_limit_is_100(self, tmp_path):
        """Default limit returns up to 100 rows."""
        db_path = make_db(tmp_path)
        for i in range(110):
            log_action(db_path, ActionType.COPIED, timestamp=i)

        rows = get_recent_actions(db_path)
        assert len(rows) == 100

    def test_filters_by_photo_id(self, tmp_path):
        """Passing photo_id returns only rows matching that photo."""
        db_path = make_db(tmp_path)
        log_action(db_path, ActionType.COPIED, photo_id="photo-A")
        log_action(db_path, ActionType.INDEXED, photo_id="photo-B")
        log_action(db_path, ActionType.FACE_DETECTED, photo_id="photo-A")

        rows = get_recent_actions(db_path, photo_id="photo-A")
        assert len(rows) == 2
        assert all(r["photo_id"] == "photo-A" for r in rows)

    def test_filter_by_photo_id_excludes_others(self, tmp_path):
        """photo_id filter does not return rows for other photos."""
        db_path = make_db(tmp_path)
        log_action(db_path, ActionType.COPIED, photo_id="photo-X")
        log_action(db_path, ActionType.INDEXED, photo_id="photo-Y")

        rows = get_recent_actions(db_path, photo_id="photo-X")
        assert all(r["photo_id"] == "photo-X" for r in rows)

    def test_returns_empty_list_when_no_rows(self, tmp_path):
        """Returns [] when the table exists but has no matching rows."""
        db_path = make_db(tmp_path)
        log_action(db_path, ActionType.COPIED, photo_id="other")

        rows = get_recent_actions(db_path, photo_id="nonexistent")
        assert rows == []

    def test_multiple_actions_for_same_photo_all_retrievable(self, tmp_path):
        """All actions for a photo are returned when filtered by photo_id."""
        db_path = make_db(tmp_path)
        photo_id = "photo-multi"
        for action in ActionType:
            log_action(db_path, action, photo_id=photo_id)

        rows = get_recent_actions(db_path, photo_id=photo_id)
        assert len(rows) == len(ActionType)
        assert all(r["photo_id"] == photo_id for r in rows)

    def test_returned_values_match_what_was_written(self, tmp_path):
        """Returned dict values exactly match what was logged."""
        db_path = make_db(tmp_path)
        ts = 1_700_000_000
        written_id = log_action(
            db_path,
            ActionType.SKIPPED_MEME,
            photo_id="p-42",
            detail='{"score": 0.9}',
            timestamp=ts,
        )
        row = get_recent_actions(db_path)[0]

        assert row["id"] == written_id
        assert row["photo_id"] == "p-42"
        assert row["action"] == "SKIPPED_MEME"
        assert row["detail"] == '{"score": 0.9}'
        assert row["timestamp"] == ts
