"""rclone_manager — programmatic management of rclone remote configuration.

Provides functions to create, delete, list and test rclone remotes, as well
as helpers for initiating OAuth flows without requiring SSH access.  All
subprocess calls mirror the pattern used in rclone.py: capture_output=True,
text=True, raise on non-zero exit.
"""

from __future__ import annotations

import logging
import re
import subprocess
from typing import Literal

logger = logging.getLogger(__name__)

OAuthProvider = Literal["drive", "dropbox", "onedrive"]

# Regex to extract an http(s) URL from a line of text
_URL_RE = re.compile(r"https?://\S+")


class RcloneManagerError(Exception):
    """Raised when a rclone config management command fails."""


# ---------------------------------------------------------------------------
# Remote CRUD
# ---------------------------------------------------------------------------


def create_remote(name: str, remote_type: str, params: dict[str, str]) -> None:
    """Create a new rclone remote via ``rclone config create``.

    Args:
        name: Remote name (e.g. ``"gdrive_karthik"``).
        remote_type: rclone backend type (e.g. ``"s3"``, ``"drive"``,
            ``"dropbox"``, ``"onedrive"``).
        params: Key-value pairs for backend config (e.g.
            ``{"provider": "Cloudflare", "access_key_id": "K"}``).
    """
    cmd = ["rclone", "config", "create", name, remote_type]
    cmd.extend(f"{k}={v}" for k, v in params.items())

    logger.debug("Creating rclone remote %r: %s", name, cmd)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RcloneManagerError(
            f"rclone config create failed for {name!r} "
            f"(exit {result.returncode}): {result.stderr.strip()}"
        )


def delete_remote(name: str) -> None:
    """Delete a rclone remote via ``rclone config delete <name>``."""
    cmd = ["rclone", "config", "delete", name]
    logger.debug("Deleting rclone remote %r", name)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RcloneManagerError(
            f"rclone config delete failed for {name!r} "
            f"(exit {result.returncode}): {result.stderr.strip()}"
        )


def list_remotes() -> list[str]:
    """List all configured rclone remotes via ``rclone listremotes``.

    Returns:
        List of remote names **without** trailing colon (e.g.
        ``["gdrive_karthik", "onedrive_main"]``).

    Raises:
        RcloneManagerError: if rclone exits with a non-zero return code.
    """
    result = subprocess.run(["rclone", "listremotes"], capture_output=True, text=True)
    if result.returncode != 0:
        raise RcloneManagerError(
            f"rclone listremotes failed "
            f"(exit {result.returncode}): {result.stderr.strip()}"
        )

    names: list[str] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if line:
            names.append(line.rstrip(":"))
    return names


def test_remote(name: str) -> bool:
    """Test if a remote is accessible via ``rclone lsd <name>:``.

    Returns:
        ``True`` if accessible, ``False`` otherwise.  Does **not** raise.
    """
    result = subprocess.run(
        ["rclone", "lsd", f"{name}:"], capture_output=True, text=True
    )
    if result.returncode != 0:
        logger.debug(
            "rclone lsd %s: returned %d — %s",
            name,
            result.returncode,
            result.stderr.strip(),
        )
        return False
    return True


# ---------------------------------------------------------------------------
# OAuth helpers
# ---------------------------------------------------------------------------


def get_oauth_auth_url(provider: OAuthProvider) -> str:
    """Start a headless OAuth flow and return the authorization URL.

    Runs ``rclone authorize <provider> --auth-no-open-browser`` using
    :class:`subprocess.Popen`, reads stderr line-by-line until a URL is
    found, then terminates the process.

    Args:
        provider: One of ``"drive"``, ``"dropbox"``, or ``"onedrive"``.

    Returns:
        The authorization URL string that the user must open in a browser.

    Raises:
        RcloneManagerError: if no URL is found in the process output.
    """
    cmd = ["rclone", "authorize", provider, "--auth-no-open-browser"]
    logger.debug("Starting OAuth flow for provider %r: %s", provider, cmd)

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    url: str | None = None
    try:
        assert proc.stderr is not None  # guaranteed by stderr=PIPE
        for line in proc.stderr:
            match = _URL_RE.search(line)
            if match:
                url = match.group(0).rstrip(")")  # strip any trailing paren
                logger.debug("Extracted OAuth URL: %s", url)
                break
    finally:
        proc.terminate()
        proc.wait()

    if url is None:
        raise RcloneManagerError(
            f"No OAuth URL found in rclone authorize output for provider {provider!r}"
        )

    return url


def create_oauth_remote(
    name: str,
    provider: OAuthProvider,
    token: str,
) -> None:
    """Create an OAuth remote using an already-obtained token JSON string.

    Args:
        name: Remote name to create (e.g. ``"gd"``).
        provider: rclone backend type (e.g. ``"drive"``).
        token: JSON token string obtained after completing the OAuth flow.

    Raises:
        RcloneManagerError: if rclone exits with a non-zero return code.
    """
    create_remote(name, provider, {"token": token})
