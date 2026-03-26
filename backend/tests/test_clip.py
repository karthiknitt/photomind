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

import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import chromadb
import numpy as np
import pytest
from PIL import Image

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FAKE_EMBEDDING_DIM = 512


# ---------------------------------------------------------------------------
# Mock helpers
# ---------------------------------------------------------------------------


def _make_tensor_mock(values: list[float]) -> MagicMock:
    """Return a mock that behaves like a normalised float tensor.

    Supports: / operator, .norm(), .squeeze(), .tolist()
    """
    m = MagicMock()
    # / operator returns self so chaining works
    m.__truediv__ = lambda s, other: s
    m.__rtruediv__ = lambda s, other: s
    m.norm.return_value = MagicMock(__float__=lambda s: 1.0)
    m.squeeze.return_value = MagicMock(tolist=lambda: values)
    m.tolist.return_value = values
    # Support indexing for softmax result
    m.__getitem__ = lambda s, idx: MagicMock(tolist=lambda: values)
    return m


def _make_logits_mock(n_labels: int) -> MagicMock:
    """Return a mock logits_per_image with .softmax() returning n_labels probs."""
    raw = np.arange(n_labels, dtype=np.float32)
    exp = np.exp(raw - raw.max())
    probs = (exp / exp.sum()).tolist()

    # Build: logits.softmax(dim=-1)[0].tolist() -> probs
    inner = MagicMock()
    inner.tolist.return_value = probs
    softmax_result = MagicMock()
    softmax_result.__getitem__ = lambda s, idx: inner
    logits = MagicMock()
    logits.softmax.return_value = softmax_result
    return logits


def _make_mock_model() -> tuple[MagicMock, MagicMock, MagicMock]:
    """Return (model, preprocess, tokenizer) mocks suitable for all service calls.

    The model side_effect captures the text token count to return correctly
    sized softmax probabilities.
    """
    fake_emb = [0.0] * FAKE_EMBEDDING_DIM
    embed_tensor = _make_tensor_mock(fake_emb)

    text_tensor = MagicMock()
    text_tensor.__truediv__ = lambda s, other: s
    text_tensor.T = MagicMock()

    img_input = MagicMock()
    img_input.unsqueeze.return_value = img_input

    mock_model = MagicMock()
    mock_model.encode_image.return_value = embed_tensor
    mock_model.encode_text.return_value = text_tensor
    mock_model.to.return_value = mock_model
    mock_model.half.return_value = mock_model
    mock_model.eval.return_value = mock_model

    # Capture the tokenizer to know how many labels are being classified
    mock_tokenizer = MagicMock()

    def _model_call_side_effect(img_t: Any, text_t: Any) -> tuple[MagicMock, MagicMock]:
        # text_t is mock_tokenizer.return_value; determine n_labels from call args
        # Fall back to 3 if we can't determine
        try:
            n = len(mock_tokenizer.call_args[0][0])
        except (TypeError, IndexError):
            n = 3
        return _make_logits_mock(n), MagicMock()

    mock_model.side_effect = _model_call_side_effect

    mock_preprocess = MagicMock(return_value=img_input)

    return mock_model, mock_preprocess, mock_tokenizer


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


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
    """In-memory ChromaDB collection for testing, unique per test."""
    client = chromadb.Client()
    # Use a unique name each time to avoid inter-test state
    name = f"test_{uuid.uuid4().hex}"
    return client.get_or_create_collection(name)


@pytest.fixture
def mock_model_ctx():
    """Patch open_clip and reset the module singleton before/after each test."""
    mock_model, mock_preprocess, mock_tokenizer = _make_mock_model()

    import photomind.services.clip as clip_mod

    # Reset singleton before patching
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
        yield mock_model, mock_preprocess, mock_tokenizer

    # Reset singleton after test
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
        assert all(isinstance(x, (int, float)) for x in result)

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
        results = chroma_collection.get(ids=["photo_001"])
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
        insert_to_chroma(chroma_collection, "photo_no_meta", embedding, metadata=None)
        results = chroma_collection.get(ids=["photo_no_meta"])
        assert results["ids"] == ["photo_no_meta"]

    def test_multiple_inserts(self, chroma_collection: Any) -> None:
        from photomind.services.clip import insert_to_chroma

        for i in range(5):
            insert_to_chroma(
                chroma_collection,
                f"photo_{i:03d}",
                [float(i) / 10.0] * FAKE_EMBEDDING_DIM,
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
                [float(i) / max(n, 1)] * FAKE_EMBEDDING_DIM,
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

        emb = [0.5] * FAKE_EMBEDDING_DIM
        self._seed_collection(chroma_collection, 5)
        results = query_similar(chroma_collection, emb, n_results=1)
        assert len(results) >= 1
        assert "id" in results[0]
        assert "distance" in results[0]
        assert "metadata" in results[0]

    def test_respects_n_results(self, chroma_collection: Any) -> None:
        from photomind.services.clip import query_similar

        emb = [0.5] * FAKE_EMBEDDING_DIM
        self._seed_collection(chroma_collection, 10)
        results = query_similar(chroma_collection, emb, n_results=4)
        assert len(results) == 4

    def test_default_n_results_is_10(self, chroma_collection: Any) -> None:
        from photomind.services.clip import query_similar

        emb = [0.5] * FAKE_EMBEDDING_DIM
        self._seed_collection(chroma_collection, 15)
        results = query_similar(chroma_collection, emb)
        assert len(results) == 10

    def test_distance_is_numeric(self, chroma_collection: Any) -> None:
        from photomind.services.clip import query_similar

        emb = [0.5] * FAKE_EMBEDDING_DIM
        self._seed_collection(chroma_collection, 5)
        results = query_similar(chroma_collection, emb, n_results=3)
        for r in results:
            assert isinstance(r["distance"], (int, float))

    def test_empty_collection_returns_empty_list(self, chroma_collection: Any) -> None:
        from photomind.services.clip import query_similar

        emb = [0.5] * FAKE_EMBEDDING_DIM
        results = query_similar(chroma_collection, emb, n_results=10)
        assert results == []

    def test_n_results_larger_than_collection_returns_all(
        self, chroma_collection: Any
    ) -> None:
        from photomind.services.clip import query_similar

        emb = [0.5] * FAKE_EMBEDDING_DIM
        self._seed_collection(chroma_collection, 3)
        results = query_similar(chroma_collection, emb, n_results=100)
        assert len(results) == 3


# ---------------------------------------------------------------------------
# zero_shot_label tests
# ---------------------------------------------------------------------------


class TestZeroShotLabel:
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

    def test_labels_are_strings_and_floats(
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

    def test_raises_value_error_on_empty_labels(
        self, sample_image: Path, mock_model_ctx: Any
    ) -> None:
        from photomind.services.clip import zero_shot_label

        with pytest.raises(ValueError, match="non-empty"):
            zero_shot_label(sample_image, [])

    def test_top_n_larger_than_labels_returns_all(
        self, sample_image: Path, mock_model_ctx: Any
    ) -> None:
        from photomind.services.clip import zero_shot_label

        labels = ["cat", "dog"]
        result = zero_shot_label(sample_image, labels, top_n=10)
        assert len(result) == 2  # can't return more than len(labels)


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
    def test_concurrent_load_calls_create_exactly_once(self) -> None:
        """Concurrent _get_model() calls must load the model exactly once."""
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
            with ThreadPoolExecutor(max_workers=8) as pool:
                futures = [pool.submit(clip_mod._get_model) for _ in range(8)]
                results = [f.result() for f in futures]

            assert mock_create.call_count == 1
            # All threads must receive the same objects
            first = results[0]
            for result in results[1:]:
                assert result[0] is first[0]
                assert result[1] is first[1]
                assert result[2] is first[2]

        clip_mod._model = None
        clip_mod._preprocess = None
        clip_mod._tokenizer = None

    def test_concurrent_load_never_returns_partial_triple(self) -> None:
        """No thread should ever receive (model, None, None) mid-initialization."""
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
            with ThreadPoolExecutor(max_workers=8) as pool:
                futures = [pool.submit(clip_mod._get_model) for _ in range(8)]
                results = [f.result() for f in futures]

            for model, preprocess, tokenizer in results:
                assert model is not None, "model must never be None"
                assert preprocess is not None, "preprocess must never be None"
                assert tokenizer is not None, "tokenizer must never be None"

        clip_mod._model = None
        clip_mod._preprocess = None
        clip_mod._tokenizer = None
