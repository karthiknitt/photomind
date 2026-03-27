"""
Tests for import_jobs_db — CRUD for the import_jobs SQLite table.

Strategy:
- Real SQLite via tmp_path (no mocks)
- Tests cover: create, get, update, list ordering, missing record returns None
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from photomind.services.import_jobs_db import (
    ImportJobRecord,
    create_import_job,
    get_import_job,
    list_import_jobs,
    update_import_job,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "photomind.db"


# ---------------------------------------------------------------------------
# create_import_job / get_import_job
# ---------------------------------------------------------------------------


class TestCreateAndGetImportJob:
    def test_create_and_get_roundtrip(self, db_path: Path) -> None:
        """create_import_job inserts a row; get_import_job retrieves it."""
        create_import_job(db_path, "job-1", "/mnt/usb", "USB Drive")
        record = get_import_job(db_path, "job-1")

        assert record is not None
        assert record.id == "job-1"
        assert record.local_path == "/mnt/usb"
        assert record.label == "USB Drive"
        assert record.status == "RUNNING"
        assert record.total_count is None
        assert record.processed_count == 0
        assert record.error_count == 0
        assert record.finished_at is None
        assert record.created_at > 0

    def test_create_with_none_label(self, db_path: Path) -> None:
        """label is optional — None is stored and retrieved as None."""
        create_import_job(db_path, "job-none", "/tmp/photos", None)
        record = get_import_job(db_path, "job-none")

        assert record is not None
        assert record.label is None

    def test_get_nonexistent_returns_none(self, db_path: Path) -> None:
        """get_import_job returns None for a job_id that does not exist."""
        result = get_import_job(db_path, "does-not-exist")
        assert result is None

    def test_created_at_is_approximate_now(self, db_path: Path) -> None:
        """created_at must be close to the current Unix timestamp."""
        before = int(time.time())
        create_import_job(db_path, "job-ts", "/path", None)
        after = int(time.time())

        record = get_import_job(db_path, "job-ts")
        assert record is not None
        assert before <= record.created_at <= after

    def test_create_is_idempotent_table_creation(self, db_path: Path) -> None:
        """Multiple calls don't fail due to table already existing."""
        create_import_job(db_path, "job-a", "/a", None)
        create_import_job(db_path, "job-b", "/b", None)  # second call — table exists

        assert get_import_job(db_path, "job-a") is not None
        assert get_import_job(db_path, "job-b") is not None


# ---------------------------------------------------------------------------
# update_import_job
# ---------------------------------------------------------------------------


class TestUpdateImportJob:
    def test_update_status(self, db_path: Path) -> None:
        """update_import_job can change the status field."""
        create_import_job(db_path, "job-u", "/path", None)
        update_import_job(db_path, "job-u", status="DONE")

        record = get_import_job(db_path, "job-u")
        assert record is not None
        assert record.status == "DONE"

    def test_update_multiple_fields(self, db_path: Path) -> None:
        """update_import_job can set multiple fields in one call."""
        now = int(time.time())
        create_import_job(db_path, "job-multi", "/path", None)
        update_import_job(
            db_path,
            "job-multi",
            total_count=100,
            processed_count=50,
            error_count=3,
        )

        record = get_import_job(db_path, "job-multi")
        assert record is not None
        assert record.total_count == 100
        assert record.processed_count == 50
        assert record.error_count == 3

    def test_update_finished_at(self, db_path: Path) -> None:
        """finished_at can be set via update_import_job."""
        create_import_job(db_path, "job-fin", "/path", None)
        now = int(time.time())
        update_import_job(db_path, "job-fin", status="DONE", finished_at=now)

        record = get_import_job(db_path, "job-fin")
        assert record is not None
        assert record.finished_at == now
        assert record.status == "DONE"

    def test_update_error_status(self, db_path: Path) -> None:
        """status can be set to ERROR."""
        create_import_job(db_path, "job-err", "/path", None)
        update_import_job(db_path, "job-err", status="ERROR", finished_at=int(time.time()))

        record = get_import_job(db_path, "job-err")
        assert record is not None
        assert record.status == "ERROR"

    def test_update_processed_count_increments(self, db_path: Path) -> None:
        """processed_count can be updated step by step."""
        create_import_job(db_path, "job-prog", "/path", None)

        for i in range(1, 6):
            update_import_job(db_path, "job-prog", processed_count=i)

        record = get_import_job(db_path, "job-prog")
        assert record is not None
        assert record.processed_count == 5


# ---------------------------------------------------------------------------
# list_import_jobs
# ---------------------------------------------------------------------------


class TestListImportJobs:
    def test_list_empty_returns_empty_list(self, db_path: Path) -> None:
        """list_import_jobs returns [] when no jobs exist."""
        result = list_import_jobs(db_path)
        assert result == []

    def test_list_returns_all_jobs(self, db_path: Path) -> None:
        """list_import_jobs returns all created jobs."""
        create_import_job(db_path, "job-1", "/a", None)
        create_import_job(db_path, "job-2", "/b", None)
        create_import_job(db_path, "job-3", "/c", None)

        result = list_import_jobs(db_path)
        assert len(result) == 3

    def test_list_ordered_by_created_at_desc(self, db_path: Path) -> None:
        """list_import_jobs returns jobs newest-first."""
        create_import_job(db_path, "job-old", "/old", None)
        time.sleep(0.01)  # ensure different created_at
        create_import_job(db_path, "job-new", "/new", None)

        result = list_import_jobs(db_path)
        assert result[0].id == "job-new"
        assert result[1].id == "job-old"

    def test_list_respects_limit(self, db_path: Path) -> None:
        """list_import_jobs honours the limit parameter."""
        for i in range(5):
            create_import_job(db_path, f"job-{i}", f"/path/{i}", None)

        result = list_import_jobs(db_path, limit=3)
        assert len(result) == 3

    def test_list_returns_importjobrecord_instances(self, db_path: Path) -> None:
        """list_import_jobs returns ImportJobRecord dataclass instances."""
        create_import_job(db_path, "job-x", "/x", "Label X")
        result = list_import_jobs(db_path)

        assert len(result) == 1
        assert isinstance(result[0], ImportJobRecord)
        assert result[0].id == "job-x"
        assert result[0].label == "Label X"

    def test_list_default_limit_is_20(self, db_path: Path) -> None:
        """Default limit=20 means at most 20 rows returned."""
        for i in range(25):
            create_import_job(db_path, f"job-{i:02d}", f"/path/{i}", None)

        result = list_import_jobs(db_path)
        assert len(result) == 20
