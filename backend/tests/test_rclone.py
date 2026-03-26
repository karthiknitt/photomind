"""
Tests for photomind.services.rclone

All rclone CLI calls are mocked via unittest.mock.patch on subprocess.run.
No real rclone binary is required.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from photomind.services.rclone import (
    RcloneError,
    RemoteFile,
    download_file,
    list_files,
    upload_file,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Patch target — module-level is more robust than patching subprocess globally
_PATCH_RUN = "photomind.services.rclone.subprocess.run"

SAMPLE_LSJSON = [
    {
        "Path": "2024/IMG_001.jpg",
        "Name": "IMG_001.jpg",
        "Size": 4200000,
        "IsDir": False,
    },
    {"Path": "2024/subfolder", "Name": "subfolder", "Size": -1, "IsDir": True},
]


def _make_completed_process(
    stdout: str = "",
    stderr: str = "",
    returncode: int = 0,
) -> MagicMock:
    mock = MagicMock(spec=subprocess.CompletedProcess)
    mock.stdout = stdout
    mock.stderr = stderr
    mock.returncode = returncode
    return mock


# ---------------------------------------------------------------------------
# list_files tests
# ---------------------------------------------------------------------------


class TestListFiles:
    def test_returns_remote_file_list(self):
        """list_files returns a list of RemoteFile from valid rclone lsjson output."""
        mock_result = _make_completed_process(stdout=json.dumps(SAMPLE_LSJSON))

        with patch(_PATCH_RUN, return_value=mock_result):
            result = list_files("onedrive_karthik", "/Pictures/2024")

        assert len(result) == 2
        assert all(isinstance(f, RemoteFile) for f in result)

    def test_maps_json_fields_correctly(self):
        """list_files maps Path, Name, Size, IsDir correctly to RemoteFile fields."""
        mock_result = _make_completed_process(stdout=json.dumps(SAMPLE_LSJSON))

        with patch(_PATCH_RUN, return_value=mock_result):
            result = list_files("onedrive_karthik", "/Pictures/2024")

        file_item = result[0]
        assert file_item.path == "2024/IMG_001.jpg"
        assert file_item.name == "IMG_001.jpg"
        assert file_item.size == 4200000
        assert file_item.is_dir is False

        dir_item = result[1]
        assert dir_item.path == "2024/subfolder"
        assert dir_item.name == "subfolder"
        assert dir_item.size == -1
        assert dir_item.is_dir is True

    def test_calls_rclone_with_correct_arguments(self):
        """list_files invokes `rclone lsjson <remote>:<path>`."""
        mock_result = _make_completed_process(stdout=json.dumps(SAMPLE_LSJSON))

        with patch(_PATCH_RUN, return_value=mock_result) as mock_run:
            list_files("onedrive_karthik", "/Pictures/2024")

        mock_run.assert_called_once()
        cmd = mock_run.call_args[0][0]
        assert cmd[0] == "rclone"
        assert cmd[1] == "lsjson"
        assert cmd[2] == "onedrive_karthik:/Pictures/2024"

    def test_raises_rclone_error_on_nonzero_exit(self):
        """list_files raises RcloneError when rclone exits with non-zero code."""
        mock_result = _make_completed_process(
            stderr="NOTICE: Failed to list directory", returncode=1
        )

        with patch(_PATCH_RUN, return_value=mock_result):
            with pytest.raises(RcloneError):
                list_files("onedrive_karthik", "/Pictures/2024")

    def test_handles_empty_directory(self):
        """list_files returns an empty list when rclone returns []."""
        mock_result = _make_completed_process(stdout="[]")

        with patch(_PATCH_RUN, return_value=mock_result):
            result = list_files("onedrive_karthik", "/empty-folder")

        assert result == []

    def test_subprocess_run_called_with_capture_output_and_text(self):
        """list_files passes capture_output=True, text=True to subprocess.run."""
        mock_result = _make_completed_process(stdout=json.dumps(SAMPLE_LSJSON))

        with patch(_PATCH_RUN, return_value=mock_result) as mock_run:
            list_files("onedrive_karthik", "/Pictures/2024")

        _, kwargs = mock_run.call_args
        assert kwargs.get("capture_output") is True
        assert kwargs.get("text") is True


# ---------------------------------------------------------------------------
# download_file tests
# ---------------------------------------------------------------------------


class TestDownloadFile:
    def test_calls_rclone_with_correct_arguments(self, tmp_path):
        """download_file invokes `rclone copy <remote>:<path> <local_dir>`."""
        mock_result = _make_completed_process()

        with patch(_PATCH_RUN, return_value=mock_result) as mock_run:
            download_file("onedrive_karthik", "/Pictures/2024/IMG_001.jpg", tmp_path)

        mock_run.assert_called_once()
        cmd = mock_run.call_args[0][0]
        assert cmd[0] == "rclone"
        assert cmd[1] == "copy"
        assert cmd[2] == "onedrive_karthik:/Pictures/2024/IMG_001.jpg"
        assert cmd[3] == str(tmp_path)

    def test_raises_rclone_error_on_failure(self, tmp_path):
        """download_file raises RcloneError when rclone exits non-zero."""
        mock_result = _make_completed_process(
            stderr="ERROR: transfer failed", returncode=1
        )

        with patch(_PATCH_RUN, return_value=mock_result):
            with pytest.raises(RcloneError):
                download_file(
                    "onedrive_karthik", "/Pictures/2024/IMG_001.jpg", tmp_path
                )

    def test_returns_correct_local_path(self, tmp_path):
        """download_file returns Path pointing to local_dest / filename."""
        mock_result = _make_completed_process()

        with patch(_PATCH_RUN, return_value=mock_result):
            result = download_file(
                "onedrive_karthik", "/Pictures/2024/IMG_001.jpg", tmp_path
            )

        assert isinstance(result, Path)
        assert result == tmp_path / "IMG_001.jpg"

    def test_accepts_string_local_dest(self, tmp_path):
        """download_file accepts local_dest as a plain string."""
        mock_result = _make_completed_process()

        with patch(_PATCH_RUN, return_value=mock_result):
            result = download_file(
                "onedrive_karthik",
                "/Pictures/2024/IMG_001.jpg",
                str(tmp_path),
            )

        assert result == tmp_path / "IMG_001.jpg"

    def test_subprocess_run_called_with_capture_output_and_text(self, tmp_path):
        """download_file passes capture_output=True, text=True to subprocess.run."""
        mock_result = _make_completed_process()

        with patch(_PATCH_RUN, return_value=mock_result) as mock_run:
            download_file("onedrive_karthik", "/Pictures/2024/IMG_001.jpg", tmp_path)

        _, kwargs = mock_run.call_args
        assert kwargs.get("capture_output") is True
        assert kwargs.get("text") is True


# ---------------------------------------------------------------------------
# upload_file tests
# ---------------------------------------------------------------------------


class TestUploadFile:
    def test_calls_rclone_with_correct_arguments(self, tmp_path):
        """upload_file invokes `rclone copy <local_path> <remote>:<remote_path>`."""
        local_file = tmp_path / "processed_IMG_001.jpg"
        local_file.touch()
        mock_result = _make_completed_process()

        with patch(_PATCH_RUN, return_value=mock_result) as mock_run:
            upload_file(local_file, "onedrive_karthik", "/PhotoMind/library/2024")

        mock_run.assert_called_once()
        cmd = mock_run.call_args[0][0]
        assert cmd[0] == "rclone"
        assert cmd[1] == "copy"
        assert cmd[2] == str(local_file)
        assert cmd[3] == "onedrive_karthik:/PhotoMind/library/2024"

    def test_raises_rclone_error_on_failure(self, tmp_path):
        """upload_file raises RcloneError when rclone exits non-zero."""
        local_file = tmp_path / "processed_IMG_001.jpg"
        local_file.touch()
        mock_result = _make_completed_process(
            stderr="ERROR: upload failed", returncode=2
        )

        with patch(_PATCH_RUN, return_value=mock_result):
            with pytest.raises(RcloneError):
                upload_file(local_file, "onedrive_karthik", "/PhotoMind/library/2024")

    def test_accepts_string_local_path(self, tmp_path):
        """upload_file accepts local_path as a plain string."""
        local_file = tmp_path / "processed_IMG_001.jpg"
        local_file.touch()
        mock_result = _make_completed_process()

        with patch(_PATCH_RUN, return_value=mock_result) as mock_run:
            upload_file(str(local_file), "onedrive_karthik", "/PhotoMind/library/2024")

        cmd = mock_run.call_args[0][0]
        assert cmd[2] == str(local_file)

    def test_subprocess_run_called_with_capture_output_and_text(self, tmp_path):
        """upload_file passes capture_output=True, text=True to subprocess.run."""
        local_file = tmp_path / "processed_IMG_001.jpg"
        local_file.touch()
        mock_result = _make_completed_process()

        with patch(_PATCH_RUN, return_value=mock_result) as mock_run:
            upload_file(local_file, "onedrive_karthik", "/PhotoMind/library/2024")

        _, kwargs = mock_run.call_args
        assert kwargs.get("capture_output") is True
        assert kwargs.get("text") is True

    def test_returns_none_on_success(self, tmp_path):
        """upload_file returns None on success."""
        local_file = tmp_path / "processed_IMG_001.jpg"
        local_file.touch()
        mock_result = _make_completed_process()

        with patch(_PATCH_RUN, return_value=mock_result):
            result = upload_file(
                local_file, "onedrive_karthik", "/PhotoMind/library/2024"
            )

        assert result is None


# ---------------------------------------------------------------------------
# Fix 1: trailing slash in remote_path must not produce empty filename
# ---------------------------------------------------------------------------


class TestDownloadFileTrailingSlash:
    def test_trailing_slash_returns_correct_filename(self, tmp_path):
        """download_file strips trailing slash before extracting filename.

        Path("Photos/IMG_001.jpg/").name returns "" — the slash must be
        stripped first so the caller gets local_dest / "IMG_001.jpg", not
        local_dest alone (which would be a directory, not a file).
        """
        mock_result = _make_completed_process()

        with patch(_PATCH_RUN, return_value=mock_result):
            result = download_file(
                "onedrive_karthik", "/Pictures/2024/IMG_001.jpg/", tmp_path
            )

        assert result == tmp_path / "IMG_001.jpg"


# ---------------------------------------------------------------------------
# Fix 2: malformed rclone output must raise RcloneError, not JSONDecodeError
# ---------------------------------------------------------------------------


class TestListFilesParseErrors:
    def test_malformed_json_raises_rclone_error(self):
        """list_files raises RcloneError when rclone stdout is not valid JSON."""
        mock_result = _make_completed_process(stdout="not valid json {{ }")

        with patch(_PATCH_RUN, return_value=mock_result):
            with pytest.raises(RcloneError, match="Failed to parse"):
                list_files("onedrive_karthik", "/Pictures/2024")

    def test_missing_json_keys_raises_rclone_error(self):
        """list_files raises RcloneError when JSON entries lack expected keys."""
        mock_result = _make_completed_process(stdout='[{"Unexpected": "field"}]')

        with patch(_PATCH_RUN, return_value=mock_result):
            with pytest.raises(RcloneError, match="Failed to parse"):
                list_files("onedrive_karthik", "/Pictures/2024")


# ---------------------------------------------------------------------------
# list_files recursive support
# ---------------------------------------------------------------------------


class TestListFilesRecursive:
    """Tests for recursive=True flag on list_files."""

    def test_recursive_calls_lsjson_with_recursive_flag(self) -> None:
        """recursive=True must pass --recursive to rclone lsjson."""
        mock_result = _make_completed_process(stdout=json.dumps([]))
        with patch(_PATCH_RUN, return_value=mock_result) as mock_run:
            list_files("onedrive_karthik", "/Pictures", recursive=True)

        cmd = mock_run.call_args[0][0]
        assert "--recursive" in cmd

    def test_non_recursive_does_not_pass_recursive_flag(self) -> None:
        """Default (recursive=False) must NOT include --recursive."""
        mock_result = _make_completed_process(stdout=json.dumps([]))
        with patch(_PATCH_RUN, return_value=mock_result) as mock_run:
            list_files("onedrive_karthik", "/Pictures")

        cmd = mock_run.call_args[0][0]
        assert "--recursive" not in cmd

    def test_recursive_returns_nested_files(self) -> None:
        """Recursive listing returns files from subdirectories."""
        deep_files = [
            {
                "Path": "2024/Jan/photo.jpg",
                "Name": "photo.jpg",
                "Size": 3000000,
                "IsDir": False,
            },
            {
                "Path": "2024/Feb/pic.jpg",
                "Name": "pic.jpg",
                "Size": 2000000,
                "IsDir": False,
            },
        ]
        mock_result = _make_completed_process(stdout=json.dumps(deep_files))
        with patch(_PATCH_RUN, return_value=mock_result):
            results = list_files("onedrive_karthik", "/Pictures", recursive=True)

        assert len(results) == 2
        assert results[0].path == "2024/Jan/photo.jpg"
        assert results[1].path == "2024/Feb/pic.jpg"

    def test_recursive_error_raises_rclone_error(self) -> None:
        """Errors during recursive listing propagate as RcloneError."""
        mock_result = _make_completed_process(returncode=1, stderr="remote not found")
        with patch(_PATCH_RUN, return_value=mock_result):
            with pytest.raises(RcloneError):
                list_files("onedrive_karthik", "/Pictures", recursive=True)
