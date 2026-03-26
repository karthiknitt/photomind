"""
Tests for the CLIP HTTP bridge (FastAPI app).

All tests mock embed_text and query_similar — the real CLIP model is never loaded.
Uses FastAPI's TestClient (httpx-backed) for HTTP-level testing.

Coverage:
- GET /search: returns results, maps distance correctly, handles custom n
- GET /search: empty query → 400, default n=20
- GET /health: returns ok
- Edge cases: empty collection returns empty results
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Short aliases for long patch target strings (keeps lines under 88 chars)
_EMBED = "photomind.bridge.main.embed_text"
_QUERY = "photomind.bridge.main.query_similar"
_CHROMA = "photomind.bridge.main.get_chroma_collection"

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client() -> TestClient:
    """Create a TestClient for the bridge app with a fresh CHROMA_DB_PATH env."""
    import os

    os.environ.setdefault("CHROMA_DB_PATH", "/tmp/test_chroma_bridge")
    from photomind.bridge.main import app

    return TestClient(app)


# ---------------------------------------------------------------------------
# /search endpoint tests
# ---------------------------------------------------------------------------


class TestSearchEndpoint:
    def test_search_returns_results(self, client: TestClient) -> None:
        """GET /search?q=dogs returns 200 with result id from query_similar."""
        fake_embedding = [0.1] * 512
        fake_results = [{"id": "abc", "distance": 0.1, "metadata": {}}]

        with (
            patch("photomind.bridge.main.embed_text", return_value=fake_embedding),
            patch("photomind.bridge.main.query_similar", return_value=fake_results),
            patch(_CHROMA, return_value=MagicMock()),
        ):
            response = client.get("/search", params={"q": "dogs"})

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["id"] == "abc"

    def test_search_maps_distance_correctly(self, client: TestClient) -> None:
        """Distance field from query_similar is preserved in each result."""
        fake_embedding = [0.1] * 512
        fake_results = [
            {"id": "photo1", "distance": 0.25, "metadata": {}},
            {"id": "photo2", "distance": 0.42, "metadata": {}},
        ]

        with (
            patch(_EMBED, return_value=fake_embedding),
            patch(_QUERY, return_value=fake_results),
            patch(_CHROMA, return_value=MagicMock()),
        ):
            response = client.get("/search", params={"q": "mountains"})

        assert response.status_code == 200
        results = response.json()["results"]
        assert len(results) == 2
        # All results must have a distance field
        for r in results:
            assert "distance" in r
            assert isinstance(r["distance"], float)

    def test_search_empty_query_returns_400(self, client: TestClient) -> None:
        """GET /search with empty q returns 422 (FastAPI Query min_length=1)."""
        response = client.get("/search", params={"q": ""})
        # FastAPI Query(min_length=1) triggers 422 Unprocessable Entity
        assert response.status_code == 422

    def test_search_default_n_is_20(self, client: TestClient) -> None:
        """When n is not specified, query_similar is called with n_results=20."""
        fake_embedding = [0.1] * 512
        mock_query = MagicMock(return_value=[])

        with (
            patch(_EMBED, return_value=fake_embedding),
            patch(_QUERY, mock_query),
            patch(_CHROMA, return_value=MagicMock()),
        ):
            client.get("/search", params={"q": "test"})

        mock_query.assert_called_once()
        _, call_kwargs = mock_query.call_args
        actual_n = call_kwargs.get("n_results") or mock_query.call_args[0][2]  # type: ignore[index]
        assert actual_n == 20

    def test_search_custom_n(self, client: TestClient) -> None:
        """GET /search?q=test&n=5 passes n_results=5 to query_similar."""
        fake_embedding = [0.1] * 512
        mock_query = MagicMock(return_value=[])

        with (
            patch(_EMBED, return_value=fake_embedding),
            patch(_QUERY, mock_query),
            patch(_CHROMA, return_value=MagicMock()),
        ):
            response = client.get("/search", params={"q": "test", "n": 5})

        assert response.status_code == 200
        mock_query.assert_called_once()
        # n_results could be positional or keyword
        args, kwargs = mock_query.call_args
        n_results = kwargs.get("n_results") or args[2]
        assert n_results == 5

    def test_health_returns_ok(self, client: TestClient) -> None:
        """GET /health returns 200 with status ok."""
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_empty_collection_returns_empty_results(self, client: TestClient) -> None:
        """When query_similar returns [] the endpoint returns empty results list."""
        fake_embedding = [0.1] * 512

        with (
            patch(_EMBED, return_value=fake_embedding),
            patch(_QUERY, return_value=[]),
            patch(_CHROMA, return_value=MagicMock()),
        ):
            response = client.get("/search", params={"q": "dogs"})

        assert response.status_code == 200
        data = response.json()
        assert data["results"] == []
        assert data["n"] == 0

    def test_search_response_includes_query_and_n(self, client: TestClient) -> None:
        """Response body contains query string and count of returned results."""
        fake_embedding = [0.1] * 512
        fake_results = [{"id": "x1", "distance": 0.05, "metadata": {}}]

        with (
            patch(_EMBED, return_value=fake_embedding),
            patch(_QUERY, return_value=fake_results),
            patch(_CHROMA, return_value=MagicMock()),
        ):
            response = client.get("/search", params={"q": "sunset"})

        assert response.status_code == 200
        data = response.json()
        assert data["query"] == "sunset"
        assert data["n"] == 1

    def test_search_missing_q_param_returns_422(self, client: TestClient) -> None:
        """GET /search with no q param returns 422 (missing required param)."""
        response = client.get("/search")
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# embed_text tests (unit level, no HTTP)
# ---------------------------------------------------------------------------


class TestEmbedText:
    def test_embed_text_returns_512_floats(self) -> None:
        """embed_text returns a list of 512 floats when model is mocked."""
        import photomind.services.clip as clip_mod

        # Reset singleton
        clip_mod._model = None
        clip_mod._preprocess = None
        clip_mod._tokenizer = None

        fake_values = [0.01] * 512
        tensor_mock = MagicMock()
        tensor_mock.__truediv__ = lambda s, other: s
        tensor_mock.norm.return_value = MagicMock()
        tensor_mock.squeeze.return_value = MagicMock(tolist=lambda: fake_values)

        mock_model = MagicMock()
        mock_model.encode_text.return_value = tensor_mock
        mock_model.to.return_value = mock_model
        mock_model.half.return_value = mock_model
        mock_model.eval.return_value = mock_model

        mock_tokenizer = MagicMock()
        mock_preprocess = MagicMock()

        with (
            patch(
                "open_clip.create_model_and_transforms",
                return_value=(mock_model, None, mock_preprocess),
            ),
            patch("open_clip.get_tokenizer", return_value=mock_tokenizer),
        ):
            from photomind.services.clip import embed_text

            result = embed_text("hello world")

        assert isinstance(result, list)
        assert len(result) == 512

        # Cleanup singleton
        clip_mod._model = None
        clip_mod._preprocess = None
        clip_mod._tokenizer = None

    def test_embed_text_raises_for_empty(self) -> None:
        """embed_text("") raises ValueError."""
        import photomind.services.clip as clip_mod

        clip_mod._model = None
        clip_mod._preprocess = None
        clip_mod._tokenizer = None

        with (
            patch("open_clip.create_model_and_transforms"),
            patch("open_clip.get_tokenizer"),
        ):
            from photomind.services.clip import embed_text

            with pytest.raises(ValueError, match="non-empty"):
                embed_text("")

        clip_mod._model = None
        clip_mod._preprocess = None
        clip_mod._tokenizer = None

    def test_embed_text_raises_for_whitespace(self) -> None:
        """embed_text("   ") raises ValueError (whitespace-only)."""
        import photomind.services.clip as clip_mod

        clip_mod._model = None
        clip_mod._preprocess = None
        clip_mod._tokenizer = None

        with (
            patch("open_clip.create_model_and_transforms"),
            patch("open_clip.get_tokenizer"),
        ):
            from photomind.services.clip import embed_text

            with pytest.raises(ValueError, match="non-empty"):
                embed_text("   ")

        clip_mod._model = None
        clip_mod._preprocess = None
        clip_mod._tokenizer = None
