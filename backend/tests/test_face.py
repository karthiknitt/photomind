"""
Tests for the face detection service.

All tests use mocked InsightFace model to avoid loading heavy model weights.
ChromaDB tests use in-memory client for zero disk I/O.

Coverage:
- detect: empty list, filtering by det_thresh, bbox mapping, embedding type,
          FileNotFoundError, unique face_ids
- store_faces: no-op for empty list, SQLite row insert, ChromaDB upsert,
               multiple faces, cluster_id is NULL
- _get_app: singleton (no double-load)
"""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import chromadb
import numpy as np
import pytest
from PIL import Image


# ---------------------------------------------------------------------------
# Helpers — build fake InsightFace face objects
# ---------------------------------------------------------------------------


def _make_fake_face(
    bbox: list[float],
    det_score: float,
    embedding_dim: int = 512,
) -> MagicMock:
    """Return a mock that mimics an InsightFace face object."""
    face = MagicMock()
    face.bbox = np.array(bbox, dtype=np.float32)
    face.det_score = det_score
    face.embedding = np.random.default_rng(42).random(embedding_dim).astype(np.float32)
    return face


def _make_mock_app(faces: list[MagicMock]) -> MagicMock:
    """Return a mock FaceAnalysis app whose .get() returns *faces*."""
    app = MagicMock()
    app.get.return_value = faces
    return app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def sample_image(tmp_path: Path) -> Path:
    """Create a small valid PNG image for testing."""
    img = Image.new("RGB", (64, 64), color=(128, 64, 32))
    img_path = tmp_path / "sample.png"
    img.save(img_path)
    return img_path


@pytest.fixture()
def face_mod() -> Any:
    """Import face module with singleton reset before/after each test."""
    import photomind.services.face as face_module

    face_module._app = None
    yield face_module
    face_module._app = None


# ---------------------------------------------------------------------------
# TestFaceDetection
# ---------------------------------------------------------------------------


class TestFaceDetection:
    def test_detect_returns_empty_for_no_faces(
        self, sample_image: Path, face_mod: Any
    ) -> None:
        mock_app = _make_mock_app([])
        with patch.object(face_mod, "_get_app", return_value=mock_app):
            result = face_mod.detect(sample_image)
        assert result == []

    def test_detect_filters_below_det_thresh(
        self, sample_image: Path, face_mod: Any
    ) -> None:
        low_score_face = _make_fake_face([0, 0, 50, 50], det_score=0.3)
        high_score_face = _make_fake_face([10, 10, 60, 60], det_score=0.8)
        mock_app = _make_mock_app([low_score_face, high_score_face])

        with patch.object(face_mod, "_get_app", return_value=mock_app):
            result = face_mod.detect(sample_image, det_thresh=0.5)

        assert len(result) == 1
        assert result[0].det_score == pytest.approx(0.8)

    def test_detect_maps_bbox_correctly(
        self, sample_image: Path, face_mod: Any
    ) -> None:
        # bbox=[x1, y1, x2, y2] → bbox_x=x1, bbox_y=y1, bbox_w=x2-x1, bbox_h=y2-y1
        face = _make_fake_face([10.5, 20.5, 50.5, 80.5], det_score=0.9)
        mock_app = _make_mock_app([face])

        with patch.object(face_mod, "_get_app", return_value=mock_app):
            result = face_mod.detect(sample_image)

        assert len(result) == 1
        fd = result[0]
        assert fd.bbox_x == 10
        assert fd.bbox_y == 20
        assert fd.bbox_w == 40  # 50 - 10
        assert fd.bbox_h == 60  # 80 - 20

    def test_detect_embedding_is_list_of_floats(
        self, sample_image: Path, face_mod: Any
    ) -> None:
        face = _make_fake_face([0, 0, 50, 50], det_score=0.9)
        mock_app = _make_mock_app([face])

        with patch.object(face_mod, "_get_app", return_value=mock_app):
            result = face_mod.detect(sample_image)

        assert len(result) == 1
        emb = result[0].embedding
        assert isinstance(emb, list)
        assert len(emb) == 512
        assert all(isinstance(v, float) for v in emb)

    def test_detect_raises_for_missing_file(self, face_mod: Any) -> None:
        with pytest.raises(FileNotFoundError):
            face_mod.detect("/nonexistent.jpg")

    def test_detect_face_id_is_unique_uuid(
        self, sample_image: Path, face_mod: Any
    ) -> None:
        faces = [
            _make_fake_face([0, 0, 50, 50], det_score=0.9),
            _make_fake_face([60, 60, 120, 120], det_score=0.85),
        ]
        mock_app = _make_mock_app(faces)

        with patch.object(face_mod, "_get_app", return_value=mock_app):
            result = face_mod.detect(sample_image)

        assert len(result) == 2
        id1, id2 = result[0].face_id, result[1].face_id
        # Both must be valid UUIDs
        uuid.UUID(id1)
        uuid.UUID(id2)
        assert id1 != id2


# ---------------------------------------------------------------------------
# TestStoreFaces
# ---------------------------------------------------------------------------


class TestStoreFaces:
    def test_store_faces_noop_for_empty_list(self, tmp_path: Path) -> None:
        db_path = tmp_path / "faces.db"
        chroma_path = tmp_path / "chroma"

        from photomind.services.face import store_faces

        store_faces(db_path, chroma_path, "photo-001", [])

        # DB file may not even exist — if it does, table should have 0 rows
        if db_path.exists():
            conn = sqlite3.connect(str(db_path))
            try:
                count = conn.execute(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='faces'"
                ).fetchone()[0]
                if count:
                    row_count = conn.execute("SELECT COUNT(*) FROM faces").fetchone()[0]
                    assert row_count == 0
            finally:
                conn.close()

    def test_store_faces_inserts_sqlite_row(self, tmp_path: Path, face_mod: Any) -> None:
        from photomind.services.face import FaceDetection, store_faces

        db_path = tmp_path / "faces.db"
        chroma_path = tmp_path / "chroma"
        photo_id = "photo-abc"
        face_id = str(uuid.uuid4())
        embedding = [0.1] * 512

        fd = FaceDetection(
            face_id=face_id,
            bbox_x=10,
            bbox_y=20,
            bbox_w=40,
            bbox_h=60,
            det_score=0.95,
            embedding=embedding,
        )

        store_faces(db_path, chroma_path, photo_id, [fd])

        conn = sqlite3.connect(str(db_path))
        try:
            row = conn.execute(
                "SELECT id, photo_id, bbox_x, bbox_y, bbox_w, bbox_h, det_score, cluster_id "
                "FROM faces WHERE id = ?",
                (face_id,),
            ).fetchone()
        finally:
            conn.close()

        assert row is not None
        assert row[0] == face_id
        assert row[1] == photo_id
        assert row[2] == 10
        assert row[3] == 20
        assert row[4] == 40
        assert row[5] == 60
        assert row[6] == pytest.approx(0.95)

    def test_store_faces_upserts_to_chroma(self, tmp_path: Path, face_mod: Any) -> None:
        from photomind.services.face import FaceDetection, store_faces

        db_path = tmp_path / "faces.db"
        photo_id = "photo-chroma"
        face_id = str(uuid.uuid4())
        embedding = [0.5] * 512

        fd = FaceDetection(
            face_id=face_id,
            bbox_x=0,
            bbox_y=0,
            bbox_w=50,
            bbox_h=50,
            det_score=0.9,
            embedding=embedding,
        )

        # Use an in-memory ChromaDB client to verify the upsert
        in_mem_client = chromadb.Client()
        fake_collection = in_mem_client.get_or_create_collection(
            "faces", metadata={"hnsw:space": "cosine"}
        )

        with patch("photomind.services.face.chromadb") as mock_chroma_mod:
            mock_client_instance = MagicMock()
            mock_client_instance.get_or_create_collection.return_value = fake_collection
            mock_chroma_mod.PersistentClient.return_value = mock_client_instance

            store_faces(db_path, tmp_path / "chroma", photo_id, [fd])

        assert fake_collection.count() == 1

    def test_store_faces_multiple_faces(self, tmp_path: Path, face_mod: Any) -> None:
        from photomind.services.face import FaceDetection, store_faces

        db_path = tmp_path / "faces.db"
        chroma_path = tmp_path / "chroma"
        photo_id = "photo-multi"

        in_mem_client = chromadb.Client()
        fake_collection = in_mem_client.get_or_create_collection(
            "faces", metadata={"hnsw:space": "cosine"}
        )

        faces_list = []
        for i in range(2):
            fd = FaceDetection(
                face_id=str(uuid.uuid4()),
                bbox_x=i * 10,
                bbox_y=i * 10,
                bbox_w=40,
                bbox_h=40,
                det_score=0.9,
                embedding=[float(i)] * 512,
            )
            faces_list.append(fd)

        with patch("photomind.services.face.chromadb") as mock_chroma_mod:
            mock_client_instance = MagicMock()
            mock_client_instance.get_or_create_collection.return_value = fake_collection
            mock_chroma_mod.PersistentClient.return_value = mock_client_instance

            store_faces(db_path, chroma_path, photo_id, faces_list)

        # Check SQLite rows
        conn = sqlite3.connect(str(db_path))
        try:
            count = conn.execute("SELECT COUNT(*) FROM faces WHERE photo_id = ?", (photo_id,)).fetchone()[0]
        finally:
            conn.close()

        assert count == 2
        assert fake_collection.count() == 2

    def test_store_faces_cluster_id_is_null(self, tmp_path: Path, face_mod: Any) -> None:
        from photomind.services.face import FaceDetection, store_faces

        db_path = tmp_path / "faces.db"
        face_id = str(uuid.uuid4())

        fd = FaceDetection(
            face_id=face_id,
            bbox_x=0,
            bbox_y=0,
            bbox_w=30,
            bbox_h=30,
            det_score=0.88,
            embedding=[0.0] * 512,
        )

        in_mem_client = chromadb.Client()
        fake_collection = in_mem_client.get_or_create_collection(
            "faces", metadata={"hnsw:space": "cosine"}
        )

        with patch("photomind.services.face.chromadb") as mock_chroma_mod:
            mock_client_instance = MagicMock()
            mock_client_instance.get_or_create_collection.return_value = fake_collection
            mock_chroma_mod.PersistentClient.return_value = mock_client_instance

            store_faces(db_path, tmp_path / "chroma", "photo-null-cluster", [fd])

        conn = sqlite3.connect(str(db_path))
        try:
            row = conn.execute(
                "SELECT cluster_id FROM faces WHERE id = ?", (face_id,)
            ).fetchone()
        finally:
            conn.close()

        assert row is not None
        assert row[0] is None  # cluster_id must be NULL


# ---------------------------------------------------------------------------
# TestSingleton
# ---------------------------------------------------------------------------


class TestSingleton:
    def test_singleton_is_loaded_once(self, sample_image: Path, face_mod: Any) -> None:
        """FaceAnalysis() is instantiated exactly once across multiple detect() calls."""
        mock_app = _make_mock_app([])

        mock_face_analysis_class = MagicMock(return_value=mock_app)

        with patch("photomind.services.face._get_app", wraps=None) as _:
            # Reset singleton
            face_mod._app = None

            # Patch insightface at module import level
            with patch.dict(
                "sys.modules",
                {
                    "insightface": MagicMock(),
                    "insightface.app": MagicMock(),
                },
            ):
                import sys

                sys.modules["insightface"].app.FaceAnalysis = mock_face_analysis_class
                face_mod._app = None  # ensure clean state

                # Manually test _get_app singleton logic
                face_mod._app = None
                app1 = face_mod._get_app()
                app2 = face_mod._get_app()

            assert app1 is app2
            # FaceAnalysis should be instantiated only once
            assert mock_face_analysis_class.call_count == 1
