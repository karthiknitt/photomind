"""
PhotoMind periodic scheduler.

run_forever() wraps run_scan() and the periodic face-clustering job:
  - Runs a scan immediately on startup
  - Runs face clustering in a background thread, independently of scan duration
  - Face clustering triggers immediately on first cycle, then every
    face_cluster_interval_seconds thereafter
  - Sleeps config.daemon.scan_interval_seconds between scans
  - Exits cleanly on KeyboardInterrupt
  - Logs and continues on scan or cluster errors (transient issues)
"""

from __future__ import annotations

import logging
import threading
import time

from photomind.config import PhotoMindConfig
from photomind.services.cluster import run_clustering
from photomind.worker.daemon import run_scan

logger = logging.getLogger(__name__)


def _cluster_loop(
    db_path: str,
    chroma_db_path: str,
    cluster_interval: int,
    stop_event: threading.Event,
) -> None:
    """Background thread: run face clustering every cluster_interval seconds.

    Starts immediately (last_cluster_time=0) so the first run fires on the
    first check rather than waiting a full interval. Runs independently of
    how long each photo scan takes.

    Args:
        db_path:          Path to the shared SQLite database.
        chroma_db_path:   Path to the ChromaDB directory.
        cluster_interval: Seconds between clustering runs.
        stop_event:       Set by the main thread to request a clean shutdown.
    """
    last_cluster_time = 0.0  # trigger immediately on first pass

    while not stop_event.is_set():
        if time.time() - last_cluster_time >= cluster_interval:
            try:
                result = run_clustering(db_path, chroma_db_path)
                last_cluster_time = time.time()
                logger.info(
                    "cluster: done — %d cluster(s), %d face(s), %d noise",
                    result.n_clusters,
                    result.n_faces,
                    result.n_noise,
                )
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "Cluster error (will retry next interval): %s", exc, exc_info=True
                )
        # Poll every 60s so shutdown via stop_event is responsive
        stop_event.wait(timeout=60)


def run_forever(config: PhotoMindConfig) -> None:
    """Run the PhotoMind scan + cluster loop until interrupted.

    Calls :func:`run_scan` immediately, then repeats after sleeping
    ``config.daemon.scan_interval_seconds``.  Face clustering runs in a
    separate daemon thread so long-running initial scans (which may take
    days for large libraries) do not delay the first clustering pass.

    A :class:`KeyboardInterrupt` (SIGINT / Ctrl-C) exits the loop
    cleanly.  Any other exception is logged and the loop continues.

    Args:
        config: Loaded PhotoMindConfig with daemon timing and source definitions.
    """
    interval = config.daemon.scan_interval_seconds
    cluster_interval = config.daemon.face_cluster_interval_seconds

    logger.info(
        "Scheduler started — scan interval %ds, face-cluster interval %ds",
        interval,
        cluster_interval,
    )

    # Start clustering in a background thread so it runs independently of scan
    stop_event = threading.Event()
    cluster_thread = threading.Thread(
        target=_cluster_loop,
        args=(
            config.database_path,
            config.chroma_db_path,
            cluster_interval,
            stop_event,
        ),
        name="face-cluster",
        daemon=True,
    )
    cluster_thread.start()
    logger.info("Cluster thread started (interval=%ds)", cluster_interval)

    try:
        while True:
            # ── Photo scan ───────────────────────────────────────────────────
            try:
                run_scan(config)
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "Scan error (will retry after sleep): %s", exc, exc_info=True
                )

            # ── Sleep until next scan ─────────────────────────────────────────
            time.sleep(interval)
    except KeyboardInterrupt:
        logger.info("KeyboardInterrupt received — shutting down")
        stop_event.set()
        cluster_thread.join(timeout=5)
