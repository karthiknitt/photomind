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

from fastapi import FastAPI, HTTPException, Query

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


@app.get("/health")
async def health() -> dict[str, str]:
    """Return service health status."""
    return {"status": "ok"}
