"""Tests for local_scanner service."""
from __future__ import annotations

import os

import pytest

from photomind.services.local_scanner import LocalFile, list_local_files


class TestListLocalFilesEmpty:
    def test_empty_directory_returns_empty_list(self, tmp_path: pytest.TempPathFactory) -> None:
        result = list_local_files(str(tmp_path))
        assert result == []


class TestListLocalFilesBasic:
    def test_three_jpg_files_returns_three_local_files(self, tmp_path: pytest.TempPathFactory) -> None:
        files = ["IMG_001.jpg", "IMG_002.jpg", "IMG_003.jpg"]
        for name in files:
            p = tmp_path / name
            p.write_bytes(b"fake image data")

        result = list_local_files(str(tmp_path))
        assert len(result) == 3

    def test_local_file_has_correct_path(self, tmp_path: pytest.TempPathFactory) -> None:
        p = tmp_path / "photo.jpg"
        p.write_bytes(b"data")

        result = list_local_files(str(tmp_path))
        assert len(result) == 1
        assert result[0].path == str(p)

    def test_local_file_has_correct_name(self, tmp_path: pytest.TempPathFactory) -> None:
        p = tmp_path / "photo.jpg"
        p.write_bytes(b"data")

        result = list_local_files(str(tmp_path))
        assert result[0].name == "photo.jpg"

    def test_local_file_has_correct_size(self, tmp_path: pytest.TempPathFactory) -> None:
        p = tmp_path / "photo.jpg"
        content = b"hello world"
        p.write_bytes(content)

        result = list_local_files(str(tmp_path))
        assert result[0].size == len(content)

    def test_path_is_absolute(self, tmp_path: pytest.TempPathFactory) -> None:
        p = tmp_path / "photo.jpg"
        p.write_bytes(b"data")

        result = list_local_files(str(tmp_path))
        assert os.path.isabs(result[0].path)

    def test_name_is_filename_only(self, tmp_path: pytest.TempPathFactory) -> None:
        p = tmp_path / "photo.jpg"
        p.write_bytes(b"data")

        result = list_local_files(str(tmp_path))
        assert "/" not in result[0].name
        assert result[0].name == "photo.jpg"


class TestListLocalFilesFiltering:
    def test_non_image_files_excluded(self, tmp_path: pytest.TempPathFactory) -> None:
        (tmp_path / "doc.txt").write_bytes(b"text")
        (tmp_path / "video.mp4").write_bytes(b"video")
        (tmp_path / "photo.jpg").write_bytes(b"image")

        result = list_local_files(str(tmp_path))
        assert len(result) == 1
        assert result[0].name == "photo.jpg"

    def test_all_supported_extensions_included(self, tmp_path: pytest.TempPathFactory) -> None:
        extensions = [
            ".jpg", ".jpeg", ".png", ".heic", ".heif",
            ".tiff", ".tif", ".webp", ".bmp", ".gif",
        ]
        for ext in extensions:
            (tmp_path / f"photo{ext}").write_bytes(b"data")

        result = list_local_files(str(tmp_path))
        assert len(result) == len(extensions)

    def test_mixed_case_extensions_included(self, tmp_path: pytest.TempPathFactory) -> None:
        (tmp_path / "PHOTO.JPG").write_bytes(b"data")
        (tmp_path / "image.HEIC").write_bytes(b"data")
        (tmp_path / "snap.Png").write_bytes(b"data")

        result = list_local_files(str(tmp_path))
        assert len(result) == 3

    def test_no_image_files_returns_empty(self, tmp_path: pytest.TempPathFactory) -> None:
        (tmp_path / "readme.txt").write_bytes(b"text")
        (tmp_path / "data.csv").write_bytes(b"csv")

        result = list_local_files(str(tmp_path))
        assert result == []


class TestListLocalFilesSymlinks:
    def test_symlinks_to_image_files_skipped(self, tmp_path: pytest.TempPathFactory) -> None:
        real_file = tmp_path / "real.jpg"
        real_file.write_bytes(b"real image data")

        link_file = tmp_path / "link.jpg"
        os.symlink(str(real_file), str(link_file))

        result = list_local_files(str(tmp_path))
        # Only the real file should be returned, not the symlink
        assert len(result) == 1
        assert result[0].path == str(real_file)

    def test_symlink_to_directory_skipped(self, tmp_path: pytest.TempPathFactory) -> None:
        real_dir = tmp_path / "real_dir"
        real_dir.mkdir()
        (real_dir / "photo.jpg").write_bytes(b"data")

        link_dir = tmp_path / "link_dir"
        os.symlink(str(real_dir), str(link_dir))

        result = list_local_files(str(tmp_path))
        # Files under the symlinked dir should NOT be traversed (followlinks=False)
        assert len(result) == 1
        assert result[0].path == str(real_dir / "photo.jpg")


class TestListLocalFilesNested:
    def test_files_in_subdirectories_found(self, tmp_path: pytest.TempPathFactory) -> None:
        subdir = tmp_path / "DCIM" / "Camera"
        subdir.mkdir(parents=True)
        (subdir / "photo.jpg").write_bytes(b"data")

        result = list_local_files(str(tmp_path))
        assert len(result) == 1
        assert result[0].name == "photo.jpg"

    def test_deeply_nested_files_found(self, tmp_path: pytest.TempPathFactory) -> None:
        deep = tmp_path / "a" / "b" / "c" / "d"
        deep.mkdir(parents=True)
        (deep / "deep.png").write_bytes(b"data")

        result = list_local_files(str(tmp_path))
        assert len(result) == 1
        assert result[0].path == str(deep / "deep.png")

    def test_files_at_multiple_levels_all_found(self, tmp_path: pytest.TempPathFactory) -> None:
        (tmp_path / "root.jpg").write_bytes(b"data")
        sub = tmp_path / "sub"
        sub.mkdir()
        (sub / "sub.jpg").write_bytes(b"data")
        subsub = sub / "subsub"
        subsub.mkdir()
        (subsub / "subsub.jpg").write_bytes(b"data")

        result = list_local_files(str(tmp_path))
        assert len(result) == 3


class TestLocalFileDataclass:
    def test_local_file_is_dataclass(self) -> None:
        f = LocalFile(path="/mnt/usb/photo.jpg", name="photo.jpg", size=1024)
        assert f.path == "/mnt/usb/photo.jpg"
        assert f.name == "photo.jpg"
        assert f.size == 1024

    def test_local_file_equality(self) -> None:
        f1 = LocalFile(path="/a/b.jpg", name="b.jpg", size=100)
        f2 = LocalFile(path="/a/b.jpg", name="b.jpg", size=100)
        assert f1 == f2
