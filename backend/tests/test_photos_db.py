"""
Tests for the photos_db module.

Uses real SQLite via tmp_path — no mocking. Mirrors test_action_log.py pattern.
Verifies: create, update, get_phashes, get_existing_filenames, and status queries.
"""

from __future__ import annotations

import sqlite3
import time
import uuid
from pathlib import Path

import pytest

from photomind.services.photos_db import (
    PhotoRecord,
    create_photo,
    get_existing_filenames,
    get_phashes,
    get_processed_source_paths,
    update_photo,
)

# ─── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    """Provide a fresh SQLite DB path. Table is created by photos_db itself."""
    return tmp_path / "test.db"


def _read_row(db_path: Path, photo_id: str) -> dict[str, object]:
    """Read a photos row directly from SQLite for assertions."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
    conn.close()
    assert row is not None, f"No row found for id={photo_id}"
    return dict(row)


def _make_record(**overrides: object) -> PhotoRecord:
    """Build a minimal PhotoRecord with sensible defaults."""
    now = int(time.time())
    defaults: dict[str, object] = {
        "id": str(uuid.uuid4()),
        "source_remote": "onedrive_karthik",
        "source_path": "/Pictures/2024/IMG_001.jpg",
        "status": "PROCESSING",
        "created_at": now,
        "updated_at": now,
    }
    defaults.update(overrides)
    return PhotoRecord(**defaults)  # type: ignore[arg-type]


# ─── TestCreatePhoto ──────────────────────────────────────────────────────────


class TestCreatePhoto:
    def test_creates_row_in_db(self, db_path: Path) -> None:
        rec = _make_record()
        create_photo(db_path, rec)
        row = _read_row(db_path, rec.id)
        assert row["id"] == rec.id
        assert row["source_remote"] == "onedrive_karthik"
        assert row["source_path"] == "/Pictures/2024/IMG_001.jpg"
        assert row["status"] == "PROCESSING"

    def test_creates_table_if_not_exists(self, db_path: Path) -> None:
        # DB file doesn't exist yet — create_photo should bootstrap the table
        assert not db_path.exists()
        rec = _make_record()
        create_photo(db_path, rec)
        assert db_path.exists()
        row = _read_row(db_path, rec.id)
        assert row["id"] == rec.id

    def test_nullable_fields_stored_as_none(self, db_path: Path) -> None:
        rec = _make_record()
        create_photo(db_path, rec)
        row = _read_row(db_path, rec.id)
        assert row["phash"] is None
        assert row["city"] is None
        assert row["filename_final"] is None
        assert row["date_taken"] is None

    def test_optional_fields_stored_when_provided(self, db_path: Path) -> None:
        rec = _make_record(
            phash="abc123",
            city="Chennai",
            date_taken=1735137022,
            camera_make="Apple",
            camera_model="iPhone 14 Pro",
            width=4032,
            height=3024,
            file_size=3_500_000,
        )
        create_photo(db_path, rec)
        row = _read_row(db_path, rec.id)
        assert row["phash"] == "abc123"
        assert row["city"] == "Chennai"
        assert row["date_taken"] == 1735137022
        assert row["camera_make"] == "Apple"
        assert row["width"] == 4032

    def test_duplicate_id_raises(self, db_path: Path) -> None:
        rec = _make_record()
        create_photo(db_path, rec)
        with pytest.raises(sqlite3.IntegrityError):  # UNIQUE constraint violation
            create_photo(db_path, rec)

    def test_multiple_photos_stored(self, db_path: Path) -> None:
        for _ in range(5):
            create_photo(db_path, _make_record())
        conn = sqlite3.connect(str(db_path))
        count = conn.execute("SELECT COUNT(*) FROM photos").fetchone()[0]
        conn.close()
        assert count == 5


# ─── TestUpdatePhoto ──────────────────────────────────────────────────────────


class TestUpdatePhoto:
    def test_updates_status(self, db_path: Path) -> None:
        rec = _make_record()
        create_photo(db_path, rec)
        update_photo(db_path, rec.id, status="DONE")
        row = _read_row(db_path, rec.id)
        assert row["status"] == "DONE"

    def test_updates_filename_final(self, db_path: Path) -> None:
        rec = _make_record()
        create_photo(db_path, rec)
        update_photo(db_path, rec.id, filename_final="2024-12-25_143022_a3f2.jpg")
        row = _read_row(db_path, rec.id)
        assert row["filename_final"] == "2024-12-25_143022_a3f2.jpg"

    def test_updates_multiple_fields(self, db_path: Path) -> None:
        rec = _make_record()
        create_photo(db_path, rec)
        update_photo(
            db_path,
            rec.id,
            status="DONE",
            city="Ooty",
            phash="deadbeef",
            clip_indexed=True,
            filename_final="2024-12-25_143022_a3f2.jpg",
            library_path="2024/12/2024-12-25_143022_a3f2.jpg",
        )
        row = _read_row(db_path, rec.id)
        assert row["status"] == "DONE"
        assert row["city"] == "Ooty"
        assert row["phash"] == "deadbeef"
        assert row["clip_indexed"] == 1
        assert row["filename_final"] == "2024-12-25_143022_a3f2.jpg"

    def test_updates_updated_at(self, db_path: Path) -> None:
        old_ts = int(time.time()) - 100
        rec = _make_record(updated_at=old_ts)
        create_photo(db_path, rec)
        update_photo(db_path, rec.id, status="DONE")
        row = _read_row(db_path, rec.id)
        assert row["updated_at"] >= old_ts

    def test_update_nonexistent_id_is_noop(self, db_path: Path) -> None:
        # Updating a row that doesn't exist should not raise
        create_photo(db_path, _make_record())  # ensure table exists
        update_photo(db_path, "nonexistent-id", status="DONE")  # should not raise

    def test_error_detail_stored(self, db_path: Path) -> None:
        rec = _make_record()
        create_photo(db_path, rec)
        update_photo(db_path, rec.id, status="ERROR", error_detail="rclone timed out")
        row = _read_row(db_path, rec.id)
        assert row["status"] == "ERROR"
        assert row["error_detail"] == "rclone timed out"


# ─── TestGetPhashes ───────────────────────────────────────────────────────────


class TestGetPhashes:
    def test_returns_empty_set_when_no_rows(self, db_path: Path) -> None:
        create_photo(db_path, _make_record())  # create one row but no phash
        result = get_phashes(db_path)
        assert result == set()

    def test_returns_phashes(self, db_path: Path) -> None:
        create_photo(db_path, _make_record(phash="aabbccdd"))
        create_photo(db_path, _make_record(phash="11223344"))
        result = get_phashes(db_path)
        assert result == {"aabbccdd", "11223344"}

    def test_excludes_null_phashes(self, db_path: Path) -> None:
        create_photo(db_path, _make_record(phash="aabbccdd"))
        create_photo(db_path, _make_record())  # no phash
        result = get_phashes(db_path)
        assert result == {"aabbccdd"}

    def test_returns_set_not_list(self, db_path: Path) -> None:
        create_photo(db_path, _make_record(phash="aabbccdd"))
        result = get_phashes(db_path)
        assert isinstance(result, set)


# ─── TestGetExistingFilenames ─────────────────────────────────────────────────


class TestGetExistingFilenames:
    def test_returns_empty_set_when_no_rows(self, db_path: Path) -> None:
        create_photo(db_path, _make_record())
        result = get_existing_filenames(db_path)
        assert result == set()

    def test_returns_filenames(self, db_path: Path) -> None:
        create_photo(db_path, _make_record(filename_final="2024-01-01_000000_a1b2.jpg"))
        create_photo(db_path, _make_record(filename_final="2024-06-15_120000_c3d4.jpg"))
        result = get_existing_filenames(db_path)
        assert result == {
            "2024-01-01_000000_a1b2.jpg",
            "2024-06-15_120000_c3d4.jpg",
        }

    def test_excludes_null_filenames(self, db_path: Path) -> None:
        create_photo(db_path, _make_record(filename_final="2024-01-01_000000_a1b2.jpg"))
        create_photo(db_path, _make_record())  # no filename_final
        result = get_existing_filenames(db_path)
        assert result == {"2024-01-01_000000_a1b2.jpg"}


# ─── TestGetProcessedSourcePaths ──────────────────────────────────────────────


class TestGetProcessedSourcePaths:
    def test_returns_empty_set_when_no_rows(self, db_path: Path) -> None:
        create_photo(db_path, _make_record())
        # Even with a row, source_path is populated, so this won't be empty
        # Use a fresh DB that has no rows at all
        empty_db = db_path.parent / "empty.db"
        from photomind.services.photos_db import get_processed_source_paths
        result = get_processed_source_paths(empty_db)
        assert result == set()

    def test_returns_known_source_paths(self, db_path: Path) -> None:
        create_photo(db_path, _make_record(
            id="id-1",
            source_remote="onedrive_karthik",
            source_path="/Pictures/2024/IMG_001.jpg",
        ))
        create_photo(db_path, _make_record(
            id="id-2",
            source_remote="onedrive_wife",
            source_path="/Pictures/wedding/shot.jpg",
        ))
        result = get_processed_source_paths(db_path)
        assert ("onedrive_karthik", "/Pictures/2024/IMG_001.jpg") in result
        assert ("onedrive_wife", "/Pictures/wedding/shot.jpg") in result

    def test_returns_set_of_tuples(self, db_path: Path) -> None:
        create_photo(db_path, _make_record(
            id="id-1",
            source_remote="onedrive_karthik",
            source_path="/Pictures/photo.jpg",
        ))
        result = get_processed_source_paths(db_path)
        assert isinstance(result, set)
        item = next(iter(result))
        assert isinstance(item, tuple)
        assert len(item) == 2

    def test_excludes_no_rows_on_different_remote(self, db_path: Path) -> None:
        create_photo(db_path, _make_record(
            id="id-1",
            source_remote="onedrive_karthik",
            source_path="/Pictures/photo.jpg",
        ))
        result = get_processed_source_paths(db_path)
        assert ("onedrive_wife", "/Pictures/photo.jpg") not in result
        assert ("onedrive_karthik", "/Pictures/photo.jpg") in result

    def test_multiple_photos_same_remote(self, db_path: Path) -> None:
        for i in range(3):
            create_photo(db_path, _make_record(
                id=f"id-{i}",
                source_remote="onedrive_karthik",
                source_path=f"/Pictures/IMG_{i:03d}.jpg",
            ))
        result = get_processed_source_paths(db_path)
        assert len(result) == 3
