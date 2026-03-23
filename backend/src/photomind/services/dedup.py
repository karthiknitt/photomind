"""
Dedup service for PhotoMind.

Provides two levels of duplicate detection:
  - SHA256: exact byte-for-byte match (same file downloaded twice)
  - pHash:  perceptual match (same photo at different quality/resolution)

The pipeline uses pHash for library-wide dedup. SHA256 is available as a
fast pre-filter before the heavier perceptual comparison.

pHashes are stored as lowercase hex strings (e.g. "ffd3b38181818181").
Use imagehash.hex_to_hash() to reconstruct for comparison.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Iterable
from pathlib import Path

import imagehash
from PIL import Image, UnidentifiedImageError

logger = logging.getLogger(__name__)


def compute_phash(image_path: str | Path) -> str:
    """Compute the perceptual hash (pHash) of an image.

    Uses imagehash.phash with default hash_size=8 → 64-bit hash stored as
    a lowercase hex string.

    Args:
        image_path: path to the image file (JPEG, PNG, etc.)

    Returns:
        Lowercase hex string representation of the pHash.

    Raises:
        FileNotFoundError: if *image_path* does not exist.
        ValueError: if the file cannot be opened as an image.
    """
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {path}")
    if not path.is_file():
        raise IsADirectoryError(f"Expected a file, got a directory: {path}")

    try:
        with Image.open(path) as img:
            img.load()
            h = imagehash.phash(img)
    except UnidentifiedImageError as exc:
        raise ValueError(f"Cannot open {path} as an image: {exc}") from exc

    return str(h)


def compute_sha256(file_path: str | Path) -> str:
    """Compute the SHA-256 hash of a file's raw bytes.

    Args:
        file_path: path to the file.

    Returns:
        64-character lowercase hex string.

    Raises:
        FileNotFoundError: if *file_path* does not exist.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")
    if not path.is_file():
        raise IsADirectoryError(f"Expected a file, got a directory: {path}")

    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hamming_distance(hash1: str, hash2: str) -> int:
    """Return the Hamming distance between two pHash hex strings.

    A distance of 0 means identical hashes; 64 means maximally different
    (all 64 bits differ).

    Args:
        hash1: hex string from compute_phash().
        hash2: hex string from compute_phash().

    Returns:
        Integer in range [0, 64].
    """
    return imagehash.hex_to_hash(hash1) - imagehash.hex_to_hash(hash2)


def is_duplicate(
    phash: str,
    known_phashes: Iterable[str],
    hamming_threshold: int = 10,
) -> tuple[bool, str | None]:
    """Check whether *phash* is a duplicate of any hash in *known_phashes*.

    Iterates over *known_phashes* and returns True on the first match whose
    Hamming distance from *phash* is ≤ *hamming_threshold*.

    Args:
        phash: pHash of the candidate photo (hex string).
        known_phashes: iterable of pHash strings already in the library.
        hamming_threshold: maximum Hamming distance to count as duplicate
            (default 10 ≈ 84% bit similarity out of 64 bits). Must be in [0, 64].

    Returns:
        ``(True, matching_phash)`` if a duplicate is found,
        ``(False, None)`` otherwise.

    Raises:
        ValueError: if *hamming_threshold* is outside [0, 64].
    """
    if not 0 <= hamming_threshold <= 64:
        raise ValueError(
            f"hamming_threshold must be in [0, 64], got {hamming_threshold}"
        )
    candidate = imagehash.hex_to_hash(phash)
    for known in known_phashes:
        known_hash = imagehash.hex_to_hash(known)
        dist = candidate - known_hash
        if dist <= hamming_threshold:
            logger.debug(
                "Duplicate detected: distance=%d, threshold=%d",
                dist,
                hamming_threshold,
            )
            return True, known
    return False, None
