# PhotoMind — Tech Stack Decisions

_Every choice documented with reasoning and tradeoffs._

---

## Frontend Runtime: Bun

**Chosen over**: Node.js, Deno

**Why**:
- Single binary — no nvm, no version juggling on VPS
- Bun's `bun:sqlite` is the fastest SQLite binding available (2–3× faster than better-sqlite3)
- `bun test` replaces Jest/Vitest runner with zero config
- Faster `bun install` vs npm/pnpm — important in CI
- Next.js 15 supports Bun as runtime (stable since Bun 1.0)

**Tradeoffs**:
- Smaller ecosystem than Node.js for edge cases
- Some Node.js-only packages may need polyfills (none expected for this project)
- Bun's SQLite is not available in non-Bun runtimes (acceptable — we own the stack)

---

## Frontend Framework: Next.js 15 (App Router)

**Chosen over**: Remix, SvelteKit, plain React + Vite

**Why**:
- App Router = Server Components by default → gallery pages with no client JS overhead
- File-based routing matches our page structure (gallery, photo detail, search, settings)
- API routes in `app/api/` = single deployment unit (no separate API server)
- TypeScript-first, excellent Biome compatibility
- Karthik has existing Next.js 15 experience (from CLAUDE.md standards)

**Tradeoffs**:
- App Router has a steeper learning curve than Pages Router
- Server Components cannot use browser APIs → requires careful 'use client' placement
- Build times slower than Vite for large apps (acceptable — CI cache mitigates)

---

## Package Manager: Bun

**Why**: Consistent with runtime choice. `bun install` is significantly faster than npm.

**Rule**: Never use `npm install` or `pnpm install`. All `package.json` scripts use `bun run`.

---

## TypeScript Lint/Format: Biome

**Chosen over**: ESLint + Prettier (two tools, config conflicts)

**Why**:
- Single tool for both linting and formatting (zero config conflicts)
- ~50× faster than ESLint (Rust-based)
- Biome's import sorting is deterministic
- `biome check --write` = format + fix in one command

**Tradeoffs**:
- Smaller plugin ecosystem vs ESLint
- Some ESLint plugins have no Biome equivalent (none needed for this project)

---

## ORM: Drizzle + drizzle-orm/bun-sqlite

**Chosen over**: Prisma, Kysely, raw SQL

**Why**:
- Drizzle is TypeScript-first, schema as code (no separate `.prisma` file)
- `drizzle-orm/bun-sqlite` uses Bun's native SQLite — fastest possible ORM on this stack
- SQL-like query builder — no magic, readable queries
- `drizzle-kit` for migrations — generates SQL files, no runtime overhead
- Karthik's preferred ORM (from CLAUDE.md standards)

**Tradeoffs**:
- Drizzle has less community tooling than Prisma
- No automatic relation loading (explicit joins required) — acceptable for our query patterns

---

## Database: SQLite (bun:sqlite)

**Chosen over**: PostgreSQL, DuckDB

**Why**:
- Single-user app on a VPS — no concurrent writes from multiple processes
- Zero server overhead — file on disk, no daemon
- `bun:sqlite` is the fastest SQLite binding (2–3× faster than better-sqlite3)
- Backup = copy a single file
- 200k rows is trivially small for SQLite

**Tradeoffs**:
- Not suitable for multi-user or high-concurrency (not our use case)
- Python daemon writes via Python's `sqlite3` module — need WAL mode to avoid lock contention

**WAL mode**: Enabled at DB initialization. Writer (Python daemon) and reader (Next.js) can operate simultaneously without blocking.

---

## UI: ShadCN + Tailwind v4

**Why ShadCN**:
- Components are source code — fully customizable, no library lock-in
- Built on Radix UI primitives (accessible by default)
- Karthik's preferred UI stack

**Why Tailwind v4**:
- Native CSS layers, no PostCSS config file needed
- Faster build times than v3
- Compatible with ShadCN (ShadCN migrated to v4 in 2025)

---

## Auth: Better Auth

**Chosen over**: NextAuth, Clerk, custom JWT

**Why**:
- Self-hosted, no external service dependency
- Email + password out of the box (no OAuth complexity for personal app)
- Session management with SQLite adapter (no Redis needed)
- Karthik's preferred auth library (from CLAUDE.md standards)

**Tradeoffs**:
- Less ecosystem than Clerk/NextAuth
- No social login (not needed — personal app, single user)

---

## Python Environment: uv + pyproject.toml

**Chosen over**: pip + requirements.txt, Poetry, Conda

**Why**:
- uv is ~100× faster than pip for installs
- `pyproject.toml` is the Python standard (PEP 517/518)
- Single `uv run` command without activating venv
- Lockfile (`uv.lock`) ensures reproducibility
- Karthik's standard Python tooling

**Rules**:
- Never `pip install` — always `uv add`
- Never activate venv manually — use `uv run`

---

## Python Lint/Format: Ruff

**Chosen over**: Black + Flake8 + isort (3 tools)

**Why**:
- Single tool replaces Black (format) + Flake8 (lint) + isort (imports)
- 10–100× faster than Black/Flake8 (Rust-based)
- Zero config for basic usage, `pyproject.toml` for project config

---

## AI Embeddings: open_clip ViT-B/32 (float16, CPU)

**Chosen over**: sentence-transformers, custom models, OpenAI embeddings API

**Why**:
- ViT-B/32 is the smallest CLIP model with good accuracy
- float16 cuts RAM usage by 50% (model: ~150MB, inference: ~300MB peak)
- CPU inference: ~2s/image on a 2-core VPS — acceptable for batch processing
- Fully offline — no API calls, no rate limits, no cost
- `open_clip` is the canonical CLIP implementation (OpenAI + LAION)

**Tradeoffs**:
- Slower than GPU (10× slower than even a cheap GPU)
- float16 has minor precision loss vs float32 (negligible for ANN search)

---

## AI Faces: InsightFace buffalo_sc (CPU)

**Chosen over**: DeepFace, dlib, FaceNet

**Why**:
- `buffalo_sc` = "small, accurate" — optimized for CPU
- InsightFace produces 512-dim embeddings suitable for HDBSCAN clustering
- Detection + embedding in a single model load (efficient)
- No GPU required (ONNX Runtime CPU backend)

**Tradeoffs**:
- buffalo_sc accuracy slightly lower than buffalo_l (the large model)
- First run downloads ~300MB model files — bundled or pre-downloaded

---

## Vector DB: ChromaDB (disk-backed)

**Chosen over**: FAISS, Qdrant, Milvus, pgvector

**Why**:
- Pure Python, no separate server process
- Disk-backed — vectors survive restarts
- Simple Python API: `collection.add()`, `collection.query()`
- ANN search fast enough at 200k vectors (< 100ms on CPU)
- Zero ops overhead

**Tradeoffs**:
- Not as fast as FAISS for very large datasets
- Single-process (not distributed) — fine for our scale
- ChromaDB v0.5+ has breaking changes vs older versions — pin version in pyproject.toml

---

## Geocoding: reverse_geocoder (offline)

**Chosen over**: Nominatim (network), Google Maps API (paid)

**Why**:
- Completely offline — no API keys, no rate limits, no cost
- ~25MB data file (GeoNames database)
- Returns city, state, country in < 1ms
- Good enough accuracy for photo naming (not navigation)

**Tradeoffs**:
- Uses GeoNames city dataset — very small towns may not resolve precisely
- Returns English names only (acceptable for file naming)

---

## Dedup: imagehash pHash

**Chosen over**: MD5/SHA256 only, SSIM, exact comparison

**Why**:
- pHash detects near-duplicates (same photo, different quality/compression)
- MD5/SHA256 miss near-dupes (different bytes, same image)
- pHash Hamming distance < 10 = near-duplicate (tunable threshold)
- Quality ranking: `width × height × file_size` — keeps the best copy

**Tradeoffs**:
- pHash can false-positive on solid-color images (mitigated by dimension check)
- 200k pHash comparisons: indexed in SQLite (TEXT column with index), fast enough

---

## Source/Output: rclone

**Why**: Already configured on VPS with OneDrive OAuth. Supports 3–5 accounts via named remotes.
Handles rate limiting, retries, and bandwidth throttling built-in.

**Never**: Use OneDrive native SDK (complex OAuth, no CLI, harder to audit).

---

## Face Clustering: HDBSCAN (scikit-learn)

**Chosen over**: DBSCAN, K-means, AgglomerativeClustering

**Why**:
- HDBSCAN handles variable-density clusters (some people appear 5 times, some 5000 times)
- No need to specify K (number of clusters) — auto-determined
- Built into scikit-learn (no extra dependency)
- Handles outliers/noise gracefully (low-confidence faces = cluster -1)

**Tradeoffs**:
- Slower than K-means for large datasets (200k face embeddings = ~30 seconds — acceptable)
- Non-deterministic across runs (acceptable — clusters are periodically refreshed)

---

## VPN: Tailscale

**Already configured**. Windows → VPS access over Tailscale mesh network.
No port exposure to public internet needed.

---

## Storage Layout

```
/home/karthik/photomind/          # VPS home dir
├── chroma_db/                    # ChromaDB data (gitignored)
├── thumbnails/                   # 400px JPEG thumbs (gitignored)
├── tmp/                          # download staging (gitignored)
└── photomind.db                  # SQLite database (gitignored)
```

OneDrive layout:
```
<output_remote>:PhotoMind/library/      # processed output
  └── 2024/12/                        # optional year/month structure
      └── 2024-12-25_*.jpg
```

---

## Configuration: config.yaml (gitignored)

```yaml
database_path: /home/karthik/photomind/photomind.db
chroma_db_path: /home/karthik/photomind/chroma_db
thumbnails_path: /home/karthik/photomind/thumbnails
tmp_path: /home/karthik/photomind/tmp

sources:
  - remote: <your_rclone_remote>
    scan_path: Pictures/
    label: Primary OneDrive
  - remote: <second_rclone_remote>
    scan_path: Pictures/
    label: Secondary OneDrive

output:
  remote: <your_rclone_remote>
  path: PhotoMind/library/

pipeline:
  batch_size: 10
  max_concurrent: 1       # CPU-only, no benefit from concurrency
  meme_threshold: 0.7
  dedup_hamming_threshold: 10

clip:
  model: ViT-B/32
  precision: float16

insightface:
  model: buffalo_sc
  det_thresh: 0.5

daemon:
  scan_interval_seconds: 3600   # 1 hour
  face_cluster_interval_seconds: 86400   # 24 hours
```
