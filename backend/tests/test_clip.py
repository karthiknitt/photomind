"""
Tests for the CLIP embedding service.

All tests use mocked open_clip model to avoid loading the 300MB+ weights.
ChromaDB tests use in-memory client for zero disk I/O.

Coverage:
- embed_image: returns 512-dim list[float], FileNotFoundError, ValueError
- insert_to_chroma: correct insertion, metadata preserved
- query_similar: structure (id, distance, metadata), n_results respected
- zero_shot_label: top_n sorted by confidence, FileNotFoundError
- get_chroma_collection: creates collection, idempotent
- _get_model: singleton (no double-load)
"""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, call, patch

import chromadb
import numpy as np
import pytest
from PIL import Image

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

FAKE_EMBEDDING_DIM = 512


def _make_mock_model() -> tuple[MagicMock, MagicMock, MagicMock]:
    """Return (model, preprocess, tokenizer) mocks."""
    mock_model = MagicMock()
    mock_preprocess = MagicMock()
    mock_tokenizer = MagicMock()

    # encode_image: return a float16 tensor-like with .tolist()
    fake_image_embed = np.zeros((1, FAKE_EMBEDDING_DIM), dtype=np.float16)
    fake_embed_tensor = MagicMock()
    fake_embed_tensor.__truediv__ = lambda self, other: fake_embed_tensor  # norm
    fake_embed_tensor.squeeze.return_value = fake_embed_tensor
    fake_embed_tensor.tolist.return_value = fake_image_embed[0].tolist()
    mock_model.encode_image.return_value = fake_embed_tensor

    # encode_text: return logit-compatible tensor
    fake_text_embed = np.random.rand(3, FAKE_EMBEDDING_DIM).astype(np.float16)
    fake_text_tensor = MagicMock()
    fake_text_tensor.__truediv__ = lambda self, other: fake_text_tensor
    fake_text_tensor.T = MagicMock()
    mock_model.encode_text.return_value = fake_text_tensor

    # preprocess: return a tensor-like with unsqueeze
    fake_img_tensor = MagicMock()
    fake_img_tensor.unsqueeze.return_value = fake_img_tensor
    mock_preprocess.return_value = fake_img_tensor

    # tokenizer: return token ids tensor
    mock_tokenizer.return_value = MagicMock()

    return mock_model, mock_preprocess, mock_tokenizer


@pytest.fixture
def sample_image(tmp_path: Path) -> Path:
    """Create a small valid PNG image for testing."""
    img = Image.new("RGB", (64, 64), color=(128, 64, 32))
    img_path = tmp_path / "sample.png"
    img.save(img_path)
    return img_path


@pytest.fixture
def not_an_image(tmp_path: Path) -> Path:
    """Create a file that is not a valid image."""
    bad_path = tmp_path / "bad.png"
    bad_path.write_bytes(b"not an image at all")
    return bad_path


@pytest.fixture
def chroma_collection() -> Any:
    """In-memory ChromaDB collection for testing."""
    client = chromadb.Client()
    return client.create_collection("test_photos")


@pytest.fixture
def mock_model_ctx():
    """Context manager that patches open_clip to return mocks."""
    mock_model, mock_preprocess, mock_tokenizer = _make_mock_model()
    with (
        patch(
            "open_clip.create_model_and_transforms",
            return_value=(mock_model, None, mock_preprocess),
        ),
        patch("open_clip.get_tokenizer", return_value=mock_tokenizer),
    ):
        # Reset singleton so each test starts fresh
        import photomind.services.clip as clip_mod
        clip_mod._model = None
        clip_mod._preprocess = None
        clip_mod._tokenizer = None
        yield mock_model, mock_preprocess, mock_tokenizer
        # Clean up singleton after test
        clip_mod._model = None
        clip_mod._preprocess = None
        clip_mod._tokenizer = None


# ---------------------------------------------------------------------------
# embed_image tests
# ---------------------------------------------------------------------------


class TestEmbedImage:
    def test_returns_list_of_512_floats(
        self, sample_image: Path, mock_model_ctx: Any
    ) -> None:
        from photomind.services.clip import embed_image

        result = embed_image(sample_image)
        assert isinstance(result, list)
        assert len(result) == FAKE_EMBEDDING_DIM

    def test_all_elements_are_float(
        self, sample_image: Path, mock_model_ctx: Any
    ) -> None:
        from photomind.services.clip import embed_image

        result = embed_image(sample_image)
        assert all(isinstance(x, float) for x in result)

    def test_accepts_string_path(
        self, sample_image: Path, mock_model_ctx: Any
    ) -> None:
        from photomind.services.clip import embed_image

        result = embed_image(str(sample_image))
        assert len(result) == FAKE_EMBEDDING_DIM

    def test_raises_file_not_found(self, mock_model_ctx: Any) -> None:
        from photomind.services.clip import embed_image

        with pytest.raises(FileNotFoundError):
            embed_image("/nonexistent/path/image.jpg")

    def test_raises_value_error_on_non_image(
        self, not_an_image: Path, mock_model_ctx: Any
    ) -> None:
        from photomind.services.clip import embed_image

        with pytest.raises(ValueError):
            embed_image(not_an_image)

    def test_model_encode_image_called(
        self, sample_image: Path, mock_model_ctx: Any
    ) -> None:
        mock_model, _, _ = mock_model_ctx
        from photomind.services.clip import embed_image

        embed_image(sample_image)
        mock_model.encode_image.assert_called_once()


# ---------------------------------------------------------------------------
# insert_to_chroma tests
# ---------------------------------------------------------------------------


class TestInsertToChroma:
    def test_inserts_embedding(self, chroma_collection: Any) -> None:
        from photomind.services.clip import insert_to_chroma

        embedding = [0.1] * FAKE_EMBEDDING_DIM
        insert_to_chroma(chroma_collection, "photo_001", embedding)
        results = chroma_collection.get(ids=["photo_001"], include=["embeddings"])
        assert results["ids"] == ["photo_001"]

    def test_metadata_preserved(self, chroma_collection: Any) -> None:
        from photomind.services.clip import insert_to_chroma

        embedding = [0.5] * FAKE_EMBEDDING_DIM
        meta = {"source_path": "/onedrive/photos/vacation.jpg", "year": 2023}
        insert_to_chroma(chroma_collection, "photo_meta", embedding, metadata=meta)
        results = chroma_collection.get(
            ids=["photo_meta"], include=["metadatas"]
        )
        assert results["metadatas"][0]["source_path"] == "/onedrive/photos/vacation.jpg"
        assert results["metadatas"][0]["year"] == 2023

    def test_metadata_none_allowed(self, chroma_collection: Any) -> None:
        from photomind.services.clip import insert_to_chroma

        embedding = [0.0] * FAKE_EMBEDDING_DIM
        # Should not raise
        insert_to_chroma(chroma_collection, "photo_no_meta", embedding, metadata=None)
        results = chroma_collection.get(ids=["photo_no_meta"])
        assert results["ids"] == ["photo_no_meta"]

    def test_multiple_inserts(self, chroma_collection: Any) -> None:
        from photomind.services.clip import insert_to_chroma

        for i in range(5):
            insert_to_chroma(
                chroma_collection,
                f"photo_{i:03d}",
                [float(i)] * FAKE_EMBEDDING_DIM,
            )
        results = chroma_collection.get(ids=[f"photo_{i:03d}" for i in range(5)])
        assert len(results["ids"]) == 5


# ---------------------------------------------------------------------------
# query_similar tests
# ---------------------------------------------------------------------------


class TestQuerySimilar:
    def _seed_collection(self, collection: Any, n: int = 10) -> None:
        from photomind.services.clip import insert_to_chroma

        for i in range(n):
            insert_to_chroma(
                collection,
                f"seed_{i:03d}",
                [float(i) / n] * FAKE_EMBEDDING_DIM,
                metadata={"index": i},
            )

    def test_returns_list_of_dicts(self, chroma_collection: Any) -> None:
        from photomind.services.clip import query_similar

        self._seed_collection(chroma_collection, 5)
        query_emb = [0.5] * FAKE_EMBEDDING_DIM
        results = query_similar(chroma_collection, query_emb, n_results=3)
        assert isinstance(results, list)
        assert all(isinstance(r, dict) for r in results)

    def test_result_has_required_keys(self, chroma_collection: Any) -> None:
        from photomind.services.clip import query_similar

        self._seed_collection(chroma_collection, 5)
        results = query_similar(chroma_collection, [0.5] * FAKE_EMBEDDING_DIM, n_results=1)
        assert len(results) >= 1
        assert "id" in results[0]
        assert "distance" in results[0]
        assert "metadata" in results[0]

    def test_respects_n_results(self, chroma_collection: Any) -> None:
        from photomind.services.clip import query_similar

        self._seed_collection(chroma_collection, 10)
        results = query_similar(chroma_collection, [0.5] * FAKE_EMBEDDING_DIM, n_results=4)
        assert len(results) == 4

    def test_default_n_results_is_10(self, chroma_collection: Any) -> None:
        from photomind.services.clip import query_similar

        self._seed_collection(chroma_collection, 15)
        results = query_similar(chroma_collection, [0.5] * FAKE_EMBEDDING_DIM)
        assert len(results) == 10

    def test_distance_is_numeric(self, chroma_collection: Any) -> None:
        from photomind.services.clip import query_similar

        self._seed_collection(chroma_collection, 5)
        results = query_similar(chroma_collection, [0.5] * FAKE_EMBEDDING_DIM, n_results=3)
        for r in results:
            assert isinstance(r["distance"], (int, float))


# ---------------------------------------------------------------------------
# zero_shot_label tests
# ---------------------------------------------------------------------------


class TestZeroShotLabel:
    def _make_softmax_mock(self, labels: list[str], top_n: int) -> Any:
        """Return a mock_model whose encode_text/encode_image produce meaningful logits."""
        mock_model = MagicMock()
        mock_preprocess = MagicMock()
        mock_tokenizer = MagicMock()

        # Build random logits that will produce distinct confidences
        n_labels = len(labels)
        raw_logits = np.arange(n_labels, dtype=np.float32)  # 0,1,2,...,n-1
        # Softmax manually: higher index → higher confidence
        exp = np.exp(raw_logits - raw_logits.max())
        softmax_vals = exp / exp.sum()

        # Mock image tensor pipeline
        fake_img_tensor = MagicMock()
        fake_img_tensor.unsqueeze.return_value = fake_img_tensor
        mock_preprocess.return_value = fake_img_tensor

        fake_image_features = MagicMock()
        fake_image_features.__truediv__ = lambda s, o: fake_image_features
        mock_model.encode_image.return_value = fake_image_features

        fake_text_features = MagicMock()
        fake_text_features.__truediv__ = lambda s, o: fake_text_features
        mock_model.encode_text.return_value = fake_text_features

        # logits_per_image: shape (1, n_labels)
        logit_vals = MagicMock()
        logit_vals.softmax.return_value = MagicMock()
        logit_vals.softmax.return_value.__getitem__ = lambda s, i: MagicMock(
            tolist=lambda: softmax_vals.tolist()
        )
        # model returns (logits_per_image, logits_per_text) when called
        mock_model.return_value = (logit_vals, MagicMock())

        return mock_model, mock_preprocess, mock_tokenizer, softmax_vals

    def test_returns_top_n_tuples(
        self, sample_image: Path, mock_model_ctx: Any
    ) -> None:
        from photomind.services.clip import zero_shot_label

        labels = ["cat", "dog", "bird", "fish", "sunset"]
        result = zero_shot_label(sample_image, labels, top_n=3)
        assert isinstance(result, list)
        assert len(result) == 3
        for item in result:
            assert isinstance(item, tuple)
            assert len(item) == 2

    def test_labels_are_strings(
        self, sample_image: Path, mock_model_ctx: Any
    ) -> None:
        from photomind.services.clip import zero_shot_label

        labels = ["cat", "dog", "bird"]
        result = zero_shot_label(sample_image, labels, top_n=2)
        for label, conf in result:
            assert isinstance(label, str)
            assert isinstance(conf, float)

    def test_sorted_by_confidence_descending(
        self, sample_image: Path, mock_model_ctx: Any
    ) -> None:
        from photomind.services.clip import zero_shot_label

        labels = ["cat", "dog", "bird", "fish"]
        result = zero_shot_label(sample_image, labels, top_n=3)
        confidences = [conf for _, conf in result]
        assert confidences == sorted(confidences, reverse=True)

    def test_raises_file_not_found(self, mock_model_ctx: Any) -> None:
        from photomind.services.clip import zero_shot_label

        with pytest.raises(FileNotFoundError):
            zero_shot_label("/nonexistent/image.jpg", ["cat", "dog"])

    def test_accepts_string_path(
        self, sample_image: Path, mock_model_ctx: Any
    ) -> None:
        from photomind.services.clip import zero_shot_label

        labels = ["cat", "dog"]
        result = zero_shot_label(str(sample_image), labels, top_n=1)
        assert len(result) == 1

    def test_top_n_defaults_to_3(
        self, sample_image: Path, mock_model_ctx: Any
    ) -> None:
        from photomind.services.clip import zero_shot_label

        labels = ["cat", "dog", "bird", "fish", "sunset"]
        result = zero_shot_label(sample_image, labels)
        assert len(result) == 3


# ---------------------------------------------------------------------------
# get_chroma_collection tests
# ---------------------------------------------------------------------------


class TestGetChromaCollection:
    def test_creates_collection(self, tmp_path: Path) -> None:
        from photomind.services.clip import get_chroma_collection

        collection = get_chroma_collection(tmp_path / "chroma_test", "photos")
        assert collection is not None
        assert collection.name == "photos"

    def test_idempotent_same_collection(self, tmp_path: Path) -> None:
        from photomind.services.clip import get_chroma_collection

        db_path = tmp_path / "chroma_idempotent"
        col1 = get_chroma_collection(db_path, "photos")
        col2 = get_chroma_collection(db_path, "photos")
        # Both should be valid collections with the same name
        assert col1.name == col2.name == "photos"

    def test_different_collection_names(self, tmp_path: Path) -> None:
        from photomind.services.clip import get_chroma_collection

        db_path = tmp_path / "chroma_multi"
        col_a = get_chroma_collection(db_path, "alpha")
        col_b = get_chroma_collection(db_path, "beta")
        assert col_a.name == "alpha"
        assert col_b.name == "beta"

    def test_accepts_string_path(self, tmp_path: Path) -> None:
        from photomind.services.clip import get_chroma_collection

        collection = get_chroma_collection(str(tmp_path / "chroma_str"), "photos")
        assert collection is not None


# ---------------------------------------------------------------------------
# Singleton (_get_model) tests
# ---------------------------------------------------------------------------


class TestModelSingleton:
    def test_get_model_called_once_on_double_call(self) -> None:
        """_get_model() must not reload the model on second call."""
        mock_model, mock_preprocess, mock_tokenizer = _make_mock_model()

        import photomind.services.clip as clip_mod

        clip_mod._model = None
        clip_mod._preprocess = None
        clip_mod._tokenizer = None

        with (
            patch(
                "open_clip.create_model_and_transforms",
                return_value=(mock_model, None, mock_preprocess),
            ) as mock_create,
            patch("open_clip.get_tokenizer", return_value=mock_tokenizer),
        ):
            clip_mod._get_model()
            clip_mod._get_model()
            # create_model_and_transforms must be called exactly once
            assert mock_create.call_count == 1

        # Cleanup
        clip_mod._model = None
        clip_mod._preprocess = None
        clip_mod._tokenizer = None

    def test_get_model_returns_same_objects(self) -> None:
        """Second call must return the identical cached objects."""
        mock_model, mock_preprocess, mock_tokenizer = _make_mock_model()

        import photomind.services.clip as clip_mod

        clip_mod._model = None
        clip_mod._preprocess = None
        clip_mod._tokenizer = None

        with (
            patch(
                "open_clip.create_model_and_transforms",
                return_value=(mock_model, None, mock_preprocess),
            ),
            patch("open_clip.get_tokenizer", return_value=mock_tokenizer),
        ):
            first = clip_mod._get_model()
            second = clip_mod._get_model()
            assert first[0] is second[0]  # same model object
            assert first[1] is second[1]  # same preprocess object
            assert first[2] is second[2]  # same tokenizer object

        # Cleanup
        clip_mod._model = None
        clip_mod._preprocess = None
        clip_mod._tokenizer = None
