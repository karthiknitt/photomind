"""
PhotoMind periodic scheduler.

run_forever() wraps run_scan() in a loop:
  - Runs a scan immediately on startup
  - Sleeps config.daemon.scan_interval_seconds between scans
  - Exits cleanly on KeyboardInterrupt
  - Logs and continues on unexpected scan errors (transient rclone issues, etc.)

Face clustering is a Phase 3 job (HDBSCAN on face embeddings). The interval
is tracked here but the actual job is stubbed until InsightFace is wired up.
"""

from __future__ import annotations

import logging
import time

from photomind.config import PhotoMindConfig
from photomind.worker.daemon import run_scan

logger = logging.getLogger(__name__)


def run_forever(config: PhotoMindConfig) -> None:
    """Run the PhotoMind scan loop until interrupted.

    Calls :func:`run_scan` immediately, then repeats after sleeping
    ``config.daemon.scan_interval_seconds``. A :class:`KeyboardInterrupt`
    (SIGINT / Ctrl-C) exits the loop cleanly. Any other exception from
    :func:`run_scan` is logged as an error and the loop continues.

    Args:
        config: Loaded PhotoMindConfig with daemon timing and source definitions.
    """
    interval = config.daemon.scan_interval_seconds
    logger.info(
        "Scheduler started — scan interval %ds, face-cluster interval %ds (Phase 3 stub)",
        interval,
        config.daemon.face_cluster_interval_seconds,
    )

    while True:
        try:
            run_scan(config)
        except KeyboardInterrupt:
            logger.info("KeyboardInterrupt received — shutting down")
            return
        except Exception as exc:  # noqa: BLE001
            logger.error("Scan error (will retry after sleep): %s", exc, exc_info=True)

        try:
            time.sleep(interval)
        except KeyboardInterrupt:
            logger.info("KeyboardInterrupt during sleep — shutting down")
            return
