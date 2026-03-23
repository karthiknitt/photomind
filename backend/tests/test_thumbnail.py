"""
Tests for thumbnail generation service.

Uses tmp_path fixture and programmatically created Pillow images.
No external fixtures required.
"""

from pathlib import Path

import pytest
from PIL import Image

from photomind.services.thumbnail import generate_thumbnail, thumbnail_path

PHOTO_ID = "abc123-uuid-test"


def make_image(width: int, height: int, mode: str = "RGB") -> Image.Image:
    """Create a solid-color test image."""
    return Image.new(mode, (width, height), color=(100, 150, 200))


def save_image(img: Image.Image, path: Path) -> Path:
    """Save image to path, converting to RGB first if necessary for JPEG."""
    if img.mode in ("RGBA", "P"):
        img.save(str(path), "PNG")  # save RGBA/P as PNG for the source
    else:
        img.save(str(path), "JPEG")
    return path


# ---------------------------------------------------------------------------
# 1. Landscape: 800x400 → thumbnail longest side = 400 → result 400x200
# ---------------------------------------------------------------------------
def test_landscape_thumbnail_dimensions(tmp_path):
    src = save_image(make_image(800, 400), tmp_path / "landscape.jpg")
    result = generate_thumbnail(src, tmp_path / "thumbs", PHOTO_ID)
    with Image.open(result) as thumb:
        assert thumb.width == 400
        assert thumb.height == 200


# ---------------------------------------------------------------------------
# 2. Portrait: 400x800 → thumbnail longest side = 400 → result 200x400
# ---------------------------------------------------------------------------
def test_portrait_thumbnail_dimensions(tmp_path):
    src = save_image(make_image(400, 800), tmp_path / "portrait.jpg")
    result = generate_thumbnail(src, tmp_path / "thumbs", PHOTO_ID)
    with Image.open(result) as thumb:
        assert thumb.width == 200
        assert thumb.height == 400


# ---------------------------------------------------------------------------
# 3. Square: 800x800 → thumbnail 400x400
# ---------------------------------------------------------------------------
def test_square_thumbnail_dimensions(tmp_path):
    src = save_image(make_image(800, 800), tmp_path / "square.jpg")
    result = generate_thumbnail(src, tmp_path / "thumbs", PHOTO_ID)
    with Image.open(result) as thumb:
        assert thumb.width == 400
        assert thumb.height == 400


# ---------------------------------------------------------------------------
# 4. Already small (100x50): should NOT upscale — stays 100x50
# ---------------------------------------------------------------------------
def test_small_image_not_upscaled(tmp_path):
    src = save_image(make_image(100, 50), tmp_path / "small.jpg")
    result = generate_thumbnail(src, tmp_path / "thumbs", PHOTO_ID)
    with Image.open(result) as thumb:
        assert thumb.width == 100
        assert thumb.height == 50


# ---------------------------------------------------------------------------
# 5. Output path is <dest_dir>/<photo_id>.jpg
# ---------------------------------------------------------------------------
def test_thumbnail_saved_at_correct_path(tmp_path):
    src = save_image(make_image(800, 600), tmp_path / "photo.jpg")
    dest_dir = tmp_path / "thumbs"
    result = generate_thumbnail(src, dest_dir, PHOTO_ID)
    expected = dest_dir / f"{PHOTO_ID}.jpg"
    assert result == expected
    assert result.exists()


# ---------------------------------------------------------------------------
# 6. File size is reasonable (< 100 KB for a simple solid-colour image)
# ---------------------------------------------------------------------------
def test_thumbnail_file_size_reasonable(tmp_path):
    src = save_image(make_image(800, 600), tmp_path / "photo.jpg")
    result = generate_thumbnail(src, tmp_path / "thumbs", PHOTO_ID)
    size_bytes = result.stat().st_size
    assert size_bytes < 100 * 1024, f"Thumbnail too large: {size_bytes} bytes"


# ---------------------------------------------------------------------------
# 7. dest_dir created automatically when it does not exist
# ---------------------------------------------------------------------------
def test_dest_dir_created_automatically(tmp_path):
    src = save_image(make_image(400, 300), tmp_path / "photo.jpg")
    dest_dir = tmp_path / "new" / "nested" / "thumbs"
    assert not dest_dir.exists()
    generate_thumbnail(src, dest_dir, PHOTO_ID)
    assert dest_dir.exists()


# ---------------------------------------------------------------------------
# 8. RGBA image converted to RGB (JPEG does not support alpha)
# ---------------------------------------------------------------------------
def test_rgba_image_converted_to_rgb(tmp_path):
    img = make_image(800, 600, mode="RGBA")
    src = tmp_path / "rgba.png"
    img.save(str(src), "PNG")
    result = generate_thumbnail(src, tmp_path / "thumbs", PHOTO_ID)
    assert result.exists()
    with Image.open(result) as thumb:
        assert thumb.mode == "RGB"


# ---------------------------------------------------------------------------
# 9. FileNotFoundError raised when source does not exist
# ---------------------------------------------------------------------------
def test_missing_source_raises_file_not_found(tmp_path):
    with pytest.raises(FileNotFoundError):
        generate_thumbnail(
            tmp_path / "does_not_exist.jpg",
            tmp_path / "thumbs",
            PHOTO_ID,
        )


# ---------------------------------------------------------------------------
# 10. ValueError raised when source cannot be opened as an image
# ---------------------------------------------------------------------------
def test_invalid_image_raises_value_error(tmp_path):
    bad_file = tmp_path / "not_an_image.jpg"
    bad_file.write_bytes(b"this is not image data at all!!!")
    with pytest.raises(ValueError):
        generate_thumbnail(bad_file, tmp_path / "thumbs", PHOTO_ID)


# ---------------------------------------------------------------------------
# 11. thumbnail_path() returns correct path without creating files
# ---------------------------------------------------------------------------
def test_thumbnail_path_returns_correct_path(tmp_path):
    dest_dir = tmp_path / "thumbs"
    path = thumbnail_path(dest_dir, PHOTO_ID)
    assert path == dest_dir / f"{PHOTO_ID}.jpg"
    # Must NOT create the directory or file
    assert not dest_dir.exists()
    assert not path.exists()


# ---------------------------------------------------------------------------
# 12. Palette (P mode) image is also converted correctly
# ---------------------------------------------------------------------------
def test_palette_image_converted_to_rgb(tmp_path):
    img = make_image(800, 600, mode="RGB").convert("P")
    src = tmp_path / "palette.png"
    img.save(str(src), "PNG")
    result = generate_thumbnail(src, tmp_path / "thumbs", PHOTO_ID)
    assert result.exists()
    with Image.open(result) as thumb:
        assert thumb.mode == "RGB"


# ---------------------------------------------------------------------------
# 13. src_path accepted as both str and Path
# ---------------------------------------------------------------------------
def test_src_path_accepts_string(tmp_path):
    src = save_image(make_image(400, 400), tmp_path / "photo.jpg")
    result = generate_thumbnail(str(src), tmp_path / "thumbs", PHOTO_ID)
    assert result.exists()


# ---------------------------------------------------------------------------
# 14. Output is a valid JPEG (not just named .jpg)
# ---------------------------------------------------------------------------
def test_output_is_valid_jpeg(tmp_path):
    src = save_image(make_image(400, 400), tmp_path / "photo.jpg")
    result = generate_thumbnail(src, tmp_path / "thumbs", PHOTO_ID)
    with Image.open(result) as thumb:
        assert thumb.format == "JPEG"
