# PhotoMind — Technical Documentation

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         OneDrive (source)                       │
│   onedrive_karthik:/Pictures   onedrive_wife:/Pictures  ...    │
└───────────────────┬─────────────────────────────────────────────┘
                    │ rclone (read-only)
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Python Daemon (asyncio, uv)                    │
│                                                                 │
│  ┌──────────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌─────────────┐  │
│  │  rclone  │→ │ EXIF │→ │ meme │→ │dedup │→ │ thumbnail   │  │
│  │ service  │  │ svc  │  │check │  │ svc  │  │     svc     │  │
│  └──────────┘  └──────┘  └──────┘  └──────┘  └─────────────┘  │
│        ↓ (Phase 2+)                                             │
│  ┌──────────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌─────────────┐  │
│  │   CLIP   │→ │ geo  │→ │rename│→ │upload│→ │  DB finalize│  │
│  │  embed   │  │ code │  │      │  │      │  │  action_log │  │
│  └──────────┘  └──────┘  └──────┘  └──────┘  └─────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ writes
                           ▼
              ┌────────────────────────┐
              │   SQLite (WAL mode)    │◄─── Next.js / Drizzle ORM
              │   photomind.db         │     (reads + writes)
              └────────────────────────┘
                           │
              ┌────────────────────────┐
              │  ChromaDB (disk-backed)│  ← CLIP vectors (Phase 2+)
              └────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│               Next.js 15 Frontend (Bun runtime)                  │
│   App Router · Drizzle ORM · ShadCN · Tailwind v4 · Better Auth │
└─────────────────────────────────────────────────────────────────┘
                           │
              ┌────────────────────────┐
              │  OneDrive (library)    │
              │  PhotoMind/library/    │
              └────────────────────────┘
```

**Critical detail — shared SQLite dual-writer:**
- Next.js opens SQLite with `foreign_keys=ON` via Drizzle ORM (`drizzle-orm/bun-sqlite`)
- Python daemon opens SQLite with `foreign_keys=OFF` and WAL mode via `sqlite3`
- Both use WAL mode for concurrent access safety
- `action_log` table is bootstrapped by `action_log.py` using `CREATE TABLE IF NOT EXISTS` — it can run before Drizzle migrations have executed

---

## Data Models / Schema

### photos
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| source_remote | TEXT | rclone remote name |
| source_path | TEXT | original path on remote |
| library_path | TEXT | final path in PhotoMind library |
| filename_final | TEXT | renamed filename |
| date_taken | INTEGER | Unix timestamp UTC |
| date_original_str | TEXT | raw EXIF date string |
| gps_lat | REAL | nullable |
| gps_lon | REAL | nullable |
| city | TEXT | nullable, from reverse geocoding |
| state | TEXT | nullable |
| country | TEXT | nullable |
| camera_make | TEXT | nullable |
| camera_model | TEXT | nullable |
| software | TEXT | EXIF software field (used for WhatsApp detection) |
| width | INTEGER | pixels |
| height | INTEGER | pixels |
| file_size | INTEGER | bytes |
| phash | TEXT | 64-bit perceptual hash hex string |
| is_meme | INTEGER | 0 or 1 |
| meme_reason | TEXT | CSV of signal names |
| clip_indexed | INTEGER | 0 or 1 |
| face_count | INTEGER | |
| status | TEXT | QUEUED / PROCESSING / DONE / ERROR |
| created_at | INTEGER | Unix timestamp |
| updated_at | INTEGER | Unix timestamp |

### faces
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| photo_id | TEXT FK | → photos.id |
| cluster_id | TEXT | → face_clusters.id, nullable |
| embedding_id | TEXT | ChromaDB document ID |
| bbox_x, bbox_y, bbox_w, bbox_h | INTEGER | bounding box |
| det_score | REAL | InsightFace detection confidence |

### face_clusters
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| label | TEXT | human-given name, nullable |
| photo_count | INTEGER | |
| created_at | INTEGER | |

### photo_tags
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| photo_id | TEXT FK | → photos.id |
| tag | TEXT | CLIP-derived or manual |
| source | TEXT | `clip` or `manual` |
| confidence | REAL | nullable |

### events
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | |
| date_start | INTEGER | Unix timestamp |
| date_end | INTEGER | Unix timestamp |
| cover_photo_id | TEXT FK | → photos.id |

### action_log
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| photo_id | TEXT FK | nullable (log may precede photo row) |
| action | TEXT | COPIED / SKIPPED_DUPLICATE / SKIPPED_MEME / SKIPPED_ERROR / INDEXED / FACE_DETECTED |
| detail | TEXT | JSON or free-form string |
| timestamp | INTEGER | Unix timestamp |

### sources
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| remote_name | TEXT | rclone remote identifier |
| display_name | TEXT | human label |
| scan_path | TEXT | root path on remote to scan |
| last_scanned_at | INTEGER | nullable |
| enabled | INTEGER | 0 or 1 |

---

## API Reference

No API routes implemented yet (Phase 3). The Drizzle schema and bun:sqlite client are in place at `frontend/src/lib/db/`.

---

## Key Components / Modules

### Backend Services (`backend/src/photomind/services/`)

| Module | Status | Description |
|---|---|---|
| `rclone.py` | Done | List files and download from rclone remotes. Wraps `rclone lsjson` and `rclone copy`. |
| `exif.py` | Done | Extract EXIF data (date, GPS, camera, software, dimensions) using Pillow + piexif. |
| `thumbnail.py` | Done | Generate 400px JPEG thumbnails, applying EXIF orientation correction. |
| `action_log.py` | Done | Write audit entries to SQLite `action_log` table. Bootstraps table via `CREATE TABLE IF NOT EXISTS`. |
| `dedup.py` | Done | SHA256 for exact dedup; pHash (imagehash) for near-dedup with configurable Hamming threshold (default 10). |
| `meme.py` | Done | 5-signal weighted classifier. Returns `MemeCheckResult(is_meme, reasons)`. |
| `clip.py` | Not started | open_clip ViT-B/32 float16 embeddings + ChromaDB insert (Phase 2) |
| `geo.py` | Not started | Offline reverse geocoding via `reverse_geocoder` (Phase 2) |
| `rename.py` | Not started | Smart filename generation from EXIF + geo + faces (Phase 2) |
| `face.py` | Not started | InsightFace buffalo_sc CPU detection + embedding (Phase 3) |

### Frontend (`frontend/src/`)

| Path | Description |
|---|---|
| `app/` | Next.js App Router — no pages implemented yet beyond scaffold |
| `lib/db/schema.ts` | Drizzle ORM schema — all tables defined here |
| `lib/db/client.ts` | bun:sqlite connection with WAL + foreign_keys=ON |

### Backend Worker (`backend/src/photomind/worker/`)

Not yet implemented (Phase 2+). Will contain:
- `daemon.py` — asyncio event loop, periodic scanner
- `pipeline.py` — per-photo 15-stage processing pipeline
- `scheduler.py` — face clustering scheduler (runs every 24h)

---

## Meme Detection Logic

**Signals:**

| Signal | Weight | Trigger |
|---|---|---|
| EXIF software contains "whatsapp" | HIGH | Case-insensitive substring match |
| CLIP top-3 labels: "meme", "text overlay", "screenshot" | HIGH | Any of the 3 labels present |
| Aspect ratio: 9:16, 1:1, or 16:9 | MEDIUM | Within ±2% tolerance |
| No EXIF date | MEDIUM | `has_exif_date=False` |
| File < 150 KB AND longest side > 500 px | LOW | Compressed mobile forward |

**Decision rule:** `is_meme = True` if any HIGH fires, OR ≥ 2 medium/low signals fire.

`clip_labels=None` skips the CLIP signal (Phase 1 compatible — CLIP not yet available).

---

## Deduplication Logic

- **SHA256** — exact byte-for-byte match; reads file in 64 KB chunks
- **pHash** — 64-bit perceptual hash via `imagehash.phash()`, stored as hex string
- **Hamming distance** — `imagehash.hex_to_hash(h1) - imagehash.hex_to_hash(h2)`; threshold ≤ 10 = duplicate (configurable via `pipeline.dedup_hamming_threshold`)

---

## Photo Naming Convention

```
YYYY-MM-DD_HHMMSS_[City]_[Person1-Person2]_[CameraModel]_[4chars].jpg

Examples:
  2024-12-25_143022_Ooty_Karthik-Priya_iPhone14Pro_a3f2.jpg
  2024-08-15_092000_Chennai_Ammu_unknown_b1c9.jpg
  2023-01-01_120000_Trichy_a9d1.jpg
```

Rules: collision → `_v2`, `_v3`; special chars stripped; spaces → hyphens; max 200 chars.

---

## Configuration

All runtime config lives in `config.yaml` (gitignored, created manually on VPS):

```yaml
database_path:         # SQLite file path
chroma_db_path:        # ChromaDB directory
thumbnails_path:       # Thumbnail output directory
tmp_path:              # Temp download directory

sources:               # List of OneDrive sources to scan
  - remote:            # rclone remote name
    scan_path:         # Root path on remote
    label:             # Human display label

output:
  remote:              # rclone remote for library output
  path:                # Path on that remote

pipeline:
  batch_size:          # Photos per batch (default 10)
  max_concurrent:      # Concurrent downloads (default 1)
  meme_threshold:      # (reserved)
  dedup_hamming_threshold:  # pHash distance threshold (default 10)

daemon:
  scan_interval_seconds:         # Rescan interval (default 3600)
  face_cluster_interval_seconds: # Face re-cluster interval (default 86400)
```

`load_config()` in `backend/src/photomind/config.py` returns safe defaults when `config.yaml` is absent — this allows tests to run in CI without secrets.

**Environment variables:**

| Variable | Description |
|---|---|
| `DATABASE_PATH` | Override SQLite path (used in CI: `/tmp/photomind-test.db`) |

---

## CI Pipeline

`.github/workflows/ci.yml` runs on every PR and push to `main`:

**Frontend job** (`Frontend (Bun + Biome + Vitest)`):
1. `actions/checkout@v6` (Node 24)
2. `oven-sh/setup-bun@v2`
3. `bun install --frozen-lockfile`
4. `bunx biome ci .` — lint + format check
5. `bunx tsc --noEmit` — type check
6. `bun test` — Vitest

**Backend job** (`Backend (uv + Ruff + pytest)`):
1. `actions/checkout@v6` (Node 24)
2. `astral-sh/setup-uv@v7` (with uv.lock caching)
3. `uv sync`
4. `uv run ruff check src/ tests/`
5. `uv run ruff format --check src/ tests/`
6. `uv run pytest --cov-fail-under=80`

---

## PR & CodeRabbit Workflow

Scripts in `scripts/`:

```bash
# Submit PR (body from stdin)
scripts/submit-pr.sh <branch> "<title>" [base] <<'EOF'
## What / ## Why / ## Tests / ## Results
EOF

# CodeRabbit review cycle
scripts/review-pr.sh <PR> wait          # Poll until review posted
scripts/review-pr.sh <PR> dump          # Read all inline + PR-level comments
scripts/review-pr.sh <PR> reply-inline <id> "Working on it."
scripts/review-pr.sh <PR> reply-inline <id> "Fixed in $(git rev-parse --short HEAD)."
scripts/review-pr.sh <PR> reply-pr "All comments addressed. Merging."
scripts/review-pr.sh <PR> merge         # Squash merge — branch preserved
scripts/review-pr.sh <PR> sync          # Pull latest main
```

**Note:** CodeRabbit free tier reviews one PR at a time. Submit serially; use `@coderabbitai review` comment if it skips a PR.

---

## Session Log

### 2026-03-23 — Phase 0 Bootstrap + Phase 1 Data Foundation

**What was built:**
- Phase 0: GitHub repo, docs (plan, prd, techstack, CLAUDE.md, status.md), Next.js 15 frontend scaffold (Bun, Biome, ShadCN, Drizzle, Vitest), Python backend scaffold (uv, Ruff, pytest), GitHub Actions CI
- Sprint 1.1: Drizzle schema — all 6 tables with 24 integration tests
- Sprint 1.2 (parallel): rclone service, EXIF service, thumbnail service, action log helper
- Sprint 1.3: Dedup service (SHA256 + pHash, 25 tests, 100% coverage); meme detector (5-signal classifier, 30 tests, 97% coverage)
- PR automation: `scripts/submit-pr.sh` (stdin body), `scripts/review-pr.sh` (wait/dump/reply/merge/sync)
- CLAUDE.md expanded: shared SQLite architecture, config.yaml template, single-test run commands

**Key files changed:**
- `backend/src/photomind/services/dedup.py` — pHash + SHA256 dedup with `is_file()` guard, threshold validation
- `backend/src/photomind/services/meme.py` — `check_meme(**kwargs) → MemeCheckResult`, keyword-only args
- `backend/tests/test_dedup.py` — 25 tests including directory/threshold edge cases
- `backend/tests/test_meme.py` — 30 tests using `_NORMAL` override pattern
- `scripts/review-pr.sh` — added UNKNOWN mergeable status retry; removed `--delete-branch`
- `scripts/submit-pr.sh` — stdin heredoc body pattern
- `.github/workflows/ci.yml` — bumped to Node 24 (`actions/checkout@v6`, `astral-sh/setup-uv@v7`)
- `CLAUDE.md` — shared SQLite dual-writer architecture documented

**Patterns established:**
- Python services use `keyword-only args` (`*,` prefix) to force callers to name every parameter — prevents positional mistakes in the pipeline
- `action_log.py` uses `CREATE TABLE IF NOT EXISTS` so it can bootstrap before Drizzle migrations — the dual-writer pattern requires this
- Test helper pattern: `_NORMAL` dict + `_meme(**overrides)` — lets each test override only what it needs, making intent obvious
- CodeRabbit free tier: always process one PR at a time; use `@coderabbitai review` comment to re-trigger if skipped
- Branches are preserved after PR merge (removed `--delete-branch` from `review-pr.sh`)
