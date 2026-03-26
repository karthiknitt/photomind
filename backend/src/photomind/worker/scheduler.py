"""
PhotoMind periodic scheduler.

run_forever() wraps run_scan() and the periodic face-clustering job:
  - Runs a scan immediately on startup
  - Runs face clustering once per face_cluster_interval_seconds
  - Sleeps config.daemon.scan_interval_seconds between scans
  - Exits cleanly on KeyboardInterrupt
  - Logs and continues on scan or cluster errors (transient issues)
"""

from __future__ import annotations

import logging
import time

from photomind.config import PhotoMindConfig
from photomind.services.cluster import run_clustering
from photomind.worker.daemon import run_scan

logger = logging.getLogger(__name__)


def run_forever(config: PhotoMindConfig) -> None:
    """Run the PhotoMind scan + cluster loop until interrupted.

    Calls :func:`run_scan` immediately, then repeats after sleeping
    ``config.daemon.scan_interval_seconds``.  Face clustering via
    :func:`run_clustering` is triggered whenever
    ``config.daemon.face_cluster_interval_seconds`` has elapsed since
    the last clustering run.

    A :class:`KeyboardInterrupt` (SIGINT / Ctrl-C) exits the loop
    cleanly.  Any other exception is logged and the loop continues.

    Args:
        config: Loaded PhotoMindConfig with daemon timing and source definitions.
    """
    interval = config.daemon.scan_interval_seconds
    cluster_interval = config.daemon.face_cluster_interval_seconds
    # Initialise to now so the first cluster run happens after one full interval,
    # not immediately on startup (avoids hammering ChromaDB at boot).
    last_cluster_time = time.time()

    logger.info(
        "Scheduler started — scan interval %ds, face-cluster interval %ds",
        interval,
        cluster_interval,
    )

    while True:
        # ── Photo scan ───────────────────────────────────────────────────────
        try:
            run_scan(config)
        except KeyboardInterrupt:
            logger.info("KeyboardInterrupt received — shutting down")
            return
        except Exception as exc:  # noqa: BLE001
            logger.error("Scan error (will retry after sleep): %s", exc, exc_info=True)

        # ── Face clustering (periodic) ────────────────────────────────────────
        if time.time() - last_cluster_time >= cluster_interval:
            try:
                result = run_clustering(config.database_path, config.chroma_db_path)
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

        # ── Sleep until next scan ─────────────────────────────────────────────
        try:
            time.sleep(interval)
        except KeyboardInterrupt:
            logger.info("KeyboardInterrupt during sleep — shutting down")
            return
