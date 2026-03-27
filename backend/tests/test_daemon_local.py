"""
Tests for local source dispatch in worker/daemon.py (Task 1.4).

Strategy:
- Real SQLite via tmp_path; ChromaDB mocked
- local_scanner.list_local_files mocked to return controlled LocalFile lists
- rclone.list_files mocked for cloud sources in mixed tests
- process_photo mocked — verifies orchestration only

Tests cover:
  - local source calls list_local_files, NOT rclone.list_files
  - new local files passed to process_photo with correct source_remote / source_path
  - already-processed local files (in known_source_paths) are skipped
  - cloud and local sources coexist in the same scan (mixed config)
"""

from __future__ import annotations

import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from photomind.config import PhotoMindConfig, PipelineConfig, SourceConfig
from photomind.services.local_scanner import LocalFile
from photomind.services.photos_db import PhotoRecord, create_photo
from photomind.worker.daemon import run_scan

# ---------------------------------------------------------------------------
# Patch targets
# ---------------------------------------------------------------------------

RCLONE_PATCH = "photomind.worker.daemon.rclone"
LOCAL_SCANNER_PATCH = "photomind.worker.daemon.local_scanner"
PIPELINE_PATCH = "photomind.worker.daemon.process_photo"
CLIP_PATCH = "photomind.worker.daemon.clip"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "photomind.db"


@pytest.fixture()
def chroma_mock() -> MagicMock:
    coll = MagicMock()
    coll.upsert = MagicMock()
    return coll


@pytest.fixture()
def local_config(tmp_path: Path, db_path: Path) -> PhotoMindConfig:
    """Config with a single local source."""
    return PhotoMindConfig(
        database_path=str(db_path),
        chroma_db_path=str(tmp_path / "chroma"),
        thumbnails_path=str(tmp_path / "thumbnails"),
        tmp_path=str(tmp_path / "tmp"),
        sources=[
            SourceConfig(
                source_type="local",
                local_path="/mnt/test",
                label="USB Drive",
            )
        ],
        pipeline=PipelineConfig(batch_size=10),
    )


@pytest.fixture()
def mixed_config(tmp_path: Path, db_path: Path) -> PhotoMindConfig:
    """Config with one cloud source and one local source."""
    return PhotoMindConfig(
        database_path=str(db_path),
        chroma_db_path=str(tmp_path / "chroma"),
        thumbnails_path=str(tmp_path / "thumbnails"),
        tmp_path=str(tmp_path / "tmp"),
        sources=[
            SourceConfig(
                source_type="cloud",
                remote="onedrive_karthik",
                scan_path="/Pictures",
                label="Karthik OneDrive",
            ),
            SourceConfig(
                source_type="local",
                local_path="/mnt/usb",
                label="USB Drive",
            ),
        ],
        pipeline=PipelineConfig(batch_size=10),
    )


def _local_file(path: str, name: str, size: int = 1_000_000) -> LocalFile:
    return LocalFile(path=path, name=name, size=size)


def _remote_file(path: str, name: str, *, is_dir: bool = False) -> MagicMock:
    from photomind.services.rclone import RemoteFile

    return RemoteFile(path=path, name=name, size=1_000_000, is_dir=is_dir)


# ---------------------------------------------------------------------------
# Local source: uses list_local_files, not rclone.list_files
# ---------------------------------------------------------------------------


class TestLocalSourceDispatch:
    def test_local_source_calls_list_local_files(
        self,
        local_config: PhotoMindConfig,
        chroma_mock: MagicMock,
    ) -> None:
        """run_scan must call local_scanner.list_local_files for local sources."""
        local_files = [_local_file("/mnt/test/img.jpg", "img.jpg")]

        with (
            patch(f"{LOCAL_SCANNER_PATCH}.list_local_files", return_value=local_files) as mock_list,
            patch(PIPELINE_PATCH, return_value="uuid-1"),
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(local_config)

        mock_list.assert_called_once_with("/mnt/test")

    def test_local_source_does_not_call_rclone(
        self,
        local_config: PhotoMindConfig,
        chroma_mock: MagicMock,
    ) -> None:
        """rclone.list_files must NOT be called when source_type is 'local'."""
        with (
            patch(f"{LOCAL_SCANNER_PATCH}.list_local_files", return_value=[]),
            patch(f"{RCLONE_PATCH}.list_files") as mock_rclone,
            patch(PIPELINE_PATCH, return_value="uuid-1"),
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(local_config)

        mock_rclone.assert_not_called()

    def test_local_file_passed_to_process_photo_with_correct_source_remote(
        self,
        local_config: PhotoMindConfig,
        chroma_mock: MagicMock,
    ) -> None:
        """process_photo must receive source_remote='local:/mnt/test' for local source."""
        local_files = [_local_file("/mnt/test/img.jpg", "img.jpg")]

        with (
            patch(f"{LOCAL_SCANNER_PATCH}.list_local_files", return_value=local_files),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(local_config)

        assert mock_process.call_count == 1
        _, kwargs = mock_process.call_args
        assert kwargs["source_remote"] == "local:/mnt/test"

    def test_local_file_passed_to_process_photo_with_correct_source_path(
        self,
        local_config: PhotoMindConfig,
        chroma_mock: MagicMock,
    ) -> None:
        """process_photo must receive the absolute local path as source_path."""
        local_files = [_local_file("/mnt/test/img.jpg", "img.jpg")]

        with (
            patch(f"{LOCAL_SCANNER_PATCH}.list_local_files", return_value=local_files),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(local_config)

        _, kwargs = mock_process.call_args
        assert kwargs["source_path"] == "/mnt/test/img.jpg"

    def test_multiple_local_files_each_processed(
        self,
        local_config: PhotoMindConfig,
        chroma_mock: MagicMock,
    ) -> None:
        """All new local files should each trigger a process_photo call."""
        local_files = [
            _local_file("/mnt/test/img001.jpg", "img001.jpg"),
            _local_file("/mnt/test/img002.jpg", "img002.jpg"),
            _local_file("/mnt/test/img003.heic", "img003.heic"),
        ]

        with (
            patch(f"{LOCAL_SCANNER_PATCH}.list_local_files", return_value=local_files),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(local_config)

        assert mock_process.call_count == 3


# ---------------------------------------------------------------------------
# Local source: already-processed files are skipped
# ---------------------------------------------------------------------------


class TestLocalSourceSkipsKnown:
    def test_known_local_file_is_skipped(
        self,
        local_config: PhotoMindConfig,
        db_path: Path,
        chroma_mock: MagicMock,
    ) -> None:
        """A local file already in the DB must not be reprocessed."""
        now = int(time.time())
        create_photo(
            db_path,
            PhotoRecord(
                id="existing-uuid",
                source_remote="local:/mnt/test",
                source_path="/mnt/test/img.jpg",
                status="DONE",
                created_at=now,
                updated_at=now,
            ),
        )

        local_files = [_local_file("/mnt/test/img.jpg", "img.jpg")]

        with (
            patch(f"{LOCAL_SCANNER_PATCH}.list_local_files", return_value=local_files),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(local_config)

        mock_process.assert_not_called()

    def test_new_local_file_processed_while_known_skipped(
        self,
        local_config: PhotoMindConfig,
        db_path: Path,
        chroma_mock: MagicMock,
    ) -> None:
        """Only the new local file is processed; the already-known one is skipped."""
        now = int(time.time())
        create_photo(
            db_path,
            PhotoRecord(
                id="existing-uuid",
                source_remote="local:/mnt/test",
                source_path="/mnt/test/old.jpg",
                status="DONE",
                created_at=now,
                updated_at=now,
            ),
        )

        local_files = [
            _local_file("/mnt/test/old.jpg", "old.jpg"),   # known
            _local_file("/mnt/test/new.jpg", "new.jpg"),   # new
        ]

        with (
            patch(f"{LOCAL_SCANNER_PATCH}.list_local_files", return_value=local_files),
            patch(PIPELINE_PATCH, return_value="uuid-2") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(local_config)

        assert mock_process.call_count == 1
        _, kwargs = mock_process.call_args
        assert kwargs["source_path"] == "/mnt/test/new.jpg"


# ---------------------------------------------------------------------------
# Mixed config: cloud + local coexist
# ---------------------------------------------------------------------------


class TestMixedSourceScan:
    def test_cloud_and_local_sources_both_processed(
        self,
        mixed_config: PhotoMindConfig,
        chroma_mock: MagicMock,
    ) -> None:
        """Both cloud and local files should be processed in the same scan."""
        cloud_files = [_remote_file("2024/cloud.jpg", "cloud.jpg")]
        local_files = [_local_file("/mnt/usb/local.jpg", "local.jpg")]

        with (
            patch(f"{RCLONE_PATCH}.list_files", return_value=cloud_files),
            patch(f"{LOCAL_SCANNER_PATCH}.list_local_files", return_value=local_files),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(mixed_config)

        assert mock_process.call_count == 2

    def test_cloud_file_uses_rclone_remote_as_source_remote(
        self,
        mixed_config: PhotoMindConfig,
        chroma_mock: MagicMock,
    ) -> None:
        """Cloud file in mixed config must use source.remote (not 'local:...')."""
        cloud_files = [_remote_file("2024/cloud.jpg", "cloud.jpg")]

        with (
            patch(f"{RCLONE_PATCH}.list_files", return_value=cloud_files),
            patch(f"{LOCAL_SCANNER_PATCH}.list_local_files", return_value=[]),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(mixed_config)

        assert mock_process.call_count == 1
        _, kwargs = mock_process.call_args
        assert kwargs["source_remote"] == "onedrive_karthik"

    def test_local_file_uses_local_prefix_as_source_remote(
        self,
        mixed_config: PhotoMindConfig,
        chroma_mock: MagicMock,
    ) -> None:
        """Local file in mixed config must use 'local:<path>' as source_remote."""
        local_files = [_local_file("/mnt/usb/local.jpg", "local.jpg")]

        with (
            patch(f"{RCLONE_PATCH}.list_files", return_value=[]),
            patch(f"{LOCAL_SCANNER_PATCH}.list_local_files", return_value=local_files),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(mixed_config)

        assert mock_process.call_count == 1
        _, kwargs = mock_process.call_args
        assert kwargs["source_remote"] == "local:/mnt/usb"

    def test_known_cloud_and_known_local_both_skipped(
        self,
        mixed_config: PhotoMindConfig,
        db_path: Path,
        chroma_mock: MagicMock,
    ) -> None:
        """Already-processed files from both source types are skipped."""
        now = int(time.time())
        create_photo(
            db_path,
            PhotoRecord(
                id="cloud-uuid",
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/cloud.jpg",
                status="DONE",
                created_at=now,
                updated_at=now,
            ),
        )
        create_photo(
            db_path,
            PhotoRecord(
                id="local-uuid",
                source_remote="local:/mnt/usb",
                source_path="/mnt/usb/local.jpg",
                status="DONE",
                created_at=now,
                updated_at=now,
            ),
        )

        cloud_files = [_remote_file("2024/cloud.jpg", "cloud.jpg")]
        local_files = [_local_file("/mnt/usb/local.jpg", "local.jpg")]

        with (
            patch(f"{RCLONE_PATCH}.list_files", return_value=cloud_files),
            patch(f"{LOCAL_SCANNER_PATCH}.list_local_files", return_value=local_files),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(mixed_config)

        mock_process.assert_not_called()
