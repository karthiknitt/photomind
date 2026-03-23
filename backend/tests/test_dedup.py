"""
Tests for the dedup service.

Covers:
- compute_phash: determinism, return type, error handling
- compute_sha256: determinism, uniqueness, error handling
- hamming_distance: identity (0), max distance, known values
- is_duplicate: empty list, identical hash, near-match within threshold,
                clearly different hash, custom threshold

All images are created programmatically via Pillow — no external fixtures.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from photomind.services.dedup import (
    compute_phash,
    compute_sha256,
    hamming_distance,
    is_duplicate,
)

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def make_jpeg(path: Path, width: int, height: int, color: tuple[int, int, int]) -> Path:
    """Save a solid-colour JPEG to *path* and return it."""
    Image.new("RGB", (width, height), color=color).save(str(path), "JPEG")
    return path


def make_gradient(path: Path, width: int = 64, height: int = 64) -> Path:
    """Save a horizontal gradient JPEG (left=black, right=red)."""
    import struct

    pixels = b"".join(
        struct.pack("BBB", int(x * 255 / (width - 1)), 0, 0)
        for y in range(height)
        for x in range(width)
    )
    img = Image.frombytes("RGB", (width, height), pixels)
    img.save(str(path), "JPEG")
    return path


# ---------------------------------------------------------------------------
# compute_phash
# ---------------------------------------------------------------------------


def test_phash_returns_nonempty_hex_string(tmp_path: Path) -> None:
    src = make_jpeg(tmp_path / "photo.jpg", 200, 200, (100, 150, 200))
    result = compute_phash(src)
    assert isinstance(result, str)
    assert len(result) > 0
    # must be a valid hex string
    int(result, 16)


def test_phash_is_deterministic(tmp_path: Path) -> None:
    src = make_jpeg(tmp_path / "photo.jpg", 200, 200, (100, 150, 200))
    assert compute_phash(src) == compute_phash(src)


def test_phash_accepts_str_path(tmp_path: Path) -> None:
    src = make_jpeg(tmp_path / "photo.jpg", 200, 200, (50, 80, 120))
    # should work with a plain string, not just Path
    result = compute_phash(str(src))
    assert isinstance(result, str)


def test_phash_raises_file_not_found(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        compute_phash(tmp_path / "missing.jpg")


def test_phash_raises_for_directory(tmp_path: Path) -> None:
    """Passing a directory should raise ValueError, not crash with a cryptic OSError."""
    with pytest.raises((ValueError, IsADirectoryError)):
        compute_phash(tmp_path)  # tmp_path is a directory


def test_phash_raises_value_error_for_non_image(tmp_path: Path) -> None:
    bad = tmp_path / "notanimage.jpg"
    bad.write_bytes(b"this is not image data")
    with pytest.raises(ValueError):
        compute_phash(bad)


def test_phash_differs_between_visually_different_images(tmp_path: Path) -> None:
    """A horizontal gradient and its 90° rotation produce different pHashes."""
    grad = make_gradient(tmp_path / "grad.jpg", 64, 64)
    # rotate 90° to create a vertical gradient — visually very different
    img = Image.open(str(grad)).rotate(90)
    rot = tmp_path / "grad_rot.jpg"
    img.save(str(rot), "JPEG")

    assert compute_phash(grad) != compute_phash(rot)


# ---------------------------------------------------------------------------
# compute_sha256
# ---------------------------------------------------------------------------


def test_sha256_returns_64_char_hex(tmp_path: Path) -> None:
    src = make_jpeg(tmp_path / "photo.jpg", 100, 100, (0, 0, 0))
    result = compute_sha256(src)
    assert isinstance(result, str)
    assert len(result) == 64
    int(result, 16)  # valid hex


def test_sha256_is_deterministic(tmp_path: Path) -> None:
    src = make_jpeg(tmp_path / "photo.jpg", 100, 100, (255, 0, 0))
    assert compute_sha256(src) == compute_sha256(src)


def test_sha256_differs_for_different_files(tmp_path: Path) -> None:
    a = make_jpeg(tmp_path / "a.jpg", 100, 100, (255, 0, 0))
    b = make_jpeg(tmp_path / "b.jpg", 100, 100, (0, 255, 0))
    assert compute_sha256(a) != compute_sha256(b)


def test_sha256_raises_file_not_found(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        compute_sha256(tmp_path / "missing.jpg")


def test_sha256_raises_for_directory(tmp_path: Path) -> None:
    """Passing a directory should raise IsADirectoryError, not silently read 0 bytes."""
    with pytest.raises((IsADirectoryError, ValueError)):
        compute_sha256(tmp_path)


def test_sha256_accepts_str_path(tmp_path: Path) -> None:
    src = make_jpeg(tmp_path / "photo.jpg", 100, 100, (10, 20, 30))
    result = compute_sha256(str(src))
    assert len(result) == 64


# ---------------------------------------------------------------------------
# hamming_distance
# ---------------------------------------------------------------------------


def test_hamming_distance_of_same_hash_is_zero(tmp_path: Path) -> None:
    src = make_gradient(tmp_path / "g.jpg")
    h = compute_phash(src)
    assert hamming_distance(h, h) == 0


def test_hamming_distance_all_zeros_vs_all_ones() -> None:
    # "0000000000000000" vs "ffffffffffffffff" — all 64 bits differ
    zeros = "0000000000000000"
    ones = "ffffffffffffffff"
    assert hamming_distance(zeros, ones) == 64


def test_hamming_distance_is_symmetric(tmp_path: Path) -> None:
    a = make_jpeg(tmp_path / "a.jpg", 64, 64, (200, 100, 50))
    b = make_gradient(tmp_path / "b.jpg")
    ha, hb = compute_phash(a), compute_phash(b)
    assert hamming_distance(ha, hb) == hamming_distance(hb, ha)


def test_hamming_distance_is_non_negative(tmp_path: Path) -> None:
    a = make_jpeg(tmp_path / "a.jpg", 64, 64, (200, 100, 50))
    b = make_gradient(tmp_path / "b.jpg")
    assert hamming_distance(compute_phash(a), compute_phash(b)) >= 0


# ---------------------------------------------------------------------------
# is_duplicate
# ---------------------------------------------------------------------------


def test_is_duplicate_empty_list_returns_false(tmp_path: Path) -> None:
    src = make_jpeg(tmp_path / "photo.jpg", 100, 100, (10, 10, 10))
    h = compute_phash(src)
    is_dup, match = is_duplicate(h, [])
    assert is_dup is False
    assert match is None


def test_is_duplicate_identical_phash_returns_true(tmp_path: Path) -> None:
    src = make_gradient(tmp_path / "photo.jpg")
    h = compute_phash(src)
    is_dup, match = is_duplicate(h, [h])
    assert is_dup is True
    assert match == h


def test_is_duplicate_returns_first_matching_hash(tmp_path: Path) -> None:
    src = make_gradient(tmp_path / "photo.jpg")
    h = compute_phash(src)
    # "ffffffffffffffff" is maximally different (distance=~61) and won't match
    sentinel = "ffffffffffffffff"
    is_dup, match = is_duplicate(h, [sentinel, h])
    assert is_dup is True
    assert match == h


def test_is_duplicate_clearly_different_image_returns_false(tmp_path: Path) -> None:
    """All-zeros hash vs all-ones hash — distance=64, well above any threshold."""
    assert is_duplicate("0000000000000000", ["ffffffffffffffff"])[0] is False


def test_is_duplicate_respects_custom_threshold(tmp_path: Path) -> None:
    """Threshold=0 means only exact matches are duplicates."""
    a = make_gradient(tmp_path / "a.jpg")
    b_img = Image.open(str(a))
    # flip to create a slightly different image
    b_img = b_img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    b = tmp_path / "b.jpg"
    b_img.save(str(b), "JPEG")

    ha, hb = compute_phash(a), compute_phash(b)
    # with threshold=0, only exact match counts
    if ha != hb:
        is_dup, _ = is_duplicate(ha, [hb], hamming_threshold=0)
        assert is_dup is False
    # with high threshold, they should match
    is_dup_high, _ = is_duplicate(ha, [hb], hamming_threshold=64)
    assert is_dup_high is True


def test_is_duplicate_default_threshold_is_10() -> None:
    """Hashes exactly 10 bits apart are duplicates under the default threshold."""
    h_base = "0000000000000000"
    # 0x03ff = 0b0000001111111111 — exactly 10 bits set → distance = 10
    h_near = "00000000000003ff"
    is_dup, _ = is_duplicate(h_base, [h_near])
    assert is_dup is True


def test_is_duplicate_invalid_threshold_raises() -> None:
    """hamming_threshold outside [0, 64] must raise ValueError."""
    with pytest.raises(ValueError):
        is_duplicate("0000000000000000", [], hamming_threshold=65)
    with pytest.raises(ValueError):
        is_duplicate("0000000000000000", [], hamming_threshold=-1)


def test_is_duplicate_above_threshold_returns_false() -> None:
    """Hashes 11 bits apart are NOT duplicates with default threshold=10."""
    h_base = "0000000000000000"
    # 11 bits set: 0b11111111111 = 0x7ff
    h_far = "00000000000007ff"  # 11 bits — above threshold=10
    is_dup, _ = is_duplicate(h_base, [h_far])
    assert is_dup is False
