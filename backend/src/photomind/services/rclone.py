"""
rclone service — thin wrapper around the rclone CLI.

Provides list_files, download_file, and upload_file as the primary interface
for the PhotoMind pipeline to interact with OneDrive (and any other rclone
remote).  All subprocess calls use capture_output=True + text=True so output
is always available for diagnostics on failure.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass
class RemoteFile:
    """Represents a single entry returned by `rclone lsjson`."""

    path: str  # relative path on the remote
    name: str  # filename only
    size: int  # bytes (-1 for directories)
    is_dir: bool


class RcloneError(Exception):
    """Raised when rclone exits with a non-zero return code."""


def list_files(remote: str, remote_path: str) -> list[RemoteFile]:
    """List files in a remote directory using ``rclone lsjson``.

    Args:
        remote: rclone remote name (e.g. ``"onedrive_karthik"``).
        remote_path: path on the remote (e.g. ``"/Pictures/2024"``).

    Returns:
        List of :class:`RemoteFile` objects (top-level only — not recursive).

    Raises:
        RcloneError: if rclone exits with a non-zero return code.
    """
    target = f"{remote}:{remote_path}"
    result = subprocess.run(
        ["rclone", "lsjson", target],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        raise RcloneError(
            f"rclone lsjson failed for {target!r} "
            f"(exit {result.returncode}): {result.stderr.strip()}"
        )

    entries: list[dict[str, object]] = json.loads(result.stdout)
    return [
        RemoteFile(
            path=str(entry["Path"]),
            name=str(entry["Name"]),
            size=int(entry["Size"]),  # type: ignore[arg-type]
            is_dir=bool(entry["IsDir"]),
        )
        for entry in entries
    ]


def download_file(
    remote: str,
    remote_path: str,
    local_dest: str | Path,
) -> Path:
    """Download a single file from a remote using ``rclone copy``.

    rclone copy downloads the *file* into ``local_dest`` (a directory).  The
    returned :class:`Path` points to ``local_dest / <filename>``.

    Args:
        remote: rclone remote name.
        remote_path: full path to the file on the remote (e.g.
            ``"/Pictures/2024/IMG_001.jpg"``).
        local_dest: local directory to download into.

    Returns:
        :class:`Path` to the downloaded file on disk.

    Raises:
        RcloneError: if rclone exits with a non-zero return code.
    """
    local_dest = Path(local_dest)
    source = f"{remote}:{remote_path}"
    result = subprocess.run(
        ["rclone", "copy", source, str(local_dest)],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        raise RcloneError(
            f"rclone copy failed for {source!r} → {local_dest} "
            f"(exit {result.returncode}): {result.stderr.strip()}"
        )

    filename = Path(remote_path).name
    return local_dest / filename


def upload_file(
    local_path: str | Path,
    remote: str,
    remote_path: str,
) -> None:
    """Upload a single file to a remote using ``rclone copy``.

    Args:
        local_path: path to the local file to upload.
        remote: rclone remote name.
        remote_path: destination *directory* on the remote (e.g.
            ``"/PhotoMind/library/2024"``).

    Raises:
        RcloneError: if rclone exits with a non-zero return code.
    """
    local_path = Path(local_path)
    destination = f"{remote}:{remote_path}"
    result = subprocess.run(
        ["rclone", "copy", str(local_path), destination],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        raise RcloneError(
            f"rclone copy failed for {local_path} → {destination!r} "
            f"(exit {result.returncode}): {result.stderr.strip()}"
        )
