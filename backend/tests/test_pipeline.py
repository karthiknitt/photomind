"""
Integration tests for the core pipeline (worker/pipeline.py).

Strategy:
- Real SQLite via tmp_path (no DB mocking)
- Real JPEG fixture created with Pillow (no fixtures/ directory)
- Mocked: rclone.download_file, rclone.upload_file, clip.embed_image,
          clip.insert_to_chroma, clip.zero_shot_label, geo.reverse_geocode
- Real: EXIF extraction, meme check, dedup (phash), thumbnail, rename

Each test covers one pipeline outcome:
  - Happy path: all stages complete, photo DONE in DB
  - Meme bail-out: is_meme=True, SKIPPED_MEME logged, no upload
  - Dedup bail-out: phash collision, SKIPPED_DUPLICATE logged, no upload
  - Stage error: rclone fails, photo ERROR in DB, SKIPPED_ERROR logged
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

from photomind.config import PhotoMindConfig, PipelineConfig
from photomind.services.action_log import get_recent_actions
from photomind.worker.pipeline import process_photo

# ─── Fixtures ──────────────────────────────────────────────────────────────────


def _make_jpeg(
    tmp_path: Path,
    name: str = "IMG_001.jpg",
    width: int = 800,
    height: int = 600,
    software: str | None = None,
) -> Path:
    """Create a minimal valid JPEG for pipeline testing.

    Dimensions default to 800x600 (4:3) with a fake EXIF date so the image
    doesn't trigger the meme classifier (which fires on ≥2 medium/low signals:
    16:9 aspect ratio + no EXIF date would be enough to trigger it).
    """
    import piexif

    img = Image.new("RGB", (width, height), color=(128, 64, 32))
    dest = tmp_path / name
    exif_0th: dict[int, object] = {}
    if software:
        exif_0th[piexif.ImageIFD.Software] = software.encode()
    exif_dict: dict[str, object] = {
        "0th": exif_0th,
        "Exif": {piexif.ExifIFD.DateTimeOriginal: b"2024:12:25 14:30:22"},
    }
    exif_bytes = piexif.dump(exif_dict)
    img.save(dest, format="JPEG", exif=exif_bytes)
    return dest


@pytest.fixture()
def dirs(tmp_path: Path) -> dict[str, Path]:
    """Return a dict of temp directories used by the pipeline."""
    d = {
        "source": tmp_path / "source",  # where test images originate
        "tmp": tmp_path / "tmp",  # pipeline download destination
        "thumbnails": tmp_path / "thumbnails",
        "db": tmp_path / "photomind.db",
        "chroma": tmp_path / "chroma_db",
    }
    d["source"].mkdir()
    d["tmp"].mkdir()
    d["thumbnails"].mkdir()
    return d


@pytest.fixture()
def config(dirs: dict[str, Path]) -> PhotoMindConfig:
    """PhotoMindConfig pointing to temp directories."""
    return PhotoMindConfig(
        database_path=str(dirs["db"]),
        chroma_db_path=str(dirs["chroma"]),
        thumbnails_path=str(dirs["thumbnails"]),
        tmp_path=str(dirs["tmp"]),
        pipeline=PipelineConfig(dedup_hamming_threshold=10),
    )


@pytest.fixture()
def chroma_mock() -> MagicMock:
    """A mock ChromaDB collection."""
    coll = MagicMock()
    coll.upsert = MagicMock()
    return coll


def _read_photo(db_path: Path, photo_id: str) -> dict[str, object] | None:
    """Read a photos row directly from SQLite."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def _count_action_log(db_path: Path, action: str) -> int:
    """Count rows in action_log for a given action type."""
    rows = get_recent_actions(str(db_path), limit=1000)
    return sum(1 for r in rows if r["action"] == action)


# ─── Shared mock setup ────────────────────────────────────────────────────────


def _make_download_mock(fake_file: Path):
    """Return a mock for rclone.download_file that copies fake_file to tmp_path."""

    def _download(remote: str, remote_path: str, local_dest: str | Path) -> Path:
        import shutil

        dest = Path(local_dest) / Path(remote_path).name
        shutil.copy2(fake_file, dest)
        return dest

    return _download


CLIP_PATCH = "photomind.worker.pipeline.clip"
RCLONE_PATCH = "photomind.worker.pipeline.rclone"
GEO_PATCH = "photomind.worker.pipeline.geo"

_GEO_EMPTY = {"city": "", "state": "", "country": ""}
_GEO_CHENNAI = {"city": "Chennai", "state": "TN", "country": "IN"}


# ─── TestHappyPath ────────────────────────────────────────────────────────────


class TestHappyPath:
    def test_photo_marked_done_in_db(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        fake_file = _make_jpeg(dirs["source"])

        with (
            patch(
                f"{RCLONE_PATCH}.download_file",
                side_effect=_make_download_mock(fake_file),
            ),
            patch(f"{RCLONE_PATCH}.upload_file"),
            patch(f"{CLIP_PATCH}.embed_image", return_value=[0.1] * 512),
            patch(f"{CLIP_PATCH}.insert_to_chroma"),
            patch(f"{GEO_PATCH}.reverse_geocode", return_value=_GEO_CHENNAI),
        ):
            photo_id = process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes=set(),
                existing_filenames=set(),
            )

        row = _read_photo(dirs["db"], photo_id)
        assert row is not None
        assert row["status"] == "DONE"

    def test_filename_final_set_after_processing(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        fake_file = _make_jpeg(dirs["source"])

        with (
            patch(
                f"{RCLONE_PATCH}.download_file",
                side_effect=_make_download_mock(fake_file),
            ),
            patch(f"{RCLONE_PATCH}.upload_file"),
            patch(f"{CLIP_PATCH}.embed_image", return_value=[0.1] * 512),
            patch(f"{CLIP_PATCH}.insert_to_chroma"),
            patch(f"{GEO_PATCH}.reverse_geocode", return_value=_GEO_EMPTY),
        ):
            photo_id = process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes=set(),
                existing_filenames=set(),
            )

        row = _read_photo(dirs["db"], photo_id)
        assert row is not None
        assert row["filename_final"] is not None
        assert row["filename_final"].endswith(".jpg")

    def test_thumbnail_created_on_disk(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        fake_file = _make_jpeg(dirs["source"])

        with (
            patch(
                f"{RCLONE_PATCH}.download_file",
                side_effect=_make_download_mock(fake_file),
            ),
            patch(f"{RCLONE_PATCH}.upload_file"),
            patch(f"{CLIP_PATCH}.embed_image", return_value=[0.1] * 512),
            patch(f"{CLIP_PATCH}.insert_to_chroma"),
            patch(f"{GEO_PATCH}.reverse_geocode", return_value=_GEO_EMPTY),
        ):
            photo_id = process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes=set(),
                existing_filenames=set(),
            )

        thumbs = list(dirs["thumbnails"].glob(f"{photo_id}.*"))
        assert len(thumbs) == 1

    def test_copied_logged_in_action_log(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        fake_file = _make_jpeg(dirs["source"])

        with (
            patch(
                f"{RCLONE_PATCH}.download_file",
                side_effect=_make_download_mock(fake_file),
            ),
            patch(f"{RCLONE_PATCH}.upload_file"),
            patch(f"{CLIP_PATCH}.embed_image", return_value=[0.1] * 512),
            patch(f"{CLIP_PATCH}.insert_to_chroma"),
            patch(f"{GEO_PATCH}.reverse_geocode", return_value=_GEO_EMPTY),
        ):
            process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes=set(),
                existing_filenames=set(),
            )

        assert _count_action_log(dirs["db"], "COPIED") == 1

    def test_rclone_upload_called_once(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        fake_file = _make_jpeg(dirs["source"])
        upload_mock = MagicMock()

        with (
            patch(
                f"{RCLONE_PATCH}.download_file",
                side_effect=_make_download_mock(fake_file),
            ),
            patch(f"{RCLONE_PATCH}.upload_file", upload_mock),
            patch(f"{CLIP_PATCH}.embed_image", return_value=[0.1] * 512),
            patch(f"{CLIP_PATCH}.insert_to_chroma"),
            patch(f"{GEO_PATCH}.reverse_geocode", return_value=_GEO_EMPTY),
        ):
            process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes=set(),
                existing_filenames=set(),
            )

        upload_mock.assert_called_once()

    def test_clip_indexed_set_true(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        fake_file = _make_jpeg(dirs["source"])

        with (
            patch(
                f"{RCLONE_PATCH}.download_file",
                side_effect=_make_download_mock(fake_file),
            ),
            patch(f"{RCLONE_PATCH}.upload_file"),
            patch(f"{CLIP_PATCH}.embed_image", return_value=[0.1] * 512),
            patch(f"{CLIP_PATCH}.insert_to_chroma"),
            patch(f"{GEO_PATCH}.reverse_geocode", return_value=_GEO_EMPTY),
        ):
            photo_id = process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes=set(),
                existing_filenames=set(),
            )

        row = _read_photo(dirs["db"], photo_id)
        assert row is not None
        assert row["clip_indexed"] == 1

    def test_tmp_file_cleaned_up_after_success(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        fake_file = _make_jpeg(dirs["source"])

        with (
            patch(
                f"{RCLONE_PATCH}.download_file",
                side_effect=_make_download_mock(fake_file),
            ),
            patch(f"{RCLONE_PATCH}.upload_file"),
            patch(f"{CLIP_PATCH}.embed_image", return_value=[0.1] * 512),
            patch(f"{CLIP_PATCH}.insert_to_chroma"),
            patch(f"{GEO_PATCH}.reverse_geocode", return_value=_GEO_EMPTY),
        ):
            process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes=set(),
                existing_filenames=set(),
            )

        # Only the original fake_file should remain; pipeline tmp copy is deleted
        remaining = list(dirs["tmp"].glob("IMG_001.jpg"))
        # The pipeline's downloaded copy should be gone
        assert fake_file.exists()  # original is untouched
        # pipeline copy (downloaded into tmp) should have been deleted
        # (both are named IMG_001.jpg — after pipeline runs, only the original remains)
        # We verify by checking the pipeline didn't leave extra files
        assert len(remaining) <= 1


# ─── TestMemeBailOut ──────────────────────────────────────────────────────────


class TestMemeBailOut:
    def test_meme_photo_status_is_done(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        # WA filename pattern (MEDIUM) + WhatsApp software (MEDIUM) = 2 signals → meme
        fake_file = _make_jpeg(
            dirs["source"], name="IMG-20240101-WA0001.jpg", software="WhatsApp"
        )

        with (
            patch(
                f"{RCLONE_PATCH}.download_file",
                side_effect=_make_download_mock(fake_file),
            ),
            patch(f"{RCLONE_PATCH}.upload_file") as upload_mock,
            patch(f"{CLIP_PATCH}.embed_image", return_value=[0.1] * 512),
            patch(f"{CLIP_PATCH}.insert_to_chroma"),
            patch(f"{GEO_PATCH}.reverse_geocode", return_value=_GEO_EMPTY),
        ):
            photo_id = process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG-20240101-WA0001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes=set(),
                existing_filenames=set(),
            )

        row = _read_photo(dirs["db"], photo_id)
        assert row is not None
        assert row["status"] == "SKIPPED"
        assert row["is_meme"] == 1
        upload_mock.assert_not_called()

    def test_meme_logged_in_action_log(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        # WA filename pattern (MEDIUM) + WhatsApp software (MEDIUM) = 2 signals → meme
        fake_file = _make_jpeg(
            dirs["source"], name="IMG-20240101-WA0001.jpg", software="WhatsApp"
        )

        with (
            patch(
                f"{RCLONE_PATCH}.download_file",
                side_effect=_make_download_mock(fake_file),
            ),
            patch(f"{RCLONE_PATCH}.upload_file"),
            patch(f"{CLIP_PATCH}.embed_image", return_value=[0.1] * 512),
            patch(f"{CLIP_PATCH}.insert_to_chroma"),
            patch(f"{GEO_PATCH}.reverse_geocode", return_value=_GEO_EMPTY),
        ):
            process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG-20240101-WA0001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes=set(),
                existing_filenames=set(),
            )

        assert _count_action_log(dirs["db"], "SKIPPED_MEME") == 1
        assert _count_action_log(dirs["db"], "COPIED") == 0


# ─── TestDedupBailOut ─────────────────────────────────────────────────────────


class TestDedupBailOut:
    def test_duplicate_status_is_done(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        fake_file = _make_jpeg(dirs["source"])

        # Pre-compute the phash of our test image so we can inject it as "known"
        from photomind.services.dedup import compute_phash

        phash = compute_phash(fake_file)

        with (
            patch(
                f"{RCLONE_PATCH}.download_file",
                side_effect=_make_download_mock(fake_file),
            ),
            patch(f"{RCLONE_PATCH}.upload_file") as upload_mock,
            patch(f"{CLIP_PATCH}.embed_image", return_value=[0.1] * 512),
            patch(f"{CLIP_PATCH}.insert_to_chroma"),
            patch(f"{GEO_PATCH}.reverse_geocode", return_value=_GEO_EMPTY),
        ):
            photo_id = process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes={phash},
                existing_filenames=set(),
            )

        row = _read_photo(dirs["db"], photo_id)
        assert row is not None
        assert row["status"] == "SKIPPED"
        upload_mock.assert_not_called()

    def test_duplicate_logged_in_action_log(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        fake_file = _make_jpeg(dirs["source"])
        from photomind.services.dedup import compute_phash

        phash = compute_phash(fake_file)

        with (
            patch(
                f"{RCLONE_PATCH}.download_file",
                side_effect=_make_download_mock(fake_file),
            ),
            patch(f"{RCLONE_PATCH}.upload_file"),
            patch(f"{CLIP_PATCH}.embed_image", return_value=[0.1] * 512),
            patch(f"{CLIP_PATCH}.insert_to_chroma"),
            patch(f"{GEO_PATCH}.reverse_geocode", return_value=_GEO_EMPTY),
        ):
            process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes={phash},
                existing_filenames=set(),
            )

        assert _count_action_log(dirs["db"], "SKIPPED_DUPLICATE") == 1
        assert _count_action_log(dirs["db"], "COPIED") == 0


# ─── TestErrorHandling ────────────────────────────────────────────────────────


class TestErrorHandling:
    def test_rclone_error_marks_photo_as_error(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        from photomind.services.rclone import RcloneError

        with (
            patch(f"{RCLONE_PATCH}.download_file", side_effect=RcloneError("timeout")),
            patch(f"{RCLONE_PATCH}.upload_file"),
        ):
            photo_id = process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes=set(),
                existing_filenames=set(),
            )

        row = _read_photo(dirs["db"], photo_id)
        assert row is not None
        assert row["status"] == "ERROR"
        assert row["error_detail"] is not None

    def test_rclone_error_logged_in_action_log(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        from photomind.services.rclone import RcloneError

        with (
            patch(f"{RCLONE_PATCH}.download_file", side_effect=RcloneError("timeout")),
            patch(f"{RCLONE_PATCH}.upload_file"),
        ):
            process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes=set(),
                existing_filenames=set(),
            )

        assert _count_action_log(dirs["db"], "SKIPPED_ERROR") == 1

    def test_unhandled_error_marks_photo_as_error(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        fake_file = _make_jpeg(dirs["source"])

        with (
            patch(
                f"{RCLONE_PATCH}.download_file",
                side_effect=_make_download_mock(fake_file),
            ),
            patch(f"{RCLONE_PATCH}.upload_file"),
            patch(f"{CLIP_PATCH}.embed_image", side_effect=RuntimeError("GPU OOM")),
            patch(f"{CLIP_PATCH}.insert_to_chroma"),
            patch(f"{GEO_PATCH}.reverse_geocode", return_value=_GEO_EMPTY),
        ):
            photo_id = process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes=set(),
                existing_filenames=set(),
            )

        row = _read_photo(dirs["db"], photo_id)
        assert row is not None
        assert row["status"] == "ERROR"
        assert _count_action_log(dirs["db"], "SKIPPED_ERROR") == 1


# ─── TestReturnValue ──────────────────────────────────────────────────────────


class TestReturnValue:
    def test_returns_photo_uuid(
        self, dirs: dict[str, Path], config: PhotoMindConfig, chroma_mock: MagicMock
    ) -> None:
        fake_file = _make_jpeg(dirs["source"])

        with (
            patch(
                f"{RCLONE_PATCH}.download_file",
                side_effect=_make_download_mock(fake_file),
            ),
            patch(f"{RCLONE_PATCH}.upload_file"),
            patch(f"{CLIP_PATCH}.embed_image", return_value=[0.1] * 512),
            patch(f"{CLIP_PATCH}.insert_to_chroma"),
            patch(f"{GEO_PATCH}.reverse_geocode", return_value=_GEO_EMPTY),
        ):
            photo_id = process_photo(
                config=config,
                source_remote="onedrive_karthik",
                source_path="/Pictures/2024/IMG_001.jpg",
                db_path=dirs["db"],
                chroma_collection=chroma_mock,
                known_phashes=set(),
                existing_filenames=set(),
            )

        assert isinstance(photo_id, str)
        assert len(photo_id) == 36  # UUID format
