"""
Face clustering service for PhotoMind.

Runs HDBSCAN on face embeddings stored in ChromaDB and persists
cluster assignments to SQLite. Designed to be called periodically
(not per-photo) by the scheduler.

Algorithm:
  1. Fetch all face embeddings from ChromaDB "faces" collection.
  2. Run sklearn HDBSCAN (min_cluster_size configurable).
  3. Clear and rebuild face_clusters table; update faces.cluster_id.
  4. Faces with HDBSCAN label -1 (noise) get cluster_id = NULL.
"""

from __future__ import annotations

import logging
import sqlite3
import time
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import chromadb

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


@dataclass
class ClusterResult:
    """Summary of a completed clustering run.

    Attributes:
        n_faces:    Total face embeddings processed.
        n_clusters: Number of distinct clusters created (noise excluded).
        n_noise:    Faces assigned label -1 by HDBSCAN (no cluster).
    """

    n_faces: int
    n_clusters: int
    n_noise: int


# ---------------------------------------------------------------------------
# SQLite helpers
# ---------------------------------------------------------------------------

_CREATE_CLUSTERS_SQL = """
CREATE TABLE IF NOT EXISTS face_clusters (
    id          TEXT PRIMARY KEY,
    label       TEXT,
    photo_count INTEGER DEFAULT 0,
    created_at  INTEGER NOT NULL
)
"""


@contextmanager
def _open_db(db_path: str | Path) -> Generator[sqlite3.Connection, None, None]:
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


def run_clustering(
    db_path: str | Path,
    chroma_db_path: str | Path,
    min_cluster_size: int = 2,
    min_samples: int = 1,
) -> ClusterResult:
    """Run HDBSCAN on all face embeddings and persist cluster assignments.

    Fetches every face embedding from the ChromaDB "faces" collection,
    runs HDBSCAN, then atomically rebuilds face_clusters and updates
    faces.cluster_id in SQLite.  Noise faces (label=-1) retain
    cluster_id=NULL.

    Args:
        db_path:          Path to the shared SQLite database.
        chroma_db_path:   Directory where ChromaDB stores its data.
        min_cluster_size: Smallest grouping HDBSCAN will call a cluster.
        min_samples:      HDBSCAN min_samples (controls noise sensitivity).

    Returns:
        ClusterResult with n_faces, n_clusters, n_noise counts.
    """
    # ── Step 1: Fetch embeddings from ChromaDB ───────────────────────────────
    chroma_client = chromadb.PersistentClient(path=str(chroma_db_path))
    try:
        collection = chroma_client.get_collection("faces")
    except Exception:
        logger.info("cluster: 'faces' collection not found — skipping.")
        return ClusterResult(n_faces=0, n_clusters=0, n_noise=0)

    fetch = collection.get(include=["embeddings"])
    face_ids: list[str] = fetch["ids"]
    embeddings: list[list[float]] = fetch["embeddings"] or []

    n_faces = len(face_ids)
    logger.info("cluster: fetched %d face embeddings from ChromaDB", n_faces)

    if n_faces < min_cluster_size:
        logger.info(
            "cluster: %d face(s) < min_cluster_size=%d — no clustering.",
            n_faces,
            min_cluster_size,
        )
        return ClusterResult(n_faces=n_faces, n_clusters=0, n_noise=n_faces)

    # ── Step 2: Run HDBSCAN ──────────────────────────────────────────────────
    import numpy as np
    from sklearn.cluster import HDBSCAN

    X = np.array(embeddings, dtype=np.float32)
    hdbscan = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
    )
    labels: np.ndarray = hdbscan.fit_predict(X)

    unique_labels = set(labels.tolist()) - {-1}
    n_clusters = len(unique_labels)
    n_noise = int((labels == -1).sum())

    logger.info(
        "cluster: HDBSCAN → %d cluster(s), %d noise face(s)",
        n_clusters,
        n_noise,
    )

    # face_id → cluster label
    face_label_map: dict[str, int] = dict(zip(face_ids, labels.tolist(), strict=True))

    # ── Step 3: Rebuild SQLite ───────────────────────────────────────────────
    now = int(time.time())

    with _open_db(db_path) as conn:
        conn.execute(_CREATE_CLUSTERS_SQL)

        # Clear previous clustering
        conn.execute("UPDATE faces SET cluster_id = NULL")
        conn.execute("DELETE FROM face_clusters")

        # Create new cluster rows and assign faces
        label_to_cluster_id: dict[int, str] = {}
        for label in sorted(unique_labels):
            cluster_id = str(uuid.uuid4())
            label_to_cluster_id[label] = cluster_id

            # Faces that belong to this cluster
            members = [fid for fid, lbl in face_label_map.items() if lbl == label]
            placeholders = ",".join("?" * len(members))
            photo_count: int = conn.execute(
                f"SELECT COUNT(DISTINCT photo_id) FROM faces "  # noqa: S608
                f"WHERE id IN ({placeholders})",
                members,
            ).fetchone()[0]

            conn.execute(
                "INSERT INTO face_clusters (id, label, photo_count, created_at) "
                "VALUES (?, NULL, ?, ?)",
                (cluster_id, photo_count, now),
            )

        # Update faces.cluster_id for non-noise faces
        for face_id, label in face_label_map.items():
            if label != -1:
                conn.execute(
                    "UPDATE faces SET cluster_id = ? WHERE id = ?",
                    (label_to_cluster_id[label], face_id),
                )

    logger.info(
        "cluster: wrote %d cluster(s) to SQLite for %d face(s)",
        n_clusters,
        n_faces,
    )

    return ClusterResult(n_faces=n_faces, n_clusters=n_clusters, n_noise=n_noise)
