"""
Tests for photomind.services.exif — EXIF extraction service.

All test images are created programmatically using Pillow + piexif.
No external fixture files required.

TDD: these tests are written BEFORE the implementation.
"""

from __future__ import annotations

import io
from datetime import UTC, datetime
from pathlib import Path

import piexif
import pytest
from PIL import Image

from photomind.services.exif import ExifData, extract_exif

# ---------------------------------------------------------------------------
# Helpers for building synthetic EXIF blobs
# ---------------------------------------------------------------------------


def _make_ifd_rational(numerator: int, denominator: int) -> tuple[int, int]:
    """Return a piexif-compatible rational tuple."""
    return (numerator, denominator)


def _dms_rationals(
    degrees: int, minutes: int, seconds_numerator: int, seconds_denominator: int = 100
) -> list[tuple[int, int]]:
    """Return GPS DMS as list of 3 rationals for piexif."""
    return [
        _make_ifd_rational(degrees, 1),
        _make_ifd_rational(minutes, 1),
        _make_ifd_rational(seconds_numerator, seconds_denominator),
    ]


def _build_jpeg_with_full_exif(
    width: int = 100,
    height: int = 80,
    date_str: str = "2024:12:25 14:30:22",
    lat_dms: list[tuple[int, int]] | None = None,
    lat_ref: str = "N",
    lon_dms: list[tuple[int, int]] | None = None,
    lon_ref: str = "E",
    make: str = "Apple",
    model: str = "iPhone 14 Pro",
    software: str = "PhotoMind",
) -> bytes:
    """Create an in-memory JPEG with full EXIF data."""
    if lat_dms is None:
        lat_dms = _dms_rationals(37, 46, 2988, 100)  # ~37.7758 N
    if lon_dms is None:
        lon_dms = _dms_rationals(122, 25, 1188, 100)  # ~122.4197 W

    gps_ifd = {
        piexif.GPSIFD.GPSLatitudeRef: lat_ref.encode(),
        piexif.GPSIFD.GPSLatitude: lat_dms,
        piexif.GPSIFD.GPSLongitudeRef: lon_ref.encode(),
        piexif.GPSIFD.GPSLongitude: lon_dms,
    }

    exif_ifd = {
        piexif.ExifIFD.DateTimeOriginal: date_str.encode(),
    }

    zeroth_ifd = {
        piexif.ImageIFD.Make: make.encode(),
        piexif.ImageIFD.Model: model.encode(),
        piexif.ImageIFD.Software: software.encode(),
    }

    exif_dict = {
        "0th": zeroth_ifd,
        "Exif": exif_ifd,
        "GPS": gps_ifd,
    }
    exif_bytes = piexif.dump(exif_dict)

    img = Image.new("RGB", (width, height), color=(128, 64, 32))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif_bytes)
    return buf.getvalue()


def _build_jpeg_no_exif(width: int = 200, height: int = 150) -> bytes:
    """Create an in-memory JPEG with no EXIF at all."""
    img = Image.new("RGB", (width, height), color=(0, 128, 255))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _build_jpeg_partial_exif(
    width: int = 60,
    height: int = 40,
    make: str = "Samsung",
) -> bytes:
    """Create a JPEG with only Make in EXIF (no GPS, no date, no model, no software)."""
    zeroth_ifd = {
        piexif.ImageIFD.Make: make.encode(),
    }
    exif_dict = {"0th": zeroth_ifd, "Exif": {}, "GPS": {}}
    exif_bytes = piexif.dump(exif_dict)

    img = Image.new("RGB", (width, height), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif_bytes)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Test 1: Full EXIF — all fields populated correctly
# ---------------------------------------------------------------------------


class TestFullExif:
    def test_full_exif_returns_exif_data_instance(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "full.jpg"
        jpeg_path.write_bytes(_build_jpeg_with_full_exif())

        result = extract_exif(jpeg_path)

        assert isinstance(result, ExifData)

    def test_full_exif_camera_make(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "full.jpg"
        jpeg_path.write_bytes(_build_jpeg_with_full_exif(make="Apple"))

        result = extract_exif(jpeg_path)

        assert result.camera_make == "Apple"

    def test_full_exif_camera_model(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "full.jpg"
        jpeg_path.write_bytes(_build_jpeg_with_full_exif(model="iPhone 14 Pro"))

        result = extract_exif(jpeg_path)

        assert result.camera_model == "iPhone 14 Pro"

    def test_full_exif_software(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "full.jpg"
        jpeg_path.write_bytes(_build_jpeg_with_full_exif(software="PhotoMind"))

        result = extract_exif(jpeg_path)

        assert result.software == "PhotoMind"

    def test_full_exif_date_original_str(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "full.jpg"
        jpeg_path.write_bytes(
            _build_jpeg_with_full_exif(date_str="2024:12:25 14:30:22")
        )

        result = extract_exif(jpeg_path)

        assert result.date_original_str == "2024:12:25 14:30:22"

    def test_full_exif_dimensions_from_image(self, tmp_path: Path) -> None:
        """width/height must come from actual image, not EXIF."""
        jpeg_path = tmp_path / "dims.jpg"
        jpeg_path.write_bytes(_build_jpeg_with_full_exif(width=320, height=240))

        result = extract_exif(jpeg_path)

        assert result.width == 320
        assert result.height == 240

    def test_full_exif_accepts_string_path(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "strpath.jpg"
        jpeg_path.write_bytes(_build_jpeg_with_full_exif())

        result = extract_exif(str(jpeg_path))

        assert isinstance(result, ExifData)


# ---------------------------------------------------------------------------
# Test 2: No EXIF — nullable fields are None, dimensions still correct
# ---------------------------------------------------------------------------


class TestNoExif:
    def test_no_exif_returns_exif_data(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "noexif.jpg"
        jpeg_path.write_bytes(_build_jpeg_no_exif())

        result = extract_exif(jpeg_path)

        assert isinstance(result, ExifData)

    def test_no_exif_date_taken_is_none(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "noexif.jpg"
        jpeg_path.write_bytes(_build_jpeg_no_exif())

        result = extract_exif(jpeg_path)

        assert result.date_taken is None

    def test_no_exif_date_original_str_is_none(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "noexif.jpg"
        jpeg_path.write_bytes(_build_jpeg_no_exif())

        result = extract_exif(jpeg_path)

        assert result.date_original_str is None

    def test_no_exif_gps_lat_is_none(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "noexif.jpg"
        jpeg_path.write_bytes(_build_jpeg_no_exif())

        result = extract_exif(jpeg_path)

        assert result.gps_lat is None

    def test_no_exif_gps_lon_is_none(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "noexif.jpg"
        jpeg_path.write_bytes(_build_jpeg_no_exif())

        result = extract_exif(jpeg_path)

        assert result.gps_lon is None

    def test_no_exif_camera_make_is_none(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "noexif.jpg"
        jpeg_path.write_bytes(_build_jpeg_no_exif())

        result = extract_exif(jpeg_path)

        assert result.camera_make is None

    def test_no_exif_camera_model_is_none(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "noexif.jpg"
        jpeg_path.write_bytes(_build_jpeg_no_exif())

        result = extract_exif(jpeg_path)

        assert result.camera_model is None

    def test_no_exif_software_is_none(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "noexif.jpg"
        jpeg_path.write_bytes(_build_jpeg_no_exif())

        result = extract_exif(jpeg_path)

        assert result.software is None

    def test_no_exif_dimensions_correct(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "noexif.jpg"
        jpeg_path.write_bytes(_build_jpeg_no_exif(width=200, height=150))

        result = extract_exif(jpeg_path)

        assert result.width == 200
        assert result.height == 150


# ---------------------------------------------------------------------------
# Test 3: GPS conversion — DMS rationals → decimal degrees
# ---------------------------------------------------------------------------


class TestGpsConversion:
    def test_gps_north_east(self, tmp_path: Path) -> None:
        """37°46'29.88" N, 122°25'11.88" E — positive lat, positive lon."""
        lat_dms = _dms_rationals(37, 46, 2988, 100)  # 37 + 46/60 + 29.88/3600
        lon_dms = _dms_rationals(122, 25, 1188, 100)  # 122 + 25/60 + 11.88/3600

        jpeg_bytes = _build_jpeg_with_full_exif(
            lat_dms=lat_dms,
            lat_ref="N",
            lon_dms=lon_dms,
            lon_ref="E",
        )
        jpeg_path = tmp_path / "ne.jpg"
        jpeg_path.write_bytes(jpeg_bytes)

        result = extract_exif(jpeg_path)

        assert result.gps_lat is not None
        assert result.gps_lon is not None
        assert abs(result.gps_lat - 37.7749833) < 0.001
        assert abs(result.gps_lon - 122.4199667) < 0.001

    def test_gps_south_west(self, tmp_path: Path) -> None:
        """33°52'0" S, 151°12'36" W — negative lat, negative lon."""
        lat_dms = _dms_rationals(33, 52, 0, 1)
        lon_dms = _dms_rationals(151, 12, 3600, 100)  # 36.00 seconds

        jpeg_bytes = _build_jpeg_with_full_exif(
            lat_dms=lat_dms,
            lat_ref="S",
            lon_dms=lon_dms,
            lon_ref="W",
        )
        jpeg_path = tmp_path / "sw.jpg"
        jpeg_path.write_bytes(jpeg_bytes)

        result = extract_exif(jpeg_path)

        assert result.gps_lat is not None
        assert result.gps_lon is not None
        assert result.gps_lat < 0
        assert result.gps_lon < 0
        assert abs(result.gps_lat - (-33.8667)) < 0.001
        assert abs(result.gps_lon - (-151.21)) < 0.001

    def test_gps_equator_prime_meridian(self, tmp_path: Path) -> None:
        """0°0'0" N, 0°0'0" E — should be 0.0, 0.0."""
        lat_dms = _dms_rationals(0, 0, 0, 1)
        lon_dms = _dms_rationals(0, 0, 0, 1)

        jpeg_bytes = _build_jpeg_with_full_exif(
            lat_dms=lat_dms,
            lat_ref="N",
            lon_dms=lon_dms,
            lon_ref="E",
        )
        jpeg_path = tmp_path / "zero.jpg"
        jpeg_path.write_bytes(jpeg_bytes)

        result = extract_exif(jpeg_path)

        assert result.gps_lat == pytest.approx(0.0)
        assert result.gps_lon == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Test 4: date_taken Unix timestamp conversion
# ---------------------------------------------------------------------------


class TestDateConversion:
    def test_date_taken_unix_timestamp(self, tmp_path: Path) -> None:
        """2024:12:25 14:30:22 UTC → correct Unix timestamp."""
        date_str = "2024:12:25 14:30:22"
        jpeg_path = tmp_path / "date.jpg"
        jpeg_path.write_bytes(_build_jpeg_with_full_exif(date_str=date_str))

        result = extract_exif(jpeg_path)

        # Build expected timestamp in UTC
        expected_dt = datetime(2024, 12, 25, 14, 30, 22, tzinfo=UTC)
        expected_ts = int(expected_dt.timestamp())

        assert result.date_taken == expected_ts

    def test_date_taken_new_year(self, tmp_path: Path) -> None:
        """2000:01:01 00:00:00 — Unix timestamp for Y2K."""
        date_str = "2000:01:01 00:00:00"
        jpeg_path = tmp_path / "y2k.jpg"
        jpeg_path.write_bytes(_build_jpeg_with_full_exif(date_str=date_str))

        result = extract_exif(jpeg_path)

        expected_dt = datetime(2000, 1, 1, 0, 0, 0, tzinfo=UTC)
        expected_ts = int(expected_dt.timestamp())

        assert result.date_taken == expected_ts

    def test_malformed_date_returns_none(self, tmp_path: Path) -> None:
        """If DateTimeOriginal is malformed, date_taken should be None."""
        # Build a JPEG with a bad date string injected
        zeroth_ifd = {piexif.ImageIFD.Make: b"TestCam"}
        exif_ifd = {piexif.ExifIFD.DateTimeOriginal: b"not-a-date"}
        exif_dict = {"0th": zeroth_ifd, "Exif": exif_ifd, "GPS": {}}
        exif_bytes = piexif.dump(exif_dict)

        img = Image.new("RGB", (50, 50), color=(10, 20, 30))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", exif=exif_bytes)
        jpeg_path = tmp_path / "baddate.jpg"
        jpeg_path.write_bytes(buf.getvalue())

        result = extract_exif(jpeg_path)

        assert result.date_taken is None
        # date_original_str should still carry the raw malformed string
        assert result.date_original_str == "not-a-date"


# ---------------------------------------------------------------------------
# Test 5: software field (important for WhatsApp meme detection)
# ---------------------------------------------------------------------------


class TestSoftwareField:
    def test_whatsapp_software_field(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "whatsapp.jpg"
        jpeg_path.write_bytes(_build_jpeg_with_full_exif(software="WhatsApp"))

        result = extract_exif(jpeg_path)

        assert result.software == "WhatsApp"

    def test_photoshop_software_field(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "ps.jpg"
        jpeg_path.write_bytes(
            _build_jpeg_with_full_exif(software="Adobe Photoshop 25.0")
        )

        result = extract_exif(jpeg_path)

        assert result.software == "Adobe Photoshop 25.0"


# ---------------------------------------------------------------------------
# Test 6: Dimensions from actual image, not EXIF
# ---------------------------------------------------------------------------


class TestDimensions:
    def test_100x200_image(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "100x200.jpg"
        jpeg_path.write_bytes(_build_jpeg_with_full_exif(width=100, height=200))

        result = extract_exif(jpeg_path)

        assert result.width == 100
        assert result.height == 200

    def test_1x1_image(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "1x1.jpg"
        img = Image.new("RGB", (1, 1), color=(0, 0, 0))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        jpeg_path.write_bytes(buf.getvalue())

        result = extract_exif(jpeg_path)

        assert result.width == 1
        assert result.height == 1

    def test_landscape_dimensions(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "landscape.jpg"
        jpeg_path.write_bytes(_build_jpeg_no_exif(width=1920, height=1080))

        result = extract_exif(jpeg_path)

        assert result.width == 1920
        assert result.height == 1080

    def test_portrait_dimensions(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "portrait.jpg"
        jpeg_path.write_bytes(_build_jpeg_no_exif(width=1080, height=1920))

        result = extract_exif(jpeg_path)

        assert result.width == 1080
        assert result.height == 1920


# ---------------------------------------------------------------------------
# Test 7: FileNotFoundError for missing file
# ---------------------------------------------------------------------------


class TestFileNotFound:
    def test_missing_file_raises_file_not_found(self, tmp_path: Path) -> None:
        missing = tmp_path / "does_not_exist.jpg"

        with pytest.raises(FileNotFoundError):
            extract_exif(missing)

    def test_missing_file_string_path(self, tmp_path: Path) -> None:
        missing = str(tmp_path / "ghost.jpg")

        with pytest.raises(FileNotFoundError):
            extract_exif(missing)


# ---------------------------------------------------------------------------
# Test 8: ValueError for non-image file
# ---------------------------------------------------------------------------


class TestNonImageFile:
    def test_text_file_raises_value_error(self, tmp_path: Path) -> None:
        txt_file = tmp_path / "notimage.txt"
        txt_file.write_text("This is not an image file.\n")

        with pytest.raises(ValueError, match="Cannot open"):
            extract_exif(txt_file)

    def test_binary_garbage_raises_value_error(self, tmp_path: Path) -> None:
        garbage = tmp_path / "garbage.jpg"
        garbage.write_bytes(bytes(range(256)) * 10)

        with pytest.raises(ValueError, match="Cannot open"):
            extract_exif(garbage)

    def test_empty_file_raises_value_error(self, tmp_path: Path) -> None:
        empty = tmp_path / "empty.jpg"
        empty.write_bytes(b"")

        with pytest.raises(ValueError, match="Cannot open"):
            extract_exif(empty)


# ---------------------------------------------------------------------------
# Test 9: Partial EXIF — missing tags return None
# ---------------------------------------------------------------------------


class TestPartialExif:
    def test_partial_exif_make_present_rest_none(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "partial.jpg"
        jpeg_path.write_bytes(_build_jpeg_partial_exif(make="Samsung"))

        result = extract_exif(jpeg_path)

        assert result.camera_make == "Samsung"
        assert result.camera_model is None
        assert result.software is None
        assert result.date_taken is None
        assert result.date_original_str is None
        assert result.gps_lat is None
        assert result.gps_lon is None

    def test_partial_exif_dimensions_still_correct(self, tmp_path: Path) -> None:
        jpeg_path = tmp_path / "partial.jpg"
        jpeg_path.write_bytes(_build_jpeg_partial_exif(width=60, height=40))

        result = extract_exif(jpeg_path)

        assert result.width == 60
        assert result.height == 40

    def test_exif_with_date_no_gps(self, tmp_path: Path) -> None:
        """EXIF with DateTimeOriginal but no GPS — GPS fields should be None."""
        zeroth_ifd = {piexif.ImageIFD.Make: b"Canon"}
        exif_ifd = {piexif.ExifIFD.DateTimeOriginal: b"2023:06:15 09:00:00"}
        exif_dict = {"0th": zeroth_ifd, "Exif": exif_ifd, "GPS": {}}
        exif_bytes = piexif.dump(exif_dict)

        img = Image.new("RGB", (80, 60), color=(100, 100, 100))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", exif=exif_bytes)
        jpeg_path = tmp_path / "date_no_gps.jpg"
        jpeg_path.write_bytes(buf.getvalue())

        result = extract_exif(jpeg_path)

        assert result.date_original_str == "2023:06:15 09:00:00"
        assert result.date_taken is not None
        assert result.gps_lat is None
        assert result.gps_lon is None

    def test_exif_with_gps_no_date(self, tmp_path: Path) -> None:
        """EXIF with GPS but no DateTimeOriginal — date fields should be None."""
        lat_dms = _dms_rationals(51, 30, 0, 1)
        lon_dms = _dms_rationals(0, 7, 3420, 100)

        gps_ifd = {
            piexif.GPSIFD.GPSLatitudeRef: b"N",
            piexif.GPSIFD.GPSLatitude: lat_dms,
            piexif.GPSIFD.GPSLongitudeRef: b"W",
            piexif.GPSIFD.GPSLongitude: lon_dms,
        }
        exif_dict = {"0th": {}, "Exif": {}, "GPS": gps_ifd}
        exif_bytes = piexif.dump(exif_dict)

        img = Image.new("RGB", (80, 60), color=(200, 200, 200))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", exif=exif_bytes)
        jpeg_path = tmp_path / "gps_no_date.jpg"
        jpeg_path.write_bytes(buf.getvalue())

        result = extract_exif(jpeg_path)

        assert result.date_taken is None
        assert result.date_original_str is None
        assert result.gps_lat is not None
        assert result.gps_lon is not None


# ---------------------------------------------------------------------------
# Test 10: PNG support (no EXIF — Pillow PNG rarely embeds EXIF tags)
# ---------------------------------------------------------------------------


class TestPngSupport:
    def test_png_no_exif_returns_correct_dimensions(self, tmp_path: Path) -> None:
        png_path = tmp_path / "image.png"
        img = Image.new("RGB", (300, 200), color=(255, 128, 0))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png_path.write_bytes(buf.getvalue())

        result = extract_exif(png_path)

        assert result.width == 300
        assert result.height == 200
        assert result.date_taken is None
        assert result.gps_lat is None
