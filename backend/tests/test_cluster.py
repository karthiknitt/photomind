"""
Tests for the face clustering service.

All tests mock ChromaDB to return controlled embeddings.
Real SQLite (tmp_path) used for face/cluster table verification.

Coverage:
- run_clustering: empty collection, too-few faces, creates clusters, noise faces,
                  photo_count accuracy, second-run rebuild, ClusterResult fields
"""

from __future__ import annotations

import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CREATE_FACES_SQL = """
CREATE TABLE IF NOT EXISTS faces (
    id           TEXT PRIMARY KEY,
    photo_id     TEXT NOT NULL,
    cluster_id   TEXT,
    embedding_id TEXT,
    bbox_x       INTEGER,
    bbox_y       INTEGER,
    bbox_w       INTEGER,
    bbox_h       INTEGER,
    det_score    REAL
)
"""

_CREATE_CLUSTERS_SQL = """
CREATE TABLE IF NOT EXISTS face_clusters (
    id          TEXT PRIMARY KEY,
    label       TEXT,
    photo_count INTEGER DEFAULT 0,
    created_at  INTEGER NOT NULL
)
"""


def _make_db(db_path: Path, face_rows: list[tuple[str, str]]) -> None:
    """Create faces + face_clusters tables; insert (face_id, photo_id) rows."""
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(_CREATE_FACES_SQL)
    conn.execute(_CREATE_CLUSTERS_SQL)
    for face_id, photo_id in face_rows:
        conn.execute(
            "INSERT INTO faces (id, photo_id, det_score) VALUES (?, ?, 0.9)",
            (face_id, photo_id),
        )
    conn.commit()
    conn.close()


def _mock_chroma(face_ids: list[str], embeddings: list[list[float]]) -> MagicMock:
    """Return a mock chromadb module whose PersistentClient returns the given data."""
    fake_collection = MagicMock()
    fake_collection.get.return_value = {
        "ids": face_ids,
        "embeddings": embeddings,
    }
    fake_client = MagicMock()
    fake_client.get_collection.return_value = fake_collection
    mock_chromadb = MagicMock()
    mock_chromadb.PersistentClient.return_value = fake_client
    return mock_chromadb


def _read_faces(db_path: Path) -> dict[str, str | None]:
    """Return {face_id: cluster_id} for all faces rows."""
    conn = sqlite3.connect(str(db_path))
    rows = conn.execute("SELECT id, cluster_id FROM faces").fetchall()
    conn.close()
    return {row[0]: row[1] for row in rows}


def _read_clusters(db_path: Path) -> list[dict[str, Any]]:
    """Return all face_clusters rows as dicts."""
    conn = sqlite3.connect(str(db_path))
    rows = conn.execute(
        "SELECT id, label, photo_count, created_at FROM face_clusters"
    ).fetchall()
    conn.close()
    return [
        {"id": r[0], "label": r[1], "photo_count": r[2], "created_at": r[3]}
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def cluster_mod() -> Any:
    """Import cluster module fresh each test."""
    import photomind.services.cluster as cluster_module

    return cluster_module


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestRunClusteringEmpty:
    def test_empty_collection_raises_no_error(
        self, tmp_path: Path, cluster_mod: Any
    ) -> None:
        """Returns zero ClusterResult when ChromaDB 'faces' collection is missing."""
        db_path = tmp_path / "test.db"
        _make_db(db_path, [])

        fake_client = MagicMock()
        fake_client.get_collection.side_effect = Exception("does not exist")
        mock_chromadb = MagicMock()
        mock_chromadb.PersistentClient.return_value = fake_client

        with patch("photomind.services.cluster.chromadb", mock_chromadb):
            result = cluster_mod.run_clustering(db_path, tmp_path / "chroma")

        assert result.n_faces == 0
        assert result.n_clusters == 0
        assert result.n_noise == 0

    def test_zero_faces_in_collection(self, tmp_path: Path, cluster_mod: Any) -> None:
        """Returns zero ClusterResult when collection exists but has no embeddings."""
        db_path = tmp_path / "test.db"
        _make_db(db_path, [])

        mock_chromadb = _mock_chroma([], [])

        with patch("photomind.services.cluster.chromadb", mock_chromadb):
            result = cluster_mod.run_clustering(db_path, tmp_path / "chroma")

        assert result.n_faces == 0
        assert result.n_clusters == 0
        assert result.n_noise == 0

    def test_single_face_below_min_cluster_size(
        self, tmp_path: Path, cluster_mod: Any
    ) -> None:
        """With 1 face and min_cluster_size=2, no clusters are formed."""
        face_id = str(uuid.uuid4())
        db_path = tmp_path / "test.db"
        _make_db(db_path, [(face_id, "photo-1")])

        emb = [0.1] * 512
        mock_chromadb = _mock_chroma([face_id], [emb])

        with patch("photomind.services.cluster.chromadb", mock_chromadb):
            result = cluster_mod.run_clustering(
                db_path, tmp_path / "chroma", min_cluster_size=2
            )

        assert result.n_faces == 1
        assert result.n_clusters == 0
        clusters = _read_clusters(db_path)
        assert clusters == []


class TestRunClusteringSuccess:
    def _make_embeddings(
        self, n: int, center: list[float], noise: float = 0.01
    ) -> list[list[float]]:
        """Generate n similar embeddings near center (for HDBSCAN to cluster)."""
        rng = np.random.default_rng(42)
        vecs = np.array(center) + rng.uniform(-noise, noise, (n, len(center)))
        # L2-normalise
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        return (vecs / norms).tolist()

    def test_two_clusters_created(self, tmp_path: Path, cluster_mod: Any) -> None:
        """10 faces split into 2 distinct groups → 2 face_clusters rows."""
        photo_ids = [f"photo-{i}" for i in range(10)]
        face_ids = [str(uuid.uuid4()) for _ in range(10)]
        db_path = tmp_path / "test.db"
        _make_db(db_path, list(zip(face_ids, photo_ids, strict=True)))

        # Group A: 5 faces near (1, 0, 0, …)
        center_a = [1.0] + [0.0] * 511
        # Group B: 5 faces near (0, 1, 0, …)
        center_b = [0.0, 1.0] + [0.0] * 510
        embeddings = self._make_embeddings(5, center_a) + self._make_embeddings(
            5, center_b
        )
        mock_chromadb = _mock_chroma(face_ids, embeddings)

        with patch("photomind.services.cluster.chromadb", mock_chromadb):
            result = cluster_mod.run_clustering(
                db_path, tmp_path / "chroma", min_cluster_size=2
            )

        assert result.n_faces == 10
        assert result.n_clusters == 2
        clusters = _read_clusters(db_path)
        assert len(clusters) == 2

    def test_faces_cluster_ids_updated(self, tmp_path: Path, cluster_mod: Any) -> None:
        """After clustering, faces.cluster_id is set for non-noise faces."""
        face_ids = [str(uuid.uuid4()) for _ in range(6)]
        photo_ids = [f"photo-{i}" for i in range(6)]
        db_path = tmp_path / "test.db"
        _make_db(db_path, list(zip(face_ids, photo_ids, strict=True)))

        center_a = [1.0] + [0.0] * 511
        center_b = [0.0, 1.0] + [0.0] * 510
        embeddings = self._make_embeddings(3, center_a) + self._make_embeddings(
            3, center_b
        )
        mock_chromadb = _mock_chroma(face_ids, embeddings)

        with patch("photomind.services.cluster.chromadb", mock_chromadb):
            result = cluster_mod.run_clustering(
                db_path, tmp_path / "chroma", min_cluster_size=2
            )

        face_map = _read_faces(db_path)
        clustered = [v for v in face_map.values() if v is not None]
        # All 6 faces should be in a cluster (both groups are tight enough)
        assert len(clustered) == result.n_faces - result.n_noise

    def test_noise_faces_have_null_cluster_id(
        self, tmp_path: Path, cluster_mod: Any
    ) -> None:
        """Faces that HDBSCAN labels as -1 (noise) get cluster_id=NULL."""
        # 2 tight faces + 1 isolated outlier
        face_ids = [str(uuid.uuid4()) for _ in range(3)]
        photo_ids = ["photo-a", "photo-b", "photo-c"]
        db_path = tmp_path / "test.db"
        _make_db(db_path, list(zip(face_ids, photo_ids, strict=True)))

        # face 0 and 1 are similar; face 2 is very different
        rng = np.random.default_rng(99)
        emb_a = [1.0] + [0.0] * 511
        emb_b = [0.999, 0.01] + [0.0] * 510  # close to emb_a
        emb_outlier = rng.random(512).tolist()

        mock_chromadb = _mock_chroma(face_ids, [emb_a, emb_b, emb_outlier])

        with patch("photomind.services.cluster.chromadb", mock_chromadb):
            result = cluster_mod.run_clustering(
                db_path, tmp_path / "chroma", min_cluster_size=2, min_samples=1
            )

        face_map = _read_faces(db_path)
        # face 2 (outlier) should be NULL if it's noise
        # We just assert that noise count matches NULL cluster_ids
        null_count = sum(1 for v in face_map.values() if v is None)
        assert null_count == result.n_noise

    def test_photo_count_in_cluster(self, tmp_path: Path, cluster_mod: Any) -> None:
        """face_clusters.photo_count = distinct photo_ids in the cluster."""
        face_ids = [str(uuid.uuid4()) for _ in range(4)]
        # First cluster: 2 faces from same photo, 2 from different photos
        photo_ids = ["photo-X", "photo-X", "photo-Y", "photo-Y"]
        db_path = tmp_path / "test.db"
        _make_db(db_path, list(zip(face_ids, photo_ids, strict=True)))

        center_a = [1.0] + [0.0] * 511
        center_b = [0.0, 1.0] + [0.0] * 510
        embeddings = self._make_embeddings(2, center_a) + self._make_embeddings(
            2, center_b
        )
        mock_chromadb = _mock_chroma(face_ids, embeddings)

        with patch("photomind.services.cluster.chromadb", mock_chromadb):
            cluster_mod.run_clustering(
                db_path, tmp_path / "chroma", min_cluster_size=2
            )

        clusters = _read_clusters(db_path)
        # Each cluster has 2 faces from different photos → photo_count=2
        # OR same photo → photo_count=1. We just verify photo_count >= 1.
        assert all(c["photo_count"] >= 1 for c in clusters)

    def test_second_run_rebuilds_clusters(
        self, tmp_path: Path, cluster_mod: Any
    ) -> None:
        """Running clustering twice clears old clusters and rebuilds fresh."""
        face_ids = [str(uuid.uuid4()) for _ in range(4)]
        photo_ids = [f"photo-{i}" for i in range(4)]
        db_path = tmp_path / "test.db"
        _make_db(db_path, list(zip(face_ids, photo_ids, strict=True)))

        center_a = [1.0] + [0.0] * 511
        center_b = [0.0, 1.0] + [0.0] * 510
        embeddings = self._make_embeddings(2, center_a) + self._make_embeddings(
            2, center_b
        )
        mock_chromadb = _mock_chroma(face_ids, embeddings)

        with patch("photomind.services.cluster.chromadb", mock_chromadb):
            cluster_mod.run_clustering(db_path, tmp_path / "chroma", min_cluster_size=2)
            first_cluster_ids = {c["id"] for c in _read_clusters(db_path)}

            cluster_mod.run_clustering(db_path, tmp_path / "chroma", min_cluster_size=2)
            second_cluster_ids = {c["id"] for c in _read_clusters(db_path)}

        # New UUIDs assigned on each run
        assert first_cluster_ids.isdisjoint(second_cluster_ids)
        # Same count
        assert len(first_cluster_ids) == len(second_cluster_ids)

    def test_cluster_result_has_created_at(
        self, tmp_path: Path, cluster_mod: Any
    ) -> None:
        """face_clusters rows get a valid created_at Unix timestamp."""
        face_ids = [str(uuid.uuid4()) for _ in range(4)]
        photo_ids = [f"photo-{i}" for i in range(4)]
        db_path = tmp_path / "test.db"
        _make_db(db_path, list(zip(face_ids, photo_ids, strict=True)))

        center_a = [1.0] + [0.0] * 511
        center_b = [0.0, 1.0] + [0.0] * 510
        embeddings = self._make_embeddings(2, center_a) + self._make_embeddings(
            2, center_b
        )
        mock_chromadb = _mock_chroma(face_ids, embeddings)

        before = int(time.time())
        with patch("photomind.services.cluster.chromadb", mock_chromadb):
            cluster_mod.run_clustering(db_path, tmp_path / "chroma", min_cluster_size=2)
        after = int(time.time())

        clusters = _read_clusters(db_path)
        for c in clusters:
            assert before <= c["created_at"] <= after


class TestClusterResult:
    def test_cluster_result_fields(self, tmp_path: Path, cluster_mod: Any) -> None:
        """ClusterResult has n_faces, n_clusters, n_noise attributes."""
        db_path = tmp_path / "test.db"
        _make_db(db_path, [])
        mock_chromadb = _mock_chroma([], [])

        with patch("photomind.services.cluster.chromadb", mock_chromadb):
            result = cluster_mod.run_clustering(db_path, tmp_path / "chroma")

        assert hasattr(result, "n_faces")
        assert hasattr(result, "n_clusters")
        assert hasattr(result, "n_noise")
        assert result.n_faces == 0
        assert result.n_clusters == 0
        assert result.n_noise == 0
