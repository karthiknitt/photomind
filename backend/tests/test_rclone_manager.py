"""Tests for rclone_manager service.

Uses unittest.mock to patch subprocess.run and subprocess.Popen so no
real rclone binary is needed.
"""

from __future__ import annotations

import io
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import pytest

from photomind.services.rclone_manager import (
    RcloneManagerError,
    create_oauth_remote,
    create_remote,
    delete_remote,
    get_oauth_auth_url,
    list_remotes,
    test_remote as check_remote_accessible,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ok(stdout: str = "", stderr: str = "") -> SimpleNamespace:
    """Return a mock CompletedProcess with returncode=0."""
    return SimpleNamespace(returncode=0, stdout=stdout, stderr=stderr)


def _fail(stdout: str = "", stderr: str = "error details") -> SimpleNamespace:
    """Return a mock CompletedProcess with returncode=1."""
    return SimpleNamespace(returncode=1, stdout=stdout, stderr=stderr)


# ---------------------------------------------------------------------------
# create_remote
# ---------------------------------------------------------------------------


class TestCreateRemote:
    def test_calls_rclone_config_create_with_correct_args(self) -> None:
        with patch("subprocess.run", return_value=_ok()) as mock_run:
            create_remote(
                "r2_test",
                "s3",
                {"provider": "Cloudflare", "access_key_id": "K"},
            )

        mock_run.assert_called_once()
        cmd = mock_run.call_args[0][0]
        assert cmd[0] == "rclone"
        assert cmd[1] == "config"
        assert cmd[2] == "create"
        assert cmd[3] == "r2_test"
        assert cmd[4] == "s3"
        # params are passed as key=value positional args (order may vary)
        assert "provider=Cloudflare" in cmd
        assert "access_key_id=K" in cmd

    def test_no_params_passes_only_name_and_type(self) -> None:
        with patch("subprocess.run", return_value=_ok()) as mock_run:
            create_remote("my_remote", "dropbox", {})

        cmd = mock_run.call_args[0][0]
        assert cmd == ["rclone", "config", "create", "my_remote", "dropbox"]

    def test_raises_on_nonzero_exit(self) -> None:
        with patch("subprocess.run", return_value=_fail()):
            with pytest.raises(RcloneManagerError, match="rclone config create failed"):
                create_remote("bad_remote", "s3", {})


# ---------------------------------------------------------------------------
# delete_remote
# ---------------------------------------------------------------------------


class TestDeleteRemote:
    def test_calls_rclone_config_delete(self) -> None:
        with patch("subprocess.run", return_value=_ok()) as mock_run:
            delete_remote("r2_test")

        mock_run.assert_called_once()
        cmd = mock_run.call_args[0][0]
        assert cmd == ["rclone", "config", "delete", "r2_test"]

    def test_raises_on_nonzero_exit(self) -> None:
        with patch("subprocess.run", return_value=_fail()):
            with pytest.raises(RcloneManagerError, match="rclone config delete failed"):
                delete_remote("missing_remote")


# ---------------------------------------------------------------------------
# list_remotes
# ---------------------------------------------------------------------------


class TestListRemotes:
    def test_parses_listremotes_output(self) -> None:
        output = "gdrive_karthik:\nonedrive_main:\n"
        with patch("subprocess.run", return_value=_ok(stdout=output)):
            result = list_remotes()

        assert result == ["gdrive_karthik", "onedrive_main"]

    def test_returns_empty_list_when_no_remotes(self) -> None:
        with patch("subprocess.run", return_value=_ok(stdout="")):
            result = list_remotes()

        assert result == []

    def test_strips_trailing_colon_from_each_name(self) -> None:
        output = "r2_bucket:\n"
        with patch("subprocess.run", return_value=_ok(stdout=output)):
            result = list_remotes()

        assert result == ["r2_bucket"]

    def test_raises_on_nonzero_exit(self) -> None:
        with patch("subprocess.run", return_value=_fail()):
            with pytest.raises(RcloneManagerError, match="rclone listremotes failed"):
                list_remotes()


# ---------------------------------------------------------------------------
# test_remote
# ---------------------------------------------------------------------------


class TestTestRemote:
    def test_returns_true_when_accessible(self) -> None:
        with patch("subprocess.run", return_value=_ok()):
            assert check_remote_accessible("r2_test") is True

    def test_returns_false_when_not_accessible(self) -> None:
        with patch("subprocess.run", return_value=_fail()):
            assert check_remote_accessible("r2_test") is False

    def test_does_not_raise_on_failure(self) -> None:
        with patch("subprocess.run", return_value=_fail(stderr="connection refused")):
            # Should return False, NOT raise
            result = check_remote_accessible("bad_remote")
        assert result is False

    def test_calls_rclone_lsd(self) -> None:
        with patch("subprocess.run", return_value=_ok()) as mock_run:
            check_remote_accessible("r2_test")

        cmd = mock_run.call_args[0][0]
        assert cmd == ["rclone", "lsd", "r2_test:"]


# ---------------------------------------------------------------------------
# create_oauth_remote
# ---------------------------------------------------------------------------


class TestCreateOAuthRemote:
    def test_calls_rclone_config_create_with_token(self) -> None:
        token = '{"access_token": "abc123"}'
        with patch("subprocess.run", return_value=_ok()) as mock_run:
            create_oauth_remote("gd", "drive", token)

        mock_run.assert_called_once()
        cmd = mock_run.call_args[0][0]
        assert cmd == [
            "rclone",
            "config",
            "create",
            "gd",
            "drive",
            f"token={token}",
        ]

    def test_raises_on_nonzero_exit(self) -> None:
        with patch("subprocess.run", return_value=_fail()):
            with pytest.raises(RcloneManagerError, match="rclone config create failed"):
                create_oauth_remote("gd", "drive", "{}")


# ---------------------------------------------------------------------------
# get_oauth_auth_url
# ---------------------------------------------------------------------------


class TestGetOAuthAuthUrl:
    def _make_popen_mock(self, stderr_lines: list[str]) -> MagicMock:
        """Return a mock Popen object that yields stderr_lines one by one."""
        mock_proc = MagicMock()
        mock_proc.stderr = iter(stderr_lines)
        mock_proc.terminate = MagicMock()
        mock_proc.wait = MagicMock()
        return mock_proc

    def test_extracts_url_from_stderr(self) -> None:
        lines = [
            "Waiting for code...\n",
            "If your browser doesn't open automatically go to the following link:\n",
            "http://127.0.0.1:53682/auth?state=xyz\n",
            "Log in and authorise rclone for access\n",
        ]
        mock_proc = self._make_popen_mock(lines)

        with patch("subprocess.Popen", return_value=mock_proc):
            url = get_oauth_auth_url("drive")

        assert url == "http://127.0.0.1:53682/auth?state=xyz"
        mock_proc.terminate.assert_called_once()

    def test_raises_if_no_url_found(self) -> None:
        lines = [
            "Some error occurred\n",
            "No URL here\n",
        ]
        mock_proc = self._make_popen_mock(lines)

        with patch("subprocess.Popen", return_value=mock_proc):
            with pytest.raises(RcloneManagerError, match="No OAuth URL"):
                get_oauth_auth_url("dropbox")

    def test_calls_rclone_authorize_with_no_browser(self) -> None:
        lines = ["https://accounts.google.com/o/oauth2/auth?xyz\n"]
        mock_proc = self._make_popen_mock(lines)

        with patch("subprocess.Popen", return_value=mock_proc) as mock_popen:
            get_oauth_auth_url("drive")

        call_args = mock_popen.call_args
        cmd = call_args[0][0]
        assert cmd[0] == "rclone"
        assert cmd[1] == "authorize"
        assert cmd[2] == "drive"
        assert "--auth-no-open-browser" in cmd

    def test_extracts_https_url(self) -> None:
        lines = [
            "Please visit:\n",
            "https://www.dropbox.com/oauth2/authorize?client_id=abc\n",
        ]
        mock_proc = self._make_popen_mock(lines)

        with patch("subprocess.Popen", return_value=mock_proc):
            url = get_oauth_auth_url("dropbox")

        assert url == "https://www.dropbox.com/oauth2/authorize?client_id=abc"
