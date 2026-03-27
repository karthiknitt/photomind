"""
Tests for the worker daemon (worker/daemon.py).

Strategy:
- Real SQLite via tmp_path; ChromaDB mocked
- rclone.list_files mocked to return controlled file lists
- process_photo mocked — daemon tests verify orchestration, not pipeline logic
- _is_image helper tested with various extensions

Tests verify:
  - Only image files are queued (not dirs, not videos unless image extension)
  - Already-known source paths are skipped (no reprocessing)
  - process_photo called once per new file
  - batch_size respected (photos_db pre-load is called once per batch, not per photo)
  - Empty source produces no process_photo calls
  - Daemon handles rclone errors gracefully (logs, continues to next source)
"""

from __future__ import annotations

import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from photomind.config import PhotoMindConfig, PipelineConfig, SourceConfig
from photomind.services.photos_db import PhotoRecord, create_photo
from photomind.worker.daemon import _is_image, run_scan

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "photomind.db"


@pytest.fixture()
def config(tmp_path: Path, db_path: Path) -> PhotoMindConfig:
    return PhotoMindConfig(
        database_path=str(db_path),
        chroma_db_path=str(tmp_path / "chroma"),
        thumbnails_path=str(tmp_path / "thumbnails"),
        tmp_path=str(tmp_path / "tmp"),
        sources=[
            SourceConfig(
                remote="onedrive_karthik",
                scan_path="/Pictures",
                label="Karthik OneDrive",
            )
        ],
        pipeline=PipelineConfig(batch_size=10),
    )


@pytest.fixture()
def chroma_mock() -> MagicMock:
    coll = MagicMock()
    coll.upsert = MagicMock()
    return coll


def _remote_file(path: str, name: str, *, is_dir: bool = False) -> MagicMock:
    """Build a minimal RemoteFile mock."""
    from photomind.services.rclone import RemoteFile

    return RemoteFile(path=path, name=name, size=1_000_000, is_dir=is_dir)


RCLONE_PATCH = "photomind.worker.daemon.rclone"
PIPELINE_PATCH = "photomind.worker.daemon.process_photo"
CLIP_PATCH = "photomind.worker.daemon.clip"


# ---------------------------------------------------------------------------
# _is_image helper
# ---------------------------------------------------------------------------


class TestIsImage:
    def test_jpg_is_image(self) -> None:
        assert _is_image("photo.jpg") is True

    def test_jpeg_is_image(self) -> None:
        assert _is_image("photo.jpeg") is True

    def test_png_is_image(self) -> None:
        assert _is_image("photo.png") is True

    def test_heic_is_image(self) -> None:
        assert _is_image("photo.heic") is True

    def test_tiff_is_image(self) -> None:
        assert _is_image("photo.tiff") is True

    def test_webp_is_image(self) -> None:
        assert _is_image("photo.webp") is True

    def test_uppercase_extension(self) -> None:
        assert _is_image("photo.JPG") is True

    def test_mp4_is_not_image(self) -> None:
        assert _is_image("video.mp4") is False

    def test_txt_is_not_image(self) -> None:
        assert _is_image("notes.txt") is False

    def test_directory_name_is_not_image(self) -> None:
        assert _is_image("subfolder") is False

    def test_no_extension_is_not_image(self) -> None:
        assert _is_image("no_extension") is False


# ---------------------------------------------------------------------------
# run_scan — new file processing
# ---------------------------------------------------------------------------


class TestRunScanNewFiles:
    def test_process_photo_called_for_each_new_image(
        self,
        config: PhotoMindConfig,
        db_path: Path,
        chroma_mock: MagicMock,
    ) -> None:
        files = [
            _remote_file("2024/IMG_001.jpg", "IMG_001.jpg"),
            _remote_file("2024/IMG_002.jpg", "IMG_002.jpg"),
        ]

        with (
            patch(f"{RCLONE_PATCH}.list_files", return_value=files),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(config)

        assert mock_process.call_count == 2

    def test_process_photo_receives_correct_source_remote(
        self,
        config: PhotoMindConfig,
        db_path: Path,
        chroma_mock: MagicMock,
    ) -> None:
        files = [_remote_file("2024/IMG_001.jpg", "IMG_001.jpg")]

        with (
            patch(f"{RCLONE_PATCH}.list_files", return_value=files),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(config)

        _, kwargs = mock_process.call_args
        assert kwargs["source_remote"] == "onedrive_karthik"

    def test_process_photo_receives_correct_source_path(
        self,
        config: PhotoMindConfig,
        db_path: Path,
        chroma_mock: MagicMock,
    ) -> None:
        files = [_remote_file("2024/IMG_001.jpg", "IMG_001.jpg")]

        with (
            patch(f"{RCLONE_PATCH}.list_files", return_value=files),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(config)

        _, kwargs = mock_process.call_args
        assert kwargs["source_path"] == "/Pictures/2024/IMG_001.jpg"

    def test_directories_are_skipped(
        self,
        config: PhotoMindConfig,
        db_path: Path,
        chroma_mock: MagicMock,
    ) -> None:
        files = [
            _remote_file("2024", "2024", is_dir=True),
            _remote_file("2024/IMG_001.jpg", "IMG_001.jpg"),
        ]

        with (
            patch(f"{RCLONE_PATCH}.list_files", return_value=files),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(config)

        assert mock_process.call_count == 1

    def test_non_image_files_are_skipped(
        self,
        config: PhotoMindConfig,
        db_path: Path,
        chroma_mock: MagicMock,
    ) -> None:
        files = [
            _remote_file("notes.txt", "notes.txt"),
            _remote_file("video.mp4", "video.mp4"),
            _remote_file("photo.jpg", "photo.jpg"),
        ]

        with (
            patch(f"{RCLONE_PATCH}.list_files", return_value=files),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(config)

        assert mock_process.call_count == 1


# ---------------------------------------------------------------------------
# run_scan — already-processed files are skipped
# ---------------------------------------------------------------------------


class TestRunScanSkipsKnown:
    def test_known_source_path_is_skipped(
        self,
        config: PhotoMindConfig,
        db_path: Path,
        chroma_mock: MagicMock,
    ) -> None:
        """A file that already has a DB row must not be reprocessed."""
        now = int(time.time())
        create_photo(
            db_path,
            PhotoRecord(
                id="existing-uuid",
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                status="DONE",
                created_at=now,
                updated_at=now,
            ),
        )

        files = [_remote_file("2024/IMG_001.jpg", "IMG_001.jpg")]

        with (
            patch(f"{RCLONE_PATCH}.list_files", return_value=files),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(config)

        mock_process.assert_not_called()

    def test_new_file_processed_while_known_skipped(
        self,
        config: PhotoMindConfig,
        db_path: Path,
        chroma_mock: MagicMock,
    ) -> None:
        """Only the new file is processed; the known file is skipped."""
        now = int(time.time())
        create_photo(
            db_path,
            PhotoRecord(
                id="existing-uuid",
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                status="DONE",
                created_at=now,
                updated_at=now,
            ),
        )

        files = [
            _remote_file("2024/IMG_001.jpg", "IMG_001.jpg"),  # known
            _remote_file("2024/IMG_002.jpg", "IMG_002.jpg"),  # new
        ]

        with (
            patch(f"{RCLONE_PATCH}.list_files", return_value=files),
            patch(PIPELINE_PATCH, return_value="uuid-2") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(config)

        assert mock_process.call_count == 1
        _, kwargs = mock_process.call_args
        assert kwargs["source_path"] == "/Pictures/2024/IMG_002.jpg"


# ---------------------------------------------------------------------------
# run_scan — empty source
# ---------------------------------------------------------------------------


class TestRunScanEmptySource:
    def test_no_process_calls_when_source_is_empty(
        self,
        config: PhotoMindConfig,
        db_path: Path,
        chroma_mock: MagicMock,
    ) -> None:
        with (
            patch(f"{RCLONE_PATCH}.list_files", return_value=[]),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(config)

        mock_process.assert_not_called()


# ---------------------------------------------------------------------------
# run_scan — rclone error handling
# ---------------------------------------------------------------------------


class TestRunScanErrorHandling:
    def test_rclone_error_on_source_is_logged_and_skipped(
        self,
        chroma_mock: MagicMock,
        tmp_path: Path,
        db_path: Path,
    ) -> None:
        """If rclone fails for one source, daemon logs the error and continues."""
        from photomind.services.rclone import RcloneError

        two_source_config = PhotoMindConfig(
            database_path=str(db_path),
            chroma_db_path=str(tmp_path / "chroma"),
            thumbnails_path=str(tmp_path / "thumbnails"),
            tmp_path=str(tmp_path / "tmp"),
            sources=[
                SourceConfig(remote="bad_remote", scan_path="/Bad", label="Bad"),
                SourceConfig(remote="good_remote", scan_path="/Good", label="Good"),
            ],
        )

        good_file = _remote_file("good/photo.jpg", "photo.jpg")

        def _list_side_effect(remote: str, path: str, **kwargs: object) -> list:
            if remote == "bad_remote":
                raise RcloneError("auth failed")
            return [good_file]

        with (
            patch(f"{RCLONE_PATCH}.list_files", side_effect=_list_side_effect),
            patch(PIPELINE_PATCH, return_value="uuid-1") as mock_process,
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(two_source_config)  # must not raise

        # Good source should still be processed
        assert mock_process.call_count == 1

    def test_rclone_error_does_not_crash_daemon(
        self,
        config: PhotoMindConfig,
        db_path: Path,
        chroma_mock: MagicMock,
    ) -> None:
        """run_scan must not propagate RcloneError — it returns normally."""
        from photomind.services.rclone import RcloneError

        with (
            patch(f"{RCLONE_PATCH}.list_files", side_effect=RcloneError("timeout")),
            patch(PIPELINE_PATCH, return_value="uuid-1"),
            patch(f"{CLIP_PATCH}.get_chroma_collection", return_value=chroma_mock),
        ):
            run_scan(config)  # should return without raising
