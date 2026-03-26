"""
Entry point: python -m photomind.worker

Loads config.yaml (or defaults), configures logging, and starts the
periodic scan scheduler. The daemon runs until SIGINT (Ctrl-C).

Usage:
    uv run python -m photomind.worker
    uv run python -m photomind.worker --config /path/to/config.yaml
    uv run python -m photomind.worker --scan-once   # run one scan then exit
"""

from __future__ import annotations

import argparse
import logging
import sys

from photomind.config import load_config
from photomind.worker.daemon import run_scan
from photomind.worker.scheduler import run_forever


def _configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout,
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="python -m photomind.worker",
        description="PhotoMind background processing daemon",
    )
    parser.add_argument(
        "--config",
        metavar="PATH",
        default=None,
        help="Path to config.yaml (default: ./config.yaml)",
    )
    parser.add_argument(
        "--scan-once",
        action="store_true",
        help="Run a single scan then exit (useful for cron / manual trigger)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable DEBUG-level logging",
    )
    args = parser.parse_args(argv)

    _configure_logging(args.verbose)
    config = load_config(args.config)

    if args.scan_once:
        logging.getLogger(__name__).info(
            "--scan-once mode: running one scan then exiting"
        )
        run_scan(config)
    else:
        run_forever(config)


if __name__ == "__main__":
    main()
