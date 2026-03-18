"""
PhotoMind configuration.

Reads from config.yaml (gitignored). Falls back to environment variables
for CI and testing environments where config.yaml doesn't exist.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class SourceConfig:
    remote: str
    scan_path: str
    label: str


@dataclass
class OutputConfig:
    remote: str
    path: str


@dataclass
class PipelineConfig:
    batch_size: int = 10
    max_concurrent: int = 1
    meme_threshold: float = 0.7
    dedup_hamming_threshold: int = 10


@dataclass
class ClipConfig:
    model: str = "ViT-B/32"
    precision: str = "float16"


@dataclass
class InsightFaceConfig:
    model: str = "buffalo_sc"
    det_thresh: float = 0.5


@dataclass
class DaemonConfig:
    scan_interval_seconds: int = 3600
    face_cluster_interval_seconds: int = 86400


@dataclass
class PhotoMindConfig:
    database_path: str = field(
        default_factory=lambda: os.environ.get(
            "DATABASE_PATH", str(Path.home() / "photomind" / "photomind.db")
        )
    )
    chroma_db_path: str = field(
        default_factory=lambda: os.environ.get(
            "CHROMA_DB_PATH", str(Path.home() / "photomind" / "chroma_db")
        )
    )
    thumbnails_path: str = field(
        default_factory=lambda: os.environ.get(
            "THUMBNAILS_PATH", str(Path.home() / "photomind" / "thumbnails")
        )
    )
    tmp_path: str = field(
        default_factory=lambda: os.environ.get(
            "TMP_PATH", str(Path.home() / "photomind" / "tmp")
        )
    )
    sources: list[SourceConfig] = field(default_factory=list)
    output: OutputConfig = field(
        default_factory=lambda: OutputConfig(
            remote="onedrive_karthik", path="PhotoMind/library/"
        )
    )
    pipeline: PipelineConfig = field(default_factory=PipelineConfig)
    clip: ClipConfig = field(default_factory=ClipConfig)
    insightface: InsightFaceConfig = field(default_factory=InsightFaceConfig)
    daemon: DaemonConfig = field(default_factory=DaemonConfig)


def load_config(config_path: str | None = None) -> PhotoMindConfig:
    """
    Load configuration from config.yaml if it exists, otherwise return defaults.

    This design allows tests to run without a config.yaml present.
    Production deployments override defaults via config.yaml.
    """
    path = Path(config_path or os.environ.get("CONFIG_PATH", "config.yaml"))

    if not path.exists():
        return PhotoMindConfig()

    try:
        import yaml  # type: ignore[import-untyped]
    except ImportError:
        # yaml not installed yet (bootstrap phase) — return defaults
        return PhotoMindConfig()

    with open(path) as f:
        data = yaml.safe_load(f) or {}

    sources = [
        SourceConfig(
            remote=s["remote"],
            scan_path=s["scan_path"],
            label=s.get("label", s["remote"]),
        )
        for s in data.get("sources", [])
    ]

    output_data = data.get("output", {})
    pipeline_data = data.get("pipeline", {})
    clip_data = data.get("clip", {})
    insightface_data = data.get("insightface", {})
    daemon_data = data.get("daemon", {})

    return PhotoMindConfig(
        database_path=data.get("database_path", PhotoMindConfig().database_path),
        chroma_db_path=data.get("chroma_db_path", PhotoMindConfig().chroma_db_path),
        thumbnails_path=data.get("thumbnails_path", PhotoMindConfig().thumbnails_path),
        tmp_path=data.get("tmp_path", PhotoMindConfig().tmp_path),
        sources=sources,
        output=OutputConfig(
            remote=output_data.get("remote", "onedrive_karthik"),
            path=output_data.get("path", "PhotoMind/library/"),
        ),
        pipeline=PipelineConfig(**pipeline_data) if pipeline_data else PipelineConfig(),
        clip=ClipConfig(**clip_data) if clip_data else ClipConfig(),
        insightface=InsightFaceConfig(**insightface_data)
        if insightface_data
        else InsightFaceConfig(),
        daemon=DaemonConfig(**daemon_data) if daemon_data else DaemonConfig(),
    )


# Module-level singleton — tests can monkey-patch this
_config: PhotoMindConfig | None = None


def get_config() -> PhotoMindConfig:
    global _config
    if _config is None:
        _config = load_config()
    return _config


def reset_config() -> None:
    """Reset singleton — used in tests."""
    global _config
    _config = None
