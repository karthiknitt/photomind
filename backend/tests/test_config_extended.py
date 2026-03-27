"""Tests for extended SourceConfig supporting cloud and local source types."""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from photomind.config import PhotoMindConfig, SourceConfig, load_config


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def write_config(tmp_path: Path, content: str) -> Path:
    """Write a config.yaml to tmp_path and return its path."""
    cfg = tmp_path / "config.yaml"
    cfg.write_text(textwrap.dedent(content))
    return cfg


# ---------------------------------------------------------------------------
# SourceConfig dataclass defaults
# ---------------------------------------------------------------------------


def test_source_config_defaults_to_cloud() -> None:
    """SourceConfig default source_type is 'cloud'."""
    src = SourceConfig(remote="onedrive", scan_path="/Pictures", label="OD")
    assert src.source_type == "cloud"


def test_source_config_local_type() -> None:
    """SourceConfig can be created with source_type='local'."""
    src = SourceConfig(source_type="local", local_path="/mnt/usb/DCIM", label="USB")
    assert src.source_type == "local"
    assert src.local_path == "/mnt/usb/DCIM"
    assert src.remote is None
    assert src.scan_path is None


def test_source_config_cloud_type() -> None:
    """SourceConfig cloud type stores remote and scan_path."""
    src = SourceConfig(source_type="cloud", remote="od_karthik", scan_path="/Photos")
    assert src.source_type == "cloud"
    assert src.remote == "od_karthik"
    assert src.scan_path == "/Photos"
    assert src.local_path is None


# ---------------------------------------------------------------------------
# load_config — no config.yaml (default behaviour must be unchanged)
# ---------------------------------------------------------------------------


def test_load_config_no_file_returns_empty_sources(tmp_path: Path) -> None:
    """load_config returns empty sources list when config.yaml is absent."""
    cfg = load_config(str(tmp_path / "nonexistent.yaml"))
    assert isinstance(cfg, PhotoMindConfig)
    assert cfg.sources == []


# ---------------------------------------------------------------------------
# load_config — cloud source (existing YAML format must keep working)
# ---------------------------------------------------------------------------


def test_load_config_cloud_source(tmp_path: Path) -> None:
    """Existing cloud-only YAML format parses to SourceConfig(source_type='cloud')."""
    path = write_config(
        tmp_path,
        """
        sources:
          - remote: onedrive_karthik
            scan_path: /Pictures
            label: My OneDrive
        """,
    )
    cfg = load_config(str(path))
    assert len(cfg.sources) == 1
    src = cfg.sources[0]
    assert src.source_type == "cloud"
    assert src.remote == "onedrive_karthik"
    assert src.scan_path == "/Pictures"
    assert src.label == "My OneDrive"
    assert src.local_path is None


def test_load_config_cloud_source_label_defaults_to_remote(tmp_path: Path) -> None:
    """Cloud source label defaults to remote name when not specified."""
    path = write_config(
        tmp_path,
        """
        sources:
          - remote: onedrive_karthik
            scan_path: /Pictures
        """,
    )
    cfg = load_config(str(path))
    assert cfg.sources[0].label == "onedrive_karthik"


# ---------------------------------------------------------------------------
# load_config — local source (new YAML format)
# ---------------------------------------------------------------------------


def test_load_config_local_source(tmp_path: Path) -> None:
    """YAML source entry with 'path' key parses to SourceConfig(source_type='local')."""
    path = write_config(
        tmp_path,
        """
        sources:
          - path: /mnt/usb_drive/DCIM
            label: USB Drive
        """,
    )
    cfg = load_config(str(path))
    assert len(cfg.sources) == 1
    src = cfg.sources[0]
    assert src.source_type == "local"
    assert src.local_path == "/mnt/usb_drive/DCIM"
    assert src.label == "USB Drive"
    assert src.remote is None
    assert src.scan_path is None


def test_load_config_local_source_label_defaults_to_path(tmp_path: Path) -> None:
    """Local source label defaults to path value when not specified."""
    path = write_config(
        tmp_path,
        """
        sources:
          - path: /mnt/usb_drive/DCIM
        """,
    )
    cfg = load_config(str(path))
    assert cfg.sources[0].label == "/mnt/usb_drive/DCIM"


# ---------------------------------------------------------------------------
# load_config — mixed sources (cloud + local in same YAML)
# ---------------------------------------------------------------------------


def test_load_config_mixed_sources(tmp_path: Path) -> None:
    """YAML with both cloud and local sources parses correctly."""
    path = write_config(
        tmp_path,
        """
        sources:
          - remote: onedrive_karthik
            scan_path: /Pictures
            label: My OneDrive
          - path: /mnt/usb_drive/DCIM
            label: USB Drive
          - path: /mnt/hdd/Photos
        """,
    )
    cfg = load_config(str(path))
    assert len(cfg.sources) == 3

    cloud = cfg.sources[0]
    assert cloud.source_type == "cloud"
    assert cloud.remote == "onedrive_karthik"
    assert cloud.label == "My OneDrive"

    usb = cfg.sources[1]
    assert usb.source_type == "local"
    assert usb.local_path == "/mnt/usb_drive/DCIM"
    assert usb.label == "USB Drive"

    hdd = cfg.sources[2]
    assert hdd.source_type == "local"
    assert hdd.local_path == "/mnt/hdd/Photos"
    assert hdd.label == "/mnt/hdd/Photos"  # defaults to path
