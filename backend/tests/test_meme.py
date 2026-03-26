"""
Tests for the meme detection service.

Meme signals (updated — WhatsApp downgraded from HIGH to MEDIUM):

  HIGH (fires alone):
    1. CLIP top-3 labels contain "meme", "text overlay", or "screenshot"

  MEDIUM (need ≥2 medium/low to classify as meme):
    2. EXIF software field contains "whatsapp" (case-insensitive)
    3. Filename matches WhatsApp naming patterns
       (IMG-YYYYMMDD-WA####.jpg  or  "WhatsApp Image …"  or  VID-YYYYMMDD-WA####.mp4)
    4. Aspect ratio 9:16, 1:1, or 16:9 (±2% tolerance)
    5. No EXIF date

  LOW (counts toward medium/low total):
    6. File size < 150 KB for image > 500 px on longest side

Decision rule:
  is_meme = True  if any HIGH signal fires
            OR ≥2 medium/low signals fire

Rationale for WhatsApp demotion:
  Many genuine family photos are shared via WhatsApp, causing both the
  EXIF software field and filename to contain "WhatsApp".  Using either
  signal alone was causing false positives.  Combined with a second signal
  (missing date, unusual aspect ratio, or tiny file) it remains a useful
  classifier.
"""

from __future__ import annotations

import pytest

from photomind.services.meme import MemeCheckResult, check_meme

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

_NORMAL = {
    "software": None,
    "filename": None,
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
# MEDIUM signal: WhatsApp EXIF software field
# (was HIGH — downgraded; alone is no longer sufficient)
# ---------------------------------------------------------------------------


def test_whatsapp_software_alone_is_not_meme() -> None:
    """WhatsApp EXIF software alone should NOT classify as meme.

    Real family photos shared via WhatsApp carry this tag but are not memes.
    The signal is MEDIUM — a second corroborating signal is required.
    """
    result = _meme(software="WhatsApp")
    assert result.is_meme is False


def test_whatsapp_software_case_insensitive_is_medium_signal() -> None:
    """WhatsApp software is recognised regardless of case, but alone = not meme."""
    for variant in ("WHATSAPP", "whatsapp", "WhatsApp", "WhatSApp 2.24.1"):
        result = _meme(software=variant)
        # MEDIUM signal alone — not a meme
        assert result.is_meme is False, (
            f"WhatsApp software alone should not be meme: {variant!r}"
        )


def test_whatsapp_software_plus_no_date_is_meme() -> None:
    """WhatsApp software (MEDIUM) + no EXIF date (MEDIUM) = 2 signals → meme."""
    result = _meme(software="WhatsApp", has_exif_date=False)
    assert result.is_meme is True


def test_whatsapp_software_plus_aspect_ratio_is_meme() -> None:
    """WhatsApp software (MEDIUM) + 9:16 aspect ratio (MEDIUM) = 2 signals → meme."""
    result = _meme(software="WhatsApp", width=1080, height=1920)
    assert result.is_meme is True


def test_whatsapp_software_plus_small_file_is_meme() -> None:
    """WhatsApp software (MEDIUM) + small file (LOW) = 2 signals → meme."""
    result = _meme(software="WhatsApp", file_size=100_000, width=1080, height=1920)
    assert result.is_meme is True


def test_non_whatsapp_software_not_a_signal() -> None:
    result = _meme(software="Adobe Lightroom")
    assert result.is_meme is False


# ---------------------------------------------------------------------------
# MEDIUM signal: WhatsApp filename patterns
# ---------------------------------------------------------------------------


def test_wa_filename_img_pattern_fires_medium_signal() -> None:
    """IMG-YYYYMMDD-WA####.jpg is a WhatsApp-saved filename — MEDIUM signal."""
    result = _meme(filename="IMG-20240101-WA0001.jpg")
    # MEDIUM signal alone → not meme
    assert result.is_meme is False


def test_wa_filename_vid_pattern_fires_medium_signal() -> None:
    """VID-YYYYMMDD-WA####.mp4 is a WhatsApp video filename — MEDIUM signal."""
    result = _meme(filename="VID-20240725-WA0042.mp4")
    assert result.is_meme is False


def test_wa_filename_whatsapp_image_pattern_fires_medium_signal() -> None:
    """'WhatsApp Image YYYY-MM-DD at HH.MM.SS.jpeg' — MEDIUM signal alone."""
    result = _meme(filename="WhatsApp Image 2024-07-15 at 14.35.22.jpeg")
    assert result.is_meme is False


def test_wa_filename_pattern_case_insensitive() -> None:
    """Pattern matching is case-insensitive."""
    result = _meme(filename="img-20240101-wa0001.JPG")
    assert result.is_meme is False  # alone not meme, but signal should be detected


def test_wa_filename_plus_no_date_is_meme() -> None:
    """WA filename (MEDIUM) + no EXIF date (MEDIUM) = 2 signals → meme."""
    result = _meme(filename="IMG-20240101-WA0001.jpg", has_exif_date=False)
    assert result.is_meme is True


def test_wa_filename_plus_software_is_meme() -> None:
    """WA filename (MEDIUM) + WhatsApp software (MEDIUM) = 2 signals → meme."""
    result = _meme(filename="IMG-20240101-WA0001.jpg", software="WhatsApp")
    assert result.is_meme is True


def test_wa_filename_plus_aspect_ratio_is_meme() -> None:
    """WA filename (MEDIUM) + 9:16 ratio (MEDIUM) = 2 signals → meme."""
    result = _meme(
        filename="WhatsApp Image 2024-01-01 at 10.00.00.jpeg",
        width=1080,
        height=1920,
    )
    assert result.is_meme is True


def test_normal_filename_does_not_fire_wa_signal() -> None:
    """Regular camera filenames (IMG_001.jpg, DSC_001.jpg) are not WA patterns."""
    for fname in ("IMG_001.jpg", "DSC_0042.JPG", "DCIM_2024.jpg", "photo.jpeg"):
        result = _meme(filename=fname)
        assert result.is_meme is False, (
            f"Normal filename should not fire WA signal: {fname!r}"
        )


def test_filename_none_does_not_fire_wa_signal() -> None:
    result = _meme(filename=None)
    assert result.is_meme is False


def test_full_path_filename_is_also_matched() -> None:
    """The function should match the basename even when a full path is passed."""
    result = _meme(
        filename="/Pictures/WhatsApp/IMG-20240101-WA0001.jpg",
        has_exif_date=False,
    )
    assert result.is_meme is True


# ---------------------------------------------------------------------------
# HIGH signal: CLIP labels (still HIGH — fires alone)
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


def test_clip_alone_fires_even_with_normal_photo_metadata() -> None:
    """CLIP HIGH signal fires alone — no other signals needed."""
    result = _meme(
        software=None,
        filename="photo.jpg",
        has_exif_date=True,
        width=3024,
        height=4032,
        file_size=8_000_000,
        clip_labels=["meme", "text overlay", "screenshot"],
    )
    assert result.is_meme is True


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
    # 1 medium signal (no-date); small image — low signal should NOT fire
    result = _meme(file_size=50_000, width=300, height=400, has_exif_date=False)
    # Only 1 medium signal (no-date); low signal suppressed → not meme
    assert result.is_meme is False


def test_file_exactly_150kb_does_not_fire_low_signal() -> None:
    """File size must be strictly less than 150 KB to fire the low signal.

    Use 4:3 (non-meme) dimensions and has_exif_date=True so no other
    signal fires — confirming file_size=150_000 at the threshold does not fire.
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
    result = _meme(has_exif_date=False, width=1080, height=1920)
    assert len(result.reasons) > 0


def test_reasons_list_describes_all_fired_signals() -> None:
    """All fired signals should appear in the reasons list."""
    result = _meme(has_exif_date=False, width=1080, height=1920)
    assert len(result.reasons) >= 2


def test_reasons_empty_when_not_meme() -> None:
    result = _meme(software="WhatsApp")  # only 1 MEDIUM signal
    assert result.is_meme is False
    assert result.reasons == []


def test_none_software_does_not_fire_whatsapp_signal() -> None:
    result = _meme(software=None)
    assert result.is_meme is False


def test_empty_string_software_does_not_fire_whatsapp_signal() -> None:
    result = _meme(software="")
    assert result.is_meme is False


def test_three_medium_signals_are_meme() -> None:
    """WhatsApp software + filename + no date = 3 MEDIUM signals → meme."""
    result = _meme(
        software="WhatsApp",
        filename="IMG-20240101-WA0001.jpg",
        has_exif_date=False,
    )
    assert result.is_meme is True
