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


def _get_model() -> tuple[Any, Any, Any]:
    """Load the ViT-B/32 model once and cache it.

    Returns:
        Tuple of (model, preprocess, tokenizer).
    """
    global _model, _preprocess, _tokenizer  # noqa: PLW0603

    if _model is None:
        import open_clip  # imported lazily to allow mocking in tests

        logger.info("Loading open_clip ViT-B/32 model (float16, CPU)...")
        _model, _, _preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32",
            pretrained="openai",
        )
        _model = _model.to("cpu").half()  # float16
        _model.eval()
        _tokenizer = open_clip.get_tokenizer("ViT-B-32")
        logger.info("open_clip model loaded and cached.")

    return _model, _preprocess, _tokenizer


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

    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {path}")

    try:
        with Image.open(path) as img:
            img.load()
            img_rgb = img.convert("RGB")
    except UnidentifiedImageError as exc:
        raise ValueError(f"Cannot open {path} as an image: {exc}") from exc

    model, preprocess, _ = _get_model()

    img_tensor = preprocess(img_rgb).unsqueeze(0)

    with torch.no_grad():
        image_features = model.encode_image(img_tensor)
        # L2-normalise
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)

    embedding: list[float] = image_features.squeeze().tolist()
    logger.debug("embed_image: path=%s, dim=%d", path, len(embedding))
    return embedding


def insert_to_chroma(
    collection: chromadb.Collection,
    photo_id: str,
    embedding: list[float],
    metadata: dict[str, Any] | None = None,
) -> None:
    """Insert a photo embedding into a ChromaDB collection.

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

    Args:
        collection: a chromadb Collection object.
        embedding: query vector (512-dim float list).
        n_results: how many nearest neighbours to return (default 10).

    Returns:
        list of dicts, each with keys ``id``, ``distance``, ``metadata``.
    """
    raw = collection.query(
        query_embeddings=[embedding],
        n_results=n_results,
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
        labels: list of candidate text labels.
        top_n: how many top predictions to return (default 3).

    Returns:
        list of ``(label, confidence)`` tuples sorted by confidence descending.

    Raises:
        FileNotFoundError: if *image_path* does not exist.
    """
    import torch

    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {path}")

    try:
        with Image.open(path) as img:
            img.load()
            img_rgb = img.convert("RGB")
    except UnidentifiedImageError as exc:
        raise ValueError(f"Cannot open {path} as an image: {exc}") from exc

    model, preprocess, tokenizer = _get_model()

    img_tensor = preprocess(img_rgb).unsqueeze(0)
    text_tokens = tokenizer(labels)

    with torch.no_grad():
        image_features = model.encode_image(img_tensor)
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)

        text_features = model.encode_text(text_tokens)
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)

        # Cosine similarities as logits -> softmax
        logits_per_image, _ = model(img_tensor, text_tokens)
        probs = logits_per_image.softmax(dim=-1)[0].tolist()

    scored = sorted(zip(labels, probs, strict=True), key=lambda x: x[1], reverse=True)
    top = [(label, float(conf)) for label, conf in scored[:top_n]]
    logger.info(
        "zero_shot_label: path=%s, top_label=%s (%.3f)",
        path,
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
