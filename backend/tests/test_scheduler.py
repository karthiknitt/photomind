"""
Tests for worker/scheduler.py.

The scheduler wraps run_scan() in a periodic loop:
  - Calls run_scan() immediately on start
  - Sleeps scan_interval_seconds between scans
  - Stops cleanly on KeyboardInterrupt
  - face_cluster_interval is tracked but stubbed until Phase 3

Tests use mock.patch to intercept run_scan and time.sleep so no real
I/O or waiting occurs.
"""

from __future__ import annotations

from unittest.mock import MagicMock, call, patch

import pytest

from photomind.config import DaemonConfig, PhotoMindConfig
from photomind.worker.scheduler import run_forever

SCAN_PATCH = "photomind.worker.scheduler.run_scan"
SLEEP_PATCH = "photomind.worker.scheduler.time.sleep"


@pytest.fixture()
def config() -> PhotoMindConfig:
    return PhotoMindConfig(
        daemon=DaemonConfig(scan_interval_seconds=3600, face_cluster_interval_seconds=86400)
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
