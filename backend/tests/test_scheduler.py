"""
Tests for worker/scheduler.py — threaded architecture.

run_forever():
  - Runs run_scan() in a loop, exits on KeyboardInterrupt
  - Starts a background daemon thread for face clustering
  - Scan errors are logged but the loop continues

_cluster_loop():
  - Triggers clustering immediately on first pass (last_cluster_time=0.0)
  - Does not re-run clustering before the interval elapses
  - Catches clustering errors and retries next interval
  - Exits cleanly when stop_event is set
"""

from __future__ import annotations

import threading
from unittest.mock import MagicMock, patch

import pytest

from photomind.config import DaemonConfig, PhotoMindConfig
from photomind.services.cluster import ClusterResult
from photomind.worker.scheduler import _cluster_loop, run_forever

SCAN_PATCH = "photomind.worker.scheduler.run_scan"
SLEEP_PATCH = "photomind.worker.scheduler.time.sleep"
CLUSTER_PATCH = "photomind.worker.scheduler.run_clustering"
TIME_PATCH = "photomind.worker.scheduler.time.time"
THREAD_PATCH = "photomind.worker.scheduler.threading.Thread"
CHROMA_CLIENT_PATCH = "photomind.worker.scheduler.get_chroma_client"


@pytest.fixture()
def config() -> PhotoMindConfig:
    return PhotoMindConfig(
        daemon=DaemonConfig(
            scan_interval_seconds=3600,
            face_cluster_interval_seconds=86400,
        )
    )


# ---------------------------------------------------------------------------
# run_forever — scan loop behaviour
# ---------------------------------------------------------------------------


class TestRunForever:
    def test_run_scan_called_on_first_iteration(self, config: PhotoMindConfig) -> None:
        """run_scan must be called at least once immediately."""
        call_count = 0

        def _scan(cfg: PhotoMindConfig, chroma_client: object) -> None:
            nonlocal call_count
            call_count += 1
            if call_count >= 1:
                raise KeyboardInterrupt

        with patch(CHROMA_CLIENT_PATCH, return_value=MagicMock()):
            with patch(SCAN_PATCH, side_effect=_scan):
                with patch(SLEEP_PATCH):
                    with patch(THREAD_PATCH, return_value=MagicMock()):
                        run_forever(config)

        assert call_count >= 1

    def test_sleep_called_with_scan_interval(self, config: PhotoMindConfig) -> None:
        """Sleep duration must match config.daemon.scan_interval_seconds."""
        call_count = 0

        def _scan(cfg: PhotoMindConfig, chroma_client: object) -> None:
            nonlocal call_count
            call_count += 1
            if call_count >= 1:
                raise KeyboardInterrupt

        with patch(CHROMA_CLIENT_PATCH, return_value=MagicMock()):
            with patch(SCAN_PATCH, side_effect=_scan):
                with patch(SLEEP_PATCH) as mock_sleep:
                    with patch(THREAD_PATCH, return_value=MagicMock()):
                        run_forever(config)

        for c in mock_sleep.call_args_list:
            assert c[0][0] == config.daemon.scan_interval_seconds

    def test_keyboard_interrupt_exits_cleanly(self, config: PhotoMindConfig) -> None:
        """KeyboardInterrupt must cause run_forever to return without raising."""
        with patch(CHROMA_CLIENT_PATCH, return_value=MagicMock()):
            with patch(SCAN_PATCH, side_effect=KeyboardInterrupt):
                with patch(SLEEP_PATCH):
                    with patch(THREAD_PATCH, return_value=MagicMock()):
                        run_forever(config)  # must not propagate

    def test_scan_error_does_not_stop_loop(self, config: PhotoMindConfig) -> None:
        """An unexpected scan error must be logged but not crash the loop."""
        call_count = 0

        def _scan(cfg: PhotoMindConfig, chroma_client: object) -> None:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("transient error")
            raise KeyboardInterrupt

        with patch(CHROMA_CLIENT_PATCH, return_value=MagicMock()):
            with patch(SCAN_PATCH, side_effect=_scan):
                with patch(SLEEP_PATCH):
                    with patch(THREAD_PATCH, return_value=MagicMock()):
                        run_forever(config)

        assert call_count == 2

    def test_multiple_scans_before_stop(self, config: PhotoMindConfig) -> None:
        """Loop continues scanning until interrupted."""
        call_count = 0

        def _scan(cfg: PhotoMindConfig, chroma_client: object) -> None:
            nonlocal call_count
            call_count += 1
            if call_count >= 3:
                raise KeyboardInterrupt

        with patch(CHROMA_CLIENT_PATCH, return_value=MagicMock()):
            with patch(SCAN_PATCH, side_effect=_scan):
                with patch(SLEEP_PATCH):
                    with patch(THREAD_PATCH, return_value=MagicMock()):
                        run_forever(config)

        assert call_count == 3

    def test_config_is_passed_to_run_scan(self, config: PhotoMindConfig) -> None:
        """run_forever must pass the config object to run_scan unchanged."""
        received: list[PhotoMindConfig] = []

        def _scan(cfg: PhotoMindConfig, chroma_client: object) -> None:
            received.append(cfg)
            raise KeyboardInterrupt

        with patch(CHROMA_CLIENT_PATCH, return_value=MagicMock()):
            with patch(SCAN_PATCH, side_effect=_scan):
                with patch(SLEEP_PATCH):
                    with patch(THREAD_PATCH, return_value=MagicMock()):
                        run_forever(config)

        assert received[0] is config

    def test_cluster_thread_is_started(self, config: PhotoMindConfig) -> None:
        """run_forever must start exactly one background cluster thread."""
        with patch(CHROMA_CLIENT_PATCH, return_value=MagicMock()):
            with patch(SCAN_PATCH, side_effect=KeyboardInterrupt):
                with patch(SLEEP_PATCH):
                    with patch(THREAD_PATCH) as mock_cls:
                        mock_thread = MagicMock()
                        mock_cls.return_value = mock_thread
                        run_forever(config)

        mock_cls.assert_called_once()
        # Thread must be started
        mock_thread.start.assert_called_once()
        # Thread kwargs must pass stop_event and correct args
        kwargs = mock_cls.call_args.kwargs
        assert kwargs.get("daemon") is True
        assert kwargs.get("name") == "face-cluster"


# ---------------------------------------------------------------------------
# _cluster_loop — clustering thread behaviour
# ---------------------------------------------------------------------------


class TestClusterLoop:
    def test_clustering_runs_on_first_pass(self) -> None:
        """Clustering fires immediately because last_cluster_time starts at 0.0."""
        stop_event = threading.Event()

        def fake_cluster(*args: object, **kwargs: object) -> ClusterResult:
            stop_event.set()  # exit loop after first successful run
            return ClusterResult(n_faces=5, n_clusters=2, n_noise=1)

        with patch(CLUSTER_PATCH, side_effect=fake_cluster) as mock_cluster:
            _cluster_loop("db.db", MagicMock(), 86400, stop_event)

        mock_cluster.assert_called_once()

    def test_clustering_not_recalled_before_interval(self) -> None:
        """After a successful run, clustering does not fire again before the interval."""
        stop_event = threading.Event()
        call_count = 0

        # After first cluster, time advances only 60s — well under 86400s interval
        base_time = 1_000_000.0
        time_seq = iter(
            [
                base_time,  # first check: time() - 0.0 ≥ 86400 → True
                base_time,  # last_cluster_time = time()
                base_time + 60,  # second check: 60s elapsed < 86400 → False
            ]
        )

        def fake_cluster(*args: object, **kwargs: object) -> ClusterResult:
            nonlocal call_count
            call_count += 1
            return ClusterResult(n_faces=5, n_clusters=2, n_noise=1)

        original_wait = threading.Event.wait

        def fake_wait(self: threading.Event, timeout: float | None = None) -> bool:
            # First wait: keep looping; second wait: stop
            if call_count >= 1:
                stop_event.set()
            return original_wait(self, timeout=0)

        with patch(CLUSTER_PATCH, side_effect=fake_cluster):
            with patch(TIME_PATCH, side_effect=time_seq):
                with patch.object(threading.Event, "wait", fake_wait):
                    _cluster_loop("db.db", MagicMock(), 86400, stop_event)

        assert call_count == 1

    def test_cluster_error_does_not_crash_loop(self) -> None:
        """An error in run_clustering is caught; the loop retries next interval."""
        stop_event = threading.Event()
        call_count = 0

        def fake_cluster(*args: object, **kwargs: object) -> ClusterResult:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("chroma offline")
            stop_event.set()
            return ClusterResult(n_faces=5, n_clusters=2, n_noise=1)

        # interval=0 so the elapsed check is always True; last_cluster_time never
        # updates on error, so the second iteration will also fire.
        with patch(CLUSTER_PATCH, side_effect=fake_cluster):
            with patch(TIME_PATCH, return_value=0.0):
                _cluster_loop("db.db", MagicMock(), 0, stop_event)

        assert call_count == 2

    def test_loop_exits_immediately_when_stop_event_set(self) -> None:
        """If stop_event is already set, loop body never executes."""
        stop_event = threading.Event()
        stop_event.set()

        with patch(CLUSTER_PATCH) as mock_cluster:
            _cluster_loop("db.db", MagicMock(), 86400, stop_event)

        mock_cluster.assert_not_called()

    def test_clustering_called_with_correct_args(self) -> None:
        """run_clustering receives the db_path and chroma_client passed to _cluster_loop."""
        stop_event = threading.Event()
        mock_client = MagicMock()

        def fake_cluster(*args: object, **kwargs: object) -> ClusterResult:
            stop_event.set()
            return ClusterResult(n_faces=3, n_clusters=1, n_noise=0)

        with patch(CLUSTER_PATCH, side_effect=fake_cluster) as mock_cluster:
            _cluster_loop("/my/db.sqlite", mock_client, 86400, stop_event)

        mock_cluster.assert_called_once()
        args = mock_cluster.call_args[0]
        assert args[0] == "/my/db.sqlite"
        assert args[1] is mock_client
