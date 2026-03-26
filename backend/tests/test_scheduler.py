"""
Tests for worker/scheduler.py.

The scheduler wraps run_scan() in a periodic loop:
  - Calls run_scan() immediately on start
  - Runs run_clustering() when face_cluster_interval_seconds has elapsed
  - Sleeps scan_interval_seconds between scans
  - Stops cleanly on KeyboardInterrupt

Tests use mock.patch to intercept run_scan, run_clustering, and time.sleep
so no real I/O or waiting occurs.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from photomind.config import DaemonConfig, PhotoMindConfig
from photomind.worker.scheduler import run_forever

SCAN_PATCH = "photomind.worker.scheduler.run_scan"
SLEEP_PATCH = "photomind.worker.scheduler.time.sleep"
CLUSTER_PATCH = "photomind.worker.scheduler.run_clustering"
TIME_PATCH = "photomind.worker.scheduler.time.time"


@pytest.fixture()
def config() -> PhotoMindConfig:
    return PhotoMindConfig(
        daemon=DaemonConfig(
            scan_interval_seconds=3600,
            face_cluster_interval_seconds=86400,
        )
    )


# ---------------------------------------------------------------------------
# run_forever — basic behaviour
# ---------------------------------------------------------------------------


class TestRunForever:
    def test_run_scan_called_on_first_iteration(self, config: PhotoMindConfig) -> None:
        """run_scan must be called at least once immediately."""
        call_count = 0

        def _scan(cfg: PhotoMindConfig) -> None:
            nonlocal call_count
            call_count += 1
            if call_count >= 1:
                raise KeyboardInterrupt  # stop after first scan

        with patch(SCAN_PATCH, side_effect=_scan):
            with patch(SLEEP_PATCH):
                run_forever(config)

        assert call_count >= 1

    def test_sleep_called_with_scan_interval(self, config: PhotoMindConfig) -> None:
        """Sleep duration must match config.daemon.scan_interval_seconds."""
        call_count = 0

        def _scan(cfg: PhotoMindConfig) -> None:
            nonlocal call_count
            call_count += 1
            if call_count >= 1:
                raise KeyboardInterrupt

        with patch(SCAN_PATCH, side_effect=_scan):
            with patch(SLEEP_PATCH) as mock_sleep:
                run_forever(config)

        # If sleep was called, it must use the correct interval
        for call_args in mock_sleep.call_args_list:
            assert call_args[0][0] == config.daemon.scan_interval_seconds

    def test_keyboard_interrupt_exits_cleanly(self, config: PhotoMindConfig) -> None:
        """KeyboardInterrupt must cause run_forever to return without raising."""
        with patch(SCAN_PATCH, side_effect=KeyboardInterrupt):
            with patch(SLEEP_PATCH):
                run_forever(config)  # must not propagate KeyboardInterrupt

    def test_scan_error_does_not_stop_loop(self, config: PhotoMindConfig) -> None:
        """An unexpected error in run_scan must be logged but not crash the loop."""
        call_count = 0

        def _scan(cfg: PhotoMindConfig) -> None:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("transient error")
            raise KeyboardInterrupt  # stop on second call

        with patch(SCAN_PATCH, side_effect=_scan):
            with patch(SLEEP_PATCH):
                run_forever(config)  # must not raise RuntimeError

        assert call_count == 2  # first (error) + second (KeyboardInterrupt)

    def test_multiple_scans_before_stop(self, config: PhotoMindConfig) -> None:
        """Loop continues scanning until interrupted."""
        call_count = 0

        def _scan(cfg: PhotoMindConfig) -> None:
            nonlocal call_count
            call_count += 1
            if call_count >= 3:
                raise KeyboardInterrupt

        with patch(SCAN_PATCH, side_effect=_scan):
            with patch(SLEEP_PATCH):
                run_forever(config)

        assert call_count == 3

    def test_config_is_passed_to_run_scan(self, config: PhotoMindConfig) -> None:
        """run_forever must pass the config object to run_scan unchanged."""
        received: list[PhotoMindConfig] = []

        def _scan(cfg: PhotoMindConfig) -> None:
            received.append(cfg)
            raise KeyboardInterrupt

        with patch(SCAN_PATCH, side_effect=_scan):
            with patch(SLEEP_PATCH):
                run_forever(config)

        assert received[0] is config


# ---------------------------------------------------------------------------
# Clustering integration
# ---------------------------------------------------------------------------


class TestClusteringIntegration:
    def test_clustering_called_when_interval_elapsed(
        self, config: PhotoMindConfig
    ) -> None:
        """run_clustering is called once the face_cluster_interval has elapsed.

        Scan completes normally; sleep raises KeyboardInterrupt to stop the loop.
        time.time() sequence: [startup, check_after_scan, update_after_cluster].
        Extra values cover stdlib logging's internal time.time() calls.
        """
        startup = 1_000_000.0
        elapsed = startup + config.daemon.face_cluster_interval_seconds + 1
        after_update = elapsed + 1  # for last_cluster_time = time.time()

        # Extra fallback values for logging module's internal time.time() usage
        time_calls = iter([startup, elapsed, after_update, *([after_update] * 20)])

        from photomind.services.cluster import ClusterResult

        with (
            patch(SCAN_PATCH),  # scan succeeds (no exception)
            patch(SLEEP_PATCH, side_effect=KeyboardInterrupt),  # stop during sleep
            patch(TIME_PATCH, side_effect=time_calls),
            patch(CLUSTER_PATCH, return_value=ClusterResult(10, 2, 1)) as mock_cluster,
        ):
            run_forever(config)

        mock_cluster.assert_called_once()

    def test_clustering_not_called_before_interval(
        self, config: PhotoMindConfig
    ) -> None:
        """run_clustering is NOT called when the interval has not yet elapsed.

        Only 60 seconds pass after startup — well under face_cluster_interval (86400).
        """
        startup = 1_000_000.0
        not_elapsed = startup + 60.0  # well under 86400s

        time_calls = iter([startup, not_elapsed, *([not_elapsed] * 20)])

        with (
            patch(SCAN_PATCH),  # scan succeeds
            patch(SLEEP_PATCH, side_effect=KeyboardInterrupt),
            patch(TIME_PATCH, side_effect=time_calls),
            patch(CLUSTER_PATCH) as mock_cluster,
        ):
            run_forever(config)

        mock_cluster.assert_not_called()

    def test_cluster_error_does_not_crash_loop(self, config: PhotoMindConfig) -> None:
        """An error in run_clustering is logged but the loop continues.

        Scan 1 completes; clustering errors; sleep completes; scan 2 raises
        KeyboardInterrupt to exit.
        """
        startup = 1_000_000.0
        elapsed = startup + config.daemon.face_cluster_interval_seconds + 1

        # Extra fallback values for stdlib logging's internal time.time() calls
        time_calls = iter([startup, elapsed, *([elapsed] * 20)])
        scan_count = 0

        def _scan(cfg: PhotoMindConfig) -> None:
            nonlocal scan_count
            scan_count += 1
            if scan_count >= 2:
                raise KeyboardInterrupt  # stop on second scan

        with (
            patch(SCAN_PATCH, side_effect=_scan),
            patch(SLEEP_PATCH),  # sleep succeeds so loop continues
            patch(TIME_PATCH, side_effect=time_calls),
            patch(CLUSTER_PATCH, side_effect=RuntimeError("chroma offline")),
        ):
            run_forever(config)  # must not raise

        assert scan_count == 2
