"""
Face detection service for PhotoMind.

Provides:
- detect: run InsightFace buffalo_sc on an image, return list[FaceDetection]
- store_faces: persist detections to SQLite faces table + ChromaDB 'faces' collection

Model: InsightFace buffalo_sc, CPU-only.
Singleton pattern ensures the FaceAnalysis app is loaded at most once per process.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import chromadb

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_app: Any = None
_app_lock = threading.Lock()


def _get_app() -> Any:  # noqa: ANN401
    """Load the InsightFace buffalo_sc app once and cache it (thread-safe).

    Returns:
        A prepared FaceAnalysis instance (CPU mode).
    """
    global _app  # noqa: PLW0603

    if _app is not None:
        return _app

    with _app_lock:
        if _app is None:  # double-checked locking
            import insightface  # imported lazily to allow mocking in tests

            logger.info("Loading InsightFace buffalo_sc model (CPU)...")
            # Build into a local first — only publish _app last so the
            # fast-path guard (_app is not None) is set only after the model
            # is fully prepared.
            local_app = insightface.app.FaceAnalysis(name="buffalo_sc")
            local_app.prepare(ctx_id=-1)  # -1 = CPU
            _app = local_app  # sentinel published last
            logger.info("InsightFace buffalo_sc loaded and cached.")

    return _app


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class FaceDetection:
    """A single face detected in a photo.

    Attributes:
        face_id:   UUID4 string — used as SQLite PK and ChromaDB document ID.
        bbox_x:    Left edge of the bounding box (pixels, int).
        bbox_y:    Top edge of the bounding box (pixels, int).
        bbox_w:    Width of the bounding box (pixels, int).
        bbox_h:    Height of the bounding box (pixels, int).
        det_score: InsightFace confidence in [0, 1].
        embedding: 512-dim face embedding (list of Python floats).
    """

    face_id: str
    bbox_x: int
    bbox_y: int
    bbox_w: int
    bbox_h: int
    det_score: float
    embedding: list[float]


# ---------------------------------------------------------------------------
# SQLite schema
# ---------------------------------------------------------------------------

_CREATE_FACES_TABLE_SQL = """
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

_INSERT_FACE_SQL = """
INSERT OR IGNORE INTO faces
    (id, photo_id, cluster_id, embedding_id, bbox_x, bbox_y, bbox_w, bbox_h, det_score)
VALUES
    (?, ?, NULL, ?, ?, ?, ?, ?, ?)
"""


@contextmanager
def _open_db(db_path: str | Path) -> Generator[sqlite3.Connection, None, None]:
    """Open a WAL SQLite connection, commit/rollback, and always close.

    Args:
        db_path: Path to the SQLite database file.

    Yields:
        An open sqlite3.Connection.
    """
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=OFF")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def detect(
    image_path: str | Path,
    det_thresh: float = 0.5,
) -> list[FaceDetection]:
    """Run InsightFace buffalo_sc on *image_path* and return detected faces.

    Each face whose confidence score is below *det_thresh* is filtered out.
    The image is read as a NumPy BGR uint8 array (OpenCV convention) before
    being passed to the model.

    Args:
        image_path: Path to the image file (JPEG, PNG, etc.).
        det_thresh: Minimum detection confidence to keep a face (default 0.5).

    Returns:
        List of FaceDetection objects (may be empty).

    Raises:
        FileNotFoundError: if *image_path* does not exist.
    """
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {path}")

    import cv2  # opencv-python-headless bundled with insightface

    img_bgr = cv2.imread(str(path))
    app = _get_app()
    raw_faces = app.get(img_bgr)

    results: list[FaceDetection] = []
    for face in raw_faces:
        score: float = float(face.det_score)
        if score < det_thresh:
            continue

        x1, y1, x2, y2 = (int(v) for v in face.bbox)
        face_id = str(uuid.uuid4())
        embedding: list[float] = face.embedding.tolist()

        results.append(
            FaceDetection(
                face_id=face_id,
                bbox_x=x1,
                bbox_y=y1,
                bbox_w=x2 - x1,
                bbox_h=y2 - y1,
                det_score=score,
                embedding=embedding,
            )
        )

    logger.debug(
        "detect: path=%s, candidates=%d, kept=%d (thresh=%.2f)",
        image_path,
        len(raw_faces),
        len(results),
        det_thresh,
    )
    return results


def store_faces(
    db_path: str | Path,
    chroma_db_path: str | Path,
    photo_id: str,
    faces: list[FaceDetection],
) -> None:
    """Persist faces to SQLite and upsert embeddings into ChromaDB.

    This is a no-op when *faces* is empty.  The ``cluster_id`` column is
    always NULL at insert time — it will be populated by a later clustering job.

    Args:
        db_path:       Path to the SQLite database file.
        chroma_db_path: Directory where ChromaDB stores its data on disk.
        photo_id:      UUID of the parent photo (stored in ``faces.photo_id``).
        faces:         Detected faces to store (from :func:`detect`).
    """
    if not faces:
        return

    # --- SQLite -----------------------------------------------------------------
    with _open_db(db_path) as conn:
        conn.execute(_CREATE_FACES_TABLE_SQL)
        for face in faces:
            conn.execute(
                _INSERT_FACE_SQL,
                (
                    face.face_id,
                    photo_id,
                    face.face_id,  # embedding_id == face_id in ChromaDB
                    face.bbox_x,
                    face.bbox_y,
                    face.bbox_w,
                    face.bbox_h,
                    face.det_score,
                ),
            )

    logger.debug(
        "store_faces: %d row(s) written to SQLite for photo_id=%s",
        len(faces),
        photo_id,
    )

    # --- ChromaDB ---------------------------------------------------------------
    chroma_client = chromadb.PersistentClient(path=str(chroma_db_path))
    collection = chroma_client.get_or_create_collection(
        "faces", metadata={"hnsw:space": "cosine"}
    )
    collection.upsert(
        ids=[face.face_id for face in faces],
        embeddings=[face.embedding for face in faces],
    )
    logger.debug(
        "store_faces: %d embedding(s) upserted to ChromaDB for photo_id=%s",
        len(faces),
        photo_id,
    )
