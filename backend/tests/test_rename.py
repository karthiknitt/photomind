"""
Tests for the rename service.

Naming convention: YYYY-MM-DD_HHMMSS_[City]_[Person1-Person2]_[CameraModel]_[4chars].ext

Rules tested:
- 4-char salt = first 4 hex chars of SHA256 of the file
- Missing date falls back to file mtime
- Missing optional segments (city, persons, camera) are omitted
- Extensions normalized to lowercase
- Special characters stripped; spaces → hyphens
- Max 200 chars: drop camera first, then city, then persons
- Collision: _v2, _v3 appended before extension
"""

from __future__ import annotations

import hashlib
import time
from pathlib import Path

import pytest

from photomind.services.rename import RenameResult, generate_filename


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _make_file(tmp_path: Path, content: bytes = b"fake image data") -> Path:
    """Create a temp file with known content for SHA256 testing."""
    f = tmp_path / "test.jpg"
    f.write_bytes(content)
    return f


def _sha4(content: bytes) -> str:
    """First 4 hex chars of SHA256."""
    return hashlib.sha256(content).hexdigest()[:4]


CONTENT = b"fake image data"
SALT = _sha4(CONTENT)  # deterministic salt for this content

DATE_2024 = 1735138222  # 2024-12-25 14:30:22 UTC


# ─── TestRenameResult ─────────────────────────────────────────────────────────


class TestRenameResult:
    def test_has_filename_attribute(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
        )
        assert isinstance(result, RenameResult)
        assert isinstance(result.filename, str)


# ─── TestSalt ─────────────────────────────────────────────────────────────────


class TestSalt:
    def test_salt_is_first_4_sha256_hex_chars(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path, CONTENT)
        result = generate_filename(file_path=f, date_taken=DATE_2024, extension=".jpg")
        assert result.filename.endswith(f"_{SALT}.jpg")

    def test_same_file_same_salt(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path, CONTENT)
        r1 = generate_filename(file_path=f, date_taken=DATE_2024, extension=".jpg")
        r2 = generate_filename(file_path=f, date_taken=DATE_2024, extension=".jpg")
        assert r1.filename == r2.filename

    def test_different_content_different_salt(self, tmp_path: Path) -> None:
        f1 = tmp_path / "a.jpg"
        f1.write_bytes(b"content A")
        f2 = tmp_path / "b.jpg"
        f2.write_bytes(b"content B")
        r1 = generate_filename(file_path=f1, date_taken=DATE_2024, extension=".jpg")
        r2 = generate_filename(file_path=f2, date_taken=DATE_2024, extension=".jpg")
        # Stems differ (different salts)
        assert r1.filename.split("_")[-1] != r2.filename.split("_")[-1]


# ─── TestDateSegment ──────────────────────────────────────────────────────────


class TestDateSegment:
    def test_date_formats_correctly(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(file_path=f, date_taken=DATE_2024, extension=".jpg")
        assert result.filename.startswith("2024-12-25_143022")

    def test_none_date_falls_back_to_mtime(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        # mtime is set automatically when the file is created — it's a real timestamp
        result = generate_filename(file_path=f, date_taken=None, extension=".jpg")
        # Should still produce a date-like prefix (YYYY-MM-DD_HHMMSS)
        import re
        assert re.match(r"\d{4}-\d{2}-\d{2}_\d{6}", result.filename)

    def test_mtime_fallback_uses_file_mtime(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        # Force a known mtime
        known_ts = 1672531200  # 2023-01-01 00:00:00 UTC
        import os
        os.utime(f, (known_ts, known_ts))
        result = generate_filename(file_path=f, date_taken=None, extension=".jpg")
        assert result.filename.startswith("2023-01-01_000000")


# ─── TestExtension ────────────────────────────────────────────────────────────


class TestExtension:
    def test_lowercase_jpg(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(file_path=f, date_taken=DATE_2024, extension=".JPG")
        assert result.filename.endswith(".jpg")

    def test_lowercase_jpeg(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(file_path=f, date_taken=DATE_2024, extension=".JPEG")
        assert result.filename.endswith(".jpeg")

    def test_lowercase_heic(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(file_path=f, date_taken=DATE_2024, extension=".HEIC")
        assert result.filename.endswith(".heic")

    def test_extension_without_dot_is_accepted(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(file_path=f, date_taken=DATE_2024, extension="jpg")
        assert result.filename.endswith(".jpg")


# ─── TestOptionalSegments ─────────────────────────────────────────────────────


class TestOptionalSegments:
    def test_no_optional_segments_produces_minimal_name(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(file_path=f, date_taken=DATE_2024, extension=".jpg")
        # Expected: 2024-12-25_143022_<salt>.jpg
        parts = result.filename[:-4].split("_")  # strip .jpg
        assert len(parts) == 3  # date, time, salt
        assert parts[0] == "2024-12-25"
        assert parts[1] == "143022"
        assert parts[2] == SALT

    def test_city_included_when_provided(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(
            file_path=f, date_taken=DATE_2024, extension=".jpg", city="Ooty"
        )
        assert "Ooty" in result.filename

    def test_city_omitted_when_none(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(
            file_path=f, date_taken=DATE_2024, extension=".jpg", city=None
        )
        assert "None" not in result.filename

    def test_city_omitted_when_empty_string(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(
            file_path=f, date_taken=DATE_2024, extension=".jpg", city=""
        )
        # city="" from geo service when GPS is present but city is unknown
        # Should be treated same as None
        assert "__" not in result.filename  # no double underscore

    def test_camera_model_included_when_provided(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            camera_model="iPhone14Pro",
        )
        assert "iPhone14Pro" in result.filename

    def test_camera_model_omitted_when_none(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(
            file_path=f, date_taken=DATE_2024, extension=".jpg", camera_model=None
        )
        assert "unknown" not in result.filename

    def test_persons_joined_with_hyphen(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            person_names=["Karthik", "Priya"],
        )
        assert "Karthik-Priya" in result.filename

    def test_single_person_no_hyphen(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            person_names=["Ammu"],
        )
        assert "Ammu" in result.filename
        assert "Ammu-" not in result.filename

    def test_persons_omitted_when_none(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            person_names=None,
        )
        assert "None" not in result.filename

    def test_persons_omitted_when_empty_list(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            person_names=[],
        )
        assert "__" not in result.filename

    def test_full_name_all_segments(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path, CONTENT)
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            city="Ooty",
            camera_model="iPhone14Pro",
            person_names=["Karthik", "Priya"],
        )
        expected = f"2024-12-25_143022_Ooty_Karthik-Priya_iPhone14Pro_{SALT}.jpg"
        assert result.filename == expected


# ─── TestSanitization ─────────────────────────────────────────────────────────


class TestSanitization:
    def test_spaces_in_city_become_hyphens(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(
            file_path=f, date_taken=DATE_2024, extension=".jpg", city="New York"
        )
        assert "New-York" in result.filename
        assert " " not in result.filename

    def test_spaces_in_camera_model_become_hyphens(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            camera_model="Galaxy S23 Ultra",
        )
        assert "Galaxy-S23-Ultra" in result.filename

    def test_special_chars_stripped_from_city(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            city="São Paulo",
        )
        # Special chars stripped, spaces → hyphens
        assert " " not in result.filename
        assert "/" not in result.filename

    def test_special_chars_stripped_from_camera_model(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            camera_model="Canon EOS-1D X Mark III",
        )
        assert "/" not in result.filename
        assert " " not in result.filename


# ─── TestCollisionHandling ────────────────────────────────────────────────────


class TestCollisionHandling:
    def test_no_collision_no_suffix(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path, CONTENT)
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            existing_names=set(),
        )
        assert "_v2" not in result.filename
        assert "_v3" not in result.filename

    def test_collision_appends_v2(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path, CONTENT)
        base = f"2024-12-25_143022_{SALT}.jpg"
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            existing_names={base},
        )
        assert result.filename == f"2024-12-25_143022_{SALT}_v2.jpg"

    def test_double_collision_appends_v3(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path, CONTENT)
        base = f"2024-12-25_143022_{SALT}.jpg"
        v2 = f"2024-12-25_143022_{SALT}_v2.jpg"
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            existing_names={base, v2},
        )
        assert result.filename == f"2024-12-25_143022_{SALT}_v3.jpg"

    def test_existing_names_none_treated_as_empty(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path, CONTENT)
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            existing_names=None,
        )
        assert "_v2" not in result.filename


# ─── TestMaxLength ────────────────────────────────────────────────────────────


class TestMaxLength:
    def test_short_name_not_truncated(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path)
        result = generate_filename(file_path=f, date_taken=DATE_2024, extension=".jpg")
        assert len(result.filename) <= 200

    def test_long_camera_model_dropped_first(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path, CONTENT)
        long_camera = "A" * 180
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            city="Chennai",
            camera_model=long_camera,
            person_names=["Karthik"],
        )
        assert len(result.filename) <= 200
        assert long_camera not in result.filename
        # City and persons should still be present if they fit
        assert "Chennai" in result.filename

    def test_long_city_dropped_after_camera(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path, CONTENT)
        long_city = "B" * 180
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            city=long_city,
            person_names=["Karthik"],
        )
        assert len(result.filename) <= 200
        assert long_city not in result.filename

    def test_date_and_salt_always_preserved(self, tmp_path: Path) -> None:
        f = _make_file(tmp_path, CONTENT)
        long_city = "C" * 180
        long_camera = "D" * 180
        long_persons = ["E" * 180]
        result = generate_filename(
            file_path=f,
            date_taken=DATE_2024,
            extension=".jpg",
            city=long_city,
            camera_model=long_camera,
            person_names=long_persons,
        )
        assert len(result.filename) <= 200
        assert result.filename.startswith("2024-12-25_143022")
        assert SALT in result.filename


# ─── TestFileNotFound ─────────────────────────────────────────────────────────


class TestFileNotFound:
    def test_raises_file_not_found(self, tmp_path: Path) -> None:
        missing = tmp_path / "nonexistent.jpg"
        with pytest.raises(FileNotFoundError):
            generate_filename(file_path=missing, date_taken=DATE_2024, extension=".jpg")
