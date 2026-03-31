"""
CLIP text-search HTTP bridge for PhotoMind.

Exposes a single endpoint that accepts a text query, encodes it with CLIP,
queries ChromaDB, and returns matching photo IDs with similarity scores.

Run:
    uvicorn photomind.bridge.main:app --host 127.0.0.1 --port 8765
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

from photomind.services.clip import embed_text, get_chroma_collection, query_similar

logger = logging.getLogger(__name__)

app = FastAPI(title="PhotoMind CLIP Bridge")

CHROMA_DB_PATH = os.environ.get(
    "CHROMA_DB_PATH",
    str(Path.home() / "photomind" / "chroma_db"),
)


@app.get("/search")
async def search(
    q: str = Query(..., min_length=1, description="Text query"),
    n: int = Query(default=20, ge=1, le=100, description="Number of results"),
) -> dict[str, Any]:
    """Search photos by semantic similarity to the text query."""
    try:
        embedding = embed_text(q)
        collection = get_chroma_collection(CHROMA_DB_PATH, "photos")
        results = query_similar(collection, embedding, n_results=n)
        return {
            "results": [{"id": r["id"], "distance": r["distance"]} for r in results],
            "query": q,
            "n": len(results),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class CentroidSimilarRequest(BaseModel):
    embedding_ids: list[str]
    exclude_ids: list[str] = []
    n_results: int = 200


@app.post("/faces/centroid-similar")
async def centroid_similar(body: CentroidSimilarRequest) -> dict[str, Any]:
    """Find faces similar to the centroid of the given embedding IDs.

    1. Fetch embeddings from ChromaDB "faces" collection.
    2. L2-normalise each, compute mean, L2-normalise centroid.
    3. Query ChromaDB with the centroid vector.
    4. Filter out exclude_ids and return (id, distance) pairs.
    """
    if not body.embedding_ids:
        raise HTTPException(status_code=400, detail="embedding_ids must not be empty")

    try:
        collection = get_chroma_collection(CHROMA_DB_PATH, "faces")
        fetch = collection.get(ids=body.embedding_ids, include=["embeddings"])
        raw = fetch.get("embeddings")

        if not raw:
            raise HTTPException(
                status_code=400,
                detail="No embeddings found for the given embedding_ids",
            )

        # Stack → L2-normalise each row → mean → L2-normalise centroid
        X = np.array(raw, dtype=np.float32)
        norms = np.linalg.norm(X, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1.0, norms)
        X = X / norms
        centroid = X.mean(axis=0)
        c_norm = np.linalg.norm(centroid)
        if c_norm > 0:
            centroid = centroid / c_norm

        result = collection.query(
            query_embeddings=[centroid.tolist()],
            n_results=body.n_results,
            include=["distances"],
        )

        ids: list[str] = result["ids"][0]
        distances: list[float] = result["distances"][0]
        exclude_set = set(body.exclude_ids)

        results = [
            {"id": fid, "distance": dist}
            for fid, dist in zip(ids, distances)
            if fid not in exclude_set
        ]

        return {"results": results}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[POST /faces/centroid-similar] error: %s", exc)
        raise HTTPException(status_code=500, detail="Internal server error") from exc


@app.get("/health")
async def health() -> dict[str, str]:
    """Return service health status."""
    return {"status": "ok"}
