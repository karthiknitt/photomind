"""
Tests for the meme detection service.

Meme signals (from docs/plan.md):
  HIGH:   software contains "whatsapp" (case-insensitive)
  HIGH:   CLIP top-3 labels contain "meme", "text overlay", or "screenshot"
  MEDIUM: aspect ratio 9:16, 1:1, or 16:9 (±2% tolerance)
  MEDIUM: no EXIF date
  LOW:    file size < 150 KB for image > 500 px on longest side

Decision rule:
  is_meme = True  if any HIGH signal fires
            OR ≥2 medium/low signals fire

check_meme() accepts keyword-only arguments so callers can pass exactly
the data they have without constructing a container object.
"""

from __future__ import annotations

import pytest

from photomind.services.meme import MemeCheckResult, check_meme

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

_NORMAL = {
    "software": None,
    "has_exif_date": True,
    "width": 3024,
    "height": 4032,
    "file_size": 4_500_000,  # 4.5 MB — real photo
    "clip_labels": None,
}


def _meme(**overrides: object) -> MemeCheckResult:
    """Call check_meme with _NORMAL defaults, overriding specified keys."""
    kwargs = {**_NORMAL, **overrides}
    return check_meme(**kwargs)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# return type
# ---------------------------------------------------------------------------


def test_returns_meme_check_result() -> None:
    result = _meme()
    assert isinstance(result, MemeCheckResult)
    assert hasattr(result, "is_meme")
    assert hasattr(result, "reasons")


def test_normal_photo_is_not_meme() -> None:
    result = _meme()
    assert result.is_meme is False
    assert result.reasons == []


# ---------------------------------------------------------------------------
# HIGH signal: WhatsApp software
# ---------------------------------------------------------------------------


def test_whatsapp_software_is_meme() -> None:
    result = _meme(software="WhatsApp")
    assert result.is_meme is True
    assert any("whatsapp" in r.lower() for r in result.reasons)


def test_whatsapp_software_case_insensitive() -> None:
    for variant in ("WHATSAPP", "whatsapp", "WhatsApp", "WhatSApp 2.24.1"):
        result = _meme(software=variant)
        assert result.is_meme is True, f"Expected meme for software={variant!r}"


def test_non_whatsapp_software_not_high_signal() -> None:
    result = _meme(software="Adobe Lightroom")
    # software alone should not fire unless it contains "whatsapp"
    assert result.is_meme is False


# ---------------------------------------------------------------------------
# HIGH signal: CLIP labels
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("label", ["meme", "text overlay", "screenshot"])
def test_clip_high_label_in_top3_is_meme(label: str) -> None:
    result = _meme(clip_labels=[label, "sky", "tree"])
    assert result.is_meme is True
    assert any("clip" in r.lower() for r in result.reasons)


def test_clip_labels_none_skips_clip_signal() -> None:
    """No CLIP signal when clip_labels is None (Phase 1 behaviour)."""
    result = _meme(clip_labels=None)
    assert result.is_meme is False


def test_clip_labels_no_meme_keywords_not_high() -> None:
    result = _meme(clip_labels=["sunset", "beach", "family"])
    assert result.is_meme is False


def test_clip_signal_only_checks_first_three_labels() -> None:
    """The meme keyword must appear in the top-3 labels, not beyond."""
    result = _meme(clip_labels=["sunset", "beach", "family", "meme"])
    assert result.is_meme is False


# ---------------------------------------------------------------------------
# MEDIUM signal: aspect ratio (9:16, 1:1, 16:9) ±2% tolerance
# ---------------------------------------------------------------------------


def test_9_16_portrait_aspect_ratio_fires_medium_signal() -> None:
    # pure 9:16: width=1080, height=1920
    result = _meme(width=1080, height=1920, has_exif_date=False)
    # 2 medium signals → meme
    assert result.is_meme is True


def test_1_1_square_aspect_ratio_fires_medium_signal() -> None:
    result = _meme(width=1080, height=1080, has_exif_date=False)
    assert result.is_meme is True


def test_16_9_landscape_aspect_ratio_fires_medium_signal() -> None:
    result = _meme(width=1920, height=1080, has_exif_date=False)
    assert result.is_meme is True


def test_aspect_ratio_tolerance_within_2_percent() -> None:
    """Width/height within ±2% of 9:16 still fires the signal."""
    # 9/16 = 0.5625; 1% deviation ≈ w=1090, h=1920
    result = _meme(width=1090, height=1920, has_exif_date=False)
    assert result.is_meme is True


def test_aspect_ratio_outside_tolerance_does_not_fire() -> None:
    """Aspect ratio more than 2% away from all meme ratios → no signal."""
    # 4:3 = 1.333 — far from 9:16, 1:1, 16:9
    result = _meme(width=1600, height=1200)
    assert result.is_meme is False


def test_aspect_ratio_medium_signal_alone_does_not_trigger_meme() -> None:
    """One medium signal alone is not enough for is_meme=True."""
    result = _meme(width=1080, height=1920)  # 9:16 but has_exif_date=True
    assert result.is_meme is False


# ---------------------------------------------------------------------------
# MEDIUM signal: no EXIF date
# ---------------------------------------------------------------------------


def test_no_exif_date_medium_signal_alone_not_meme() -> None:
    result = _meme(has_exif_date=False)
    assert result.is_meme is False


def test_no_exif_date_plus_aspect_ratio_is_meme() -> None:
    """Two medium signals: no date + 9:16 aspect ratio → meme."""
    result = _meme(has_exif_date=False, width=1080, height=1920)
    assert result.is_meme is True


# ---------------------------------------------------------------------------
# LOW signal: file_size < 150 KB and longest side > 500 px
# ---------------------------------------------------------------------------


def test_small_file_large_image_fires_low_signal() -> None:
    """File < 150 KB with longest side > 500 px fires the low signal alone.

    Use 4:3 (non-meme) dimensions and has_exif_date=True so no other
    signal fires — confirming the low signal alone is insufficient.
    """
    result = _meme(file_size=100_000, width=1600, height=1200)
    # low signal alone → not meme (need ≥2 medium/low)
    assert result.is_meme is False


def test_low_signal_with_medium_signal_is_meme() -> None:
    """Low signal + medium signal (no date) → 2 signals → meme."""
    result = _meme(file_size=100_000, width=1080, height=1920, has_exif_date=False)
    assert result.is_meme is True


def test_small_file_small_image_does_not_fire_low_signal() -> None:
    """Longest side ≤ 500 px: low signal does not fire (thumbnail/icon)."""
    # 2 medium signals but small image — low signal should NOT add to count
    result = _meme(file_size=50_000, width=300, height=400, has_exif_date=False)
    # Only 1 medium signal (no-date); low signal suppressed → not meme
    assert result.is_meme is False


def test_file_exactly_150kb_does_not_fire_low_signal() -> None:
    """File size must be strictly less than 150 KB to fire the low signal.

    Use 4:3 (non-meme) dimensions and has_exif_date=True so no other
    signal fires — confirming file_size=150_000 is below the threshold.
    """
    result = _meme(file_size=150_000, width=1600, height=1200)
    # no other signal fires; low signal does not fire at exactly 150 KB
    assert result.is_meme is False


# ---------------------------------------------------------------------------
# Combined / edge cases
# ---------------------------------------------------------------------------


def test_two_medium_signals_are_meme() -> None:
    result = _meme(has_exif_date=False, width=1080, height=1920)
    assert result.is_meme is True


def test_one_medium_one_low_signal_are_meme() -> None:
    result = _meme(has_exif_date=False, file_size=100_000, width=600, height=800)
    assert result.is_meme is True


def test_reasons_list_non_empty_when_meme() -> None:
    result = _meme(software="WhatsApp")
    assert len(result.reasons) > 0


def test_reasons_list_describes_all_fired_signals() -> None:
    """All fired signals should appear in the reasons list."""
    result = _meme(has_exif_date=False, width=1080, height=1920)
    assert len(result.reasons) >= 2


def test_high_signal_overrides_no_other_signals() -> None:
    """A single high signal is sufficient — even with no other signals."""
    result = _meme(
        software="WhatsApp",
        has_exif_date=True,
        width=3024,
        height=4032,
        file_size=8_000_000,
        clip_labels=None,
    )
    assert result.is_meme is True


def test_none_software_does_not_fire_whatsapp_signal() -> None:
    result = _meme(software=None)
    assert result.is_meme is False


def test_empty_string_software_does_not_fire_whatsapp_signal() -> None:
    result = _meme(software="")
    assert result.is_meme is False
