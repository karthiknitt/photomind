"""
CLIP embedding service for PhotoMind.

Provides:
- embed_image: 512-dim float16 CLIP embedding for a photo
- insert_to_chroma: store embedding in a ChromaDB collection
- query_similar: nearest-neighbour search in ChromaDB
- zero_shot_label: classify an image against a label list
- get_chroma_collection: open or create a persistent ChromaDB collection

Model: open_clip ViT-B/32, float16, CPU-only.
Singleton pattern ensures the model is loaded at most once per process.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import TYPE_CHECKING, Any

from PIL import Image, UnidentifiedImageError

if TYPE_CHECKING:
    import chromadb

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_model: Any = None
_preprocess: Any = None
_tokenizer: Any = None
_model_lock = threading.Lock()


def _get_model() -> tuple[Any, Any, Any]:
    """Load the ViT-B/32 model once and cache it (thread-safe).

    Returns:
        Tuple of (model, preprocess, tokenizer).
    """
    global _model, _preprocess, _tokenizer  # noqa: PLW0603

    if _model is not None:
        return _model, _preprocess, _tokenizer

    with _model_lock:
        if _model is None:  # double-checked locking
            import open_clip  # imported lazily to allow mocking in tests

            logger.info("Loading open_clip ViT-B/32 model (float16, CPU)...")
            # Build into locals first — only publish _model last so the
            # fast-path guard (_model is not None) is set only after
            # _preprocess and _tokenizer are fully ready.
            local_model, _, local_preprocess = open_clip.create_model_and_transforms(
                "ViT-B-32",
                pretrained="openai",
            )
            local_model = local_model.to("cpu").half()  # float16
            local_model.eval()
            local_tokenizer = open_clip.get_tokenizer("ViT-B-32")
            _preprocess = local_preprocess
            _tokenizer = local_tokenizer
            _model = local_model  # sentinel published last
            logger.info("open_clip model loaded and cached.")

    return _model, _preprocess, _tokenizer


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _load_rgb_image(image_path: str | Path) -> Image.Image:
    """Open an image file and return an RGB PIL Image.

    Args:
        image_path: path to the image file (JPEG, PNG, etc.)

    Returns:
        RGB PIL Image (caller is responsible for closing it).

    Raises:
        FileNotFoundError: if *image_path* does not exist.
        ValueError: if the file cannot be opened as an image.
    """
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {path}")
    try:
        with Image.open(path) as img:
            img.load()
            return img.convert("RGB")
    except UnidentifiedImageError as exc:
        raise ValueError(f"Cannot open {path} as an image: {exc}") from exc


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def embed_image(image_path: str | Path) -> list[float]:
    """Generate a 512-dim float16 CLIP embedding for an image.

    Args:
        image_path: path to the image file (JPEG, PNG, etc.)

    Returns:
        list of 512 floats (float16 values).

    Raises:
        FileNotFoundError: if *image_path* does not exist.
        ValueError: if the file cannot be opened as an image.
    """
    import torch

    img_rgb = _load_rgb_image(image_path)
    model, preprocess, _ = _get_model()

    img_tensor = preprocess(img_rgb).unsqueeze(0)

    with torch.no_grad():
        image_features = model.encode_image(img_tensor)
        # L2-normalise
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)

    embedding: list[float] = image_features.squeeze().tolist()
    logger.debug("embed_image: path=%s, dim=%d", image_path, len(embedding))
    return embedding


def insert_to_chroma(
    collection: chromadb.Collection,
    photo_id: str,
    embedding: list[float],
    metadata: dict[str, Any] | None = None,
) -> None:
    """Insert or update a photo embedding in a ChromaDB collection.

    Uses upsert semantics so the pipeline is safe to retry — re-inserting the same
    photo_id overwrites the existing record rather than raising a duplicate error.

    Args:
        collection: a chromadb Collection object.
        photo_id: unique identifier used as the ChromaDB document ID.
        embedding: 512-dim float list from embed_image().
        metadata: optional dict of extra fields to persist alongside the vector.
    """
    kwargs: dict[str, Any] = {
        "ids": [photo_id],
        "embeddings": [embedding],
    }
    if metadata is not None:
        kwargs["metadatas"] = [metadata]

    collection.upsert(**kwargs)
    logger.debug("insert_to_chroma: id=%s", photo_id)


def query_similar(
    collection: chromadb.Collection,
    embedding: list[float],
    n_results: int = 10,
) -> list[dict[str, Any]]:
    """Query ChromaDB for the most similar images by embedding.

    If the collection has fewer items than *n_results*, returns all available
    items rather than raising an error (safe for empty or small collections).

    Args:
        collection: a chromadb Collection object.
        embedding: query vector (512-dim float list).
        n_results: how many nearest neighbours to return (default 10).

    Returns:
        list of dicts, each with keys ``id``, ``distance``, ``metadata``.
        Returns an empty list if the collection is empty.
    """
    count = collection.count()
    if count == 0:
        return []

    actual_n = min(n_results, count)
    raw = collection.query(
        query_embeddings=[embedding],
        n_results=actual_n,
        include=["distances", "metadatas"],
    )

    ids = raw["ids"][0]
    distances = raw["distances"][0]
    metadatas = raw["metadatas"][0]

    results: list[dict[str, Any]] = [
        {"id": id_, "distance": dist, "metadata": meta}
        for id_, dist, meta in zip(ids, distances, metadatas, strict=True)
    ]
    logger.debug("query_similar: n_results=%d, returned=%d", n_results, len(results))
    return results


def zero_shot_label(
    image_path: str | Path,
    labels: list[str],
    top_n: int = 3,
) -> list[tuple[str, float]]:
    """Run CLIP zero-shot classification on an image.

    Args:
        image_path: path to the image file.
        labels: non-empty list of candidate text labels.
        top_n: how many top predictions to return (default 3).
            If top_n > len(labels), all labels are returned.

    Returns:
        list of ``(label, confidence)`` tuples sorted by confidence descending.

    Raises:
        FileNotFoundError: if *image_path* does not exist.
        ValueError: if the file cannot be opened as an image, or if *labels* is empty.
    """
    if not labels:
        raise ValueError("labels must be a non-empty list")

    import torch

    img_rgb = _load_rgb_image(image_path)
    model, preprocess, tokenizer = _get_model()

    img_tensor = preprocess(img_rgb).unsqueeze(0)
    text_tokens = tokenizer(labels)

    with torch.no_grad():
        # Cosine similarities as logits -> softmax probabilities
        logits_per_image, _ = model(img_tensor, text_tokens)
        probs = logits_per_image.softmax(dim=-1)[0].tolist()

    scored = sorted(zip(labels, probs, strict=True), key=lambda x: x[1], reverse=True)
    top = [(label, float(conf)) for label, conf in scored[:top_n]]
    logger.info(
        "zero_shot_label: path=%s, top_label=%s (%.3f)",
        image_path,
        top[0][0] if top else "n/a",
        top[0][1] if top else 0.0,
    )
    return top


def get_chroma_collection(
    db_path: str | Path,
    collection_name: str = "photos",
) -> chromadb.Collection:
    """Create or get a persistent ChromaDB collection.

    Args:
        db_path: directory where ChromaDB stores its data on disk.
        collection_name: name of the collection (default ``"photos"``).

    Returns:
        A chromadb Collection object (created if it did not exist).
    """
    import chromadb

    client = chromadb.PersistentClient(path=str(db_path))
    collection = client.get_or_create_collection(collection_name)
    logger.info(
        "get_chroma_collection: db_path=%s, collection=%s",
        db_path,
        collection_name,
    )
    return collection
