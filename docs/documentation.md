# PhotoMind — Technical Documentation

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         OneDrive (source)                       │
│       [remote1]:/Pictures    [remote2]:/Pictures   ...         │
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
│                                                                 │
│  ┌──────────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌─────────────┐  │
│  │   CLIP   │→ │ geo  │→ │rename│→ │upload│→ │  DB finalize│  │
│  │  embed   │  │ code │  │      │  │      │  │  action_log │  │
│  └──────────┘  └──────┘  └──────┘  └──────┘  └─────────────┘  │
│                                                                 │
│  ┌──────────┐  ┌──────────────────┐                            │
│  │  face    │  │ HDBSCAN cluster  │  (periodic, every 24h)     │
│  │  detect  │  │  scheduler       │                            │
│  └──────────┘  └──────────────────┘                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │ writes
                           ▼
              ┌────────────────────────┐
              │   SQLite (WAL mode)    │◄─── Next.js / Drizzle ORM
              │   photomind.db         │     (reads + writes)
              └────────────────────────┘
                           │
              ┌────────────────────────┐
              │  ChromaDB (disk-backed)│  ← CLIP vectors + face embeddings
              └────────────────────────┘
                           ▲
              ┌────────────────────────┐
              │  CLIP Bridge (FastAPI) │  ← localhost:8765
              │  GET /search  /health  │
              └────────────────────────┘
                           ▲ HTTP (internal)
┌──────────────────────────┴──────────────────────────────────────┐
│               Next.js 15 Frontend (Bun runtime)                  │
│   App Router · Drizzle ORM · ShadCN · Tailwind v4               │
│   Pages: gallery / search / faces / dashboard / logs / settings │
└─────────────────────────────────────────────────────────────────┘
                           │
              ┌────────────────────────┐
              │  OneDrive (library)    │
              │  [output_remote]/path/ │
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

All routes live under `frontend/src/app/api/`. No authentication — single-user, Tailscale-gated deployment.

### GET /api/photos
Paginated photo list.

**Query params:** `page` (default 1), `limit` (default 48), `status` (filter by pipeline status), `from` / `to` (Unix timestamp range)

**Response:**
```json
{
  "photos": [{ "id": "...", "filenameFinal": "...", "dateTaken": 1234, "city": "...", "country": "...", "faceCount": 2, "status": "DONE", ... }],
  "pagination": { "page": 1, "limit": 48, "total": 2341, "hasMore": true }
}
```

---

### GET /api/photos/[id]
Single photo detail with left-joined faces and cluster labels.

**Response:** `{ photo: {...}, faces: [{ id, clusterLabel, bboxX, bboxY, bboxW, bboxH, detScore }] }`

**Errors:** 404 if not found.

---

### GET /api/thumbnails/[id]
Serve JPEG thumbnail. Reads from `THUMBNAILS_PATH/<id>.jpg`. Path-traversal guard rejects IDs containing `/` or `..`.

**Response:** `image/jpeg` binary, or 404.

---

### GET /api/search
Hybrid text + semantic search.

**Query params:** `q` (required), `mode` (`text` | `semantic` | `hybrid`, default `hybrid`), `limit` (default 20), `page` (default 1)

**Response:** `{ results: [{ id, score, matchSource, ... }], pagination: {...} }`

Text mode: LIKE on `city`, `country`, `filenameFinal`. Semantic mode: calls CLIP bridge → ChromaDB → scores = 1 − distance. Hybrid: union + dedup, max score. Gracefully degrades to text-only if CLIP bridge unavailable.

---

### GET /api/faces/clusters
All face clusters with representative photo thumbnail.

**Response:** `{ clusters: [{ id, label, photoCount, representativePhotoId }] }`

---

### PATCH /api/faces/clusters/[id]
Update cluster label.

**Body:** `{ "label": "Karthik" }` — empty string clears label (sets to null).

**Validation:** label must be string, max 100 chars, `label` key required.

**Response:** `{ cluster: { id, label, photoCount } }` or 400/404.

---

### GET /api/faces/clusters/[id]/photos
Paginated photos in a cluster.

**Query params:** `page`, `limit` (default 24)

**Response:** `{ photos: [...], pagination: {...} }`

---

### GET /api/dashboard
Aggregated pipeline stats + recent activity.

**Response:**
```json
{
  "stats": { "total": 12345, "done": 11200, "queued": 800, "error": 45, "meme": 300, "duplicate": 200, "faceCount": 8900, "clusterCount": 42 },
  "recentActivity": [{ "id": "...", "action": "INDEXED", "detail": "...", "timestamp": 1234 }]
}
```

---

### GET /api/logs
Paginated action log.

**Query params:** `page`, `limit` (default 50), `action` (filter by action type)

**Response:** `{ logs: [{ id, photoId, action, detail, timestamp }], pagination: {...} }`

Valid action values: `COPIED`, `SKIPPED_DUPLICATE`, `SKIPPED_MEME`, `SKIPPED_ERROR`, `INDEXED`, `FACE_DETECTED`, `CLUSTER_UPDATED`

---

### GET /api/settings
System configuration display.

**Response:** `{ system: { databasePath, thumbnailsPath, clipBridgeUrl }, sources: [{ id, remoteName, displayName, scanPath, lastScannedAt, enabled }] }`

---

### GET /api/settings/health
CLIP bridge liveness check with latency.

**Response:** `{ status: "ok" | "error", latencyMs: 42 }` (3s timeout, no auth)

---

## Key Components / Modules

### Backend Services (`backend/src/photomind/services/`)

| Module | Description |
|---|---|
| `rclone.py` | List files and download from rclone remotes. `list_files(recursive=True)` wraps `rclone lsjson`. |
| `exif.py` | Extract EXIF data (date, GPS, camera, software, dimensions) using Pillow + piexif. |
| `thumbnail.py` | Generate 400px JPEG thumbnails, applying EXIF orientation correction. |
| `action_log.py` | Write audit entries to SQLite `action_log` table. Bootstraps table via `CREATE TABLE IF NOT EXISTS`. |
| `dedup.py` | SHA256 for exact dedup; pHash (imagehash) for near-dedup with configurable Hamming threshold (default 10). |
| `meme.py` | 5-signal weighted classifier. Returns `MemeCheckResult(is_meme, reasons)`. WhatsApp filename pattern detection. |
| `clip.py` | open_clip ViT-B/32 float16 embeddings. `embed_image()` → ChromaDB "photos" collection. `embed_text()` → used by search bridge. |
| `geo.py` | Offline reverse geocoding via `reverse_geocoder`. `reverse_geocode(lat, lon) → GeoResult(city, state, country)`. |
| `rename.py` | Smart filename from EXIF + geo + persons + camera. SHA256 4-char suffix, `_v2`/`_v3` collision handling. |
| `face.py` | InsightFace buffalo_sc CPU model. `detect()` → bbox + det_score. `store_faces()` → SQLite faces + ChromaDB "faces" collection. |

### Backend Worker (`backend/src/photomind/worker/`)

| Module | Description |
|---|---|
| `pipeline.py` | 15-stage per-photo orchestrator. `_BailOut` sentinel for meme/dedup early exits. Intra-batch phash accumulation. |
| `daemon.py` | `run_scan()` scans all sources, skips known paths (`get_processed_source_paths()`), calls `process_photo` per new image. `_is_image()` filters by extension. |
| `scheduler.py` | `run_forever()` periodic loop. Calls `run_scan()` every `scan_interval_seconds`. Calls `run_clustering()` every `face_cluster_interval_seconds`. Clean `KeyboardInterrupt` shutdown. |
| `cluster.py` | `run_clustering()` HDBSCAN on L2-normed face embeddings. Fresh rebuild per run (clears + re-inserts). `ClusterResult(n_faces, n_clusters, n_noise)`. |
| `__main__.py` | Entry point `python -m photomind.worker`. Flags: `--config PATH`, `--scan-once`, `--verbose`. |

### CLIP Bridge (`backend/src/photomind/bridge.py`)

FastAPI service on `localhost:8765`:
- `GET /health` — liveness check
- `GET /search?q=<query>&n=20` — embeds query text via CLIP, queries ChromaDB "photos" collection, returns `[{id, distance}]`

Started by `photomind-bridge` systemd service via uvicorn.

### Frontend Pages (`frontend/src/app/(gallery)/`)

| Page | Route | Description |
|---|---|---|
| `page.tsx` | `/` | Paginated photo grid (48/page). Click opens `PhotoDetailDialog` lightbox with full metadata + faces panel. |
| `search/page.tsx` | `/search` | 400ms debounced search, mode selector (text/semantic/hybrid), result cards with score. |
| `faces/page.tsx` | `/faces` | Cluster grid. Inline label editing (click pencil → input → save/cancel). |
| `faces/[id]/page.tsx` | `/faces/:id` | Per-cluster photo grid with back navigation. |
| `dashboard/page.tsx` | `/dashboard` | 9 stat cards, stacked pipeline health bar, activity feed. Auto-refresh every 30s. |
| `logs/page.tsx` | `/logs` | Paginated audit log (50/page), action-type filter dropdown, auto-refresh toggle (10s). |
| `settings/page.tsx` | `/settings` | System config table, CLIP bridge health dot (green/red + latency), sources table. |

### Frontend API Clients (`frontend/src/lib/db/`)

| File | Description |
|---|---|
| `schema.ts` | Drizzle ORM schema — all 6 tables (photos, faces, face_clusters, photo_tags, events, action_log, sources) |
| `client.ts` | bun:sqlite connection with WAL + foreign_keys=ON |

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

### config.yaml

All runtime config lives in `config.yaml` (gitignored — never committed, created manually on VPS). Full example with all available keys:

```yaml
database_path: /home/<user>/photomind/photomind.db
chroma_db_path: /home/<user>/photomind/chroma_db
thumbnails_path: /home/<user>/photomind/thumbnails
tmp_path: /home/<user>/photomind/tmp

sources:
  - remote: <rclone_remote_name>     # e.g. the name you gave when running `rclone config`
    scan_path: /Pictures             # root path on that remote to scan recursively
    label: Primary OneDrive          # display name shown in the Settings UI
  - remote: <another_remote>
    scan_path: /DCIM
    label: Secondary OneDrive

output:
  remote: <rclone_remote_name>       # remote to write processed photos to
  path: PhotoMind/library/           # path on that remote

pipeline:
  batch_size: 10                     # photos processed per batch
  max_concurrent: 1                  # concurrent rclone downloads
  meme_threshold: 0.7                # (reserved, not yet used)
  dedup_hamming_threshold: 10        # pHash Hamming distance ≤ N = duplicate

daemon:
  scan_interval_seconds: 3600        # rescan all sources every N seconds
  face_cluster_interval_seconds: 86400  # re-run HDBSCAN clustering every N seconds
```

`load_config()` in `backend/src/photomind/config.py` returns safe defaults when `config.yaml` is absent — allows tests to run in CI without secrets.

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_PATH` | Absolute path to SQLite file | `~/photomind/photomind.db` |
| `THUMBNAILS_PATH` | Absolute path to thumbnails directory | `~/photomind/thumbnails` |
| `CLIP_BRIDGE_URL` | URL of the CLIP FastAPI bridge | `http://localhost:8765` |
| `PORT` | Next.js HTTP port | `3003` |

For production, copy `deploy/env.production.template` to `~/photomind/.env.production` and fill in values. The systemd unit (`photomind-frontend.service`) loads this file via `EnvironmentFile=`.

---

## VPS Deploy Guide

The production instance runs on a VPS accessible via Tailscale (private network). No public IP exposed.

### Prerequisites

- VPS with Linux, Bun installed, uv installed, rclone configured
- Tailscale installed and running on both VPS and client machine
- nginx installed (`apt install nginx`)
- The repo cloned to `~/projects/PhotoMind` on the VPS

### First-Time Setup (run once)

```bash
# 1. SSH to VPS via Tailscale
ssh karthik@<tailscale-ip>

# 2. Get the machine's Tailscale hostname
tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'
# → something like machine-name.tail1234.ts.net

# 3. Issue TLS certificate (Tailscale handles renewals automatically)
sudo tailscale cert <hostname>
sudo mkdir -p /etc/ssl/photomind
sudo mv /etc/ssl/tailscale/<hostname>.crt /etc/ssl/photomind/fullchain.pem
sudo mv /etc/ssl/tailscale/<hostname>.key /etc/ssl/photomind/privkey.pem

# 4. Configure nginx
sudo cp ~/projects/PhotoMind/deploy/nginx/photomind.conf /etc/nginx/sites-available/photomind
# Edit the file: replace TAILSCALE_HOSTNAME with the actual hostname from step 2
sudo nano /etc/nginx/sites-available/photomind
sudo ln -s /etc/nginx/sites-available/photomind /etc/nginx/sites-enabled/photomind
sudo nginx -t && sudo systemctl reload nginx

# 5. Copy and enable systemd service files
sudo cp ~/projects/PhotoMind/deploy/photomind-frontend.service /etc/systemd/system/
sudo cp ~/projects/PhotoMind/deploy/photomind-daemon.service /etc/systemd/system/
sudo cp ~/projects/PhotoMind/deploy/photomind-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable photomind-frontend photomind-daemon photomind-bridge

# 6. Create runtime directories
mkdir -p ~/photomind/thumbnails ~/photomind/chroma_db ~/photomind/tmp

# 7. Create production env file
cp ~/projects/PhotoMind/deploy/env.production.template ~/photomind/.env.production
nano ~/photomind/.env.production   # fill in DATABASE_PATH, THUMBNAILS_PATH, etc.

# 8. Create config.yaml (see Configuration section above for full schema)
nano ~/projects/PhotoMind/config.yaml

# 9. Run initial deploy
cd ~/projects/PhotoMind
scripts/deploy.sh

# 10. Verify
scripts/smoke-test.sh https://<hostname>
```

### Every Subsequent Deploy

```bash
# From the VPS or triggered remotely:
cd ~/projects/PhotoMind && scripts/deploy.sh
```

`scripts/deploy.sh` does: `git pull` → `bun install --frozen-lockfile` → `bun run build` → `bun run db:migrate` → `uv sync` → `systemctl restart` all three services → waits for frontend to respond → prints status.

Use `scripts/deploy.sh --no-daemon` to skip restarting the Python daemon (e.g., frontend-only changes).

### Smoke Test

```bash
scripts/smoke-test.sh                          # test localhost:3003
scripts/smoke-test.sh https://<tailscale-host> # test via Tailscale HTTPS
```

18 checks: 6 pages (200), 7 API routes (200), 5 JSON shape assertions (jq), 1 CLIP bridge health.

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

---

### 2026-03-27 — Sprint 4.1 Full UI + Sprint 4.2 VPS Deploy Infrastructure (PRs #19–24)

**What was built:**
- **PR #19 — Photo detail dialog:** GET /api/photos/[id] with left-joined faces; PhotoCard converted to `<button>`; `PhotoDetailDialog` lightbox with metadata panel + faces grid; nav header expanded with all 4 new page links
- **PR #20 — Processing dashboard:** GET /api/dashboard with 4 parallel aggregate queries; `/dashboard` page with 9 stat cards, stacked pipeline health bar, live activity feed, 30s auto-refresh
- **PR #21 — Faces UI:** GET /api/faces/clusters (representative photo via raw SQL subquery); PATCH /api/faces/clusters/[id] (label validation); GET /api/faces/clusters/[id]/photos; `/faces` cluster grid with inline label editing; `/faces/[id]` per-cluster photo grid
- **PR #22 — Settings UI:** GET /api/settings (env vars + sources table); GET /api/settings/health (CLIP bridge ping with 3s timeout + latency); `/settings` page with config table + bridge health indicator + sources table
- **PR #23 — Logs UI:** GET /api/logs with page/limit/action filter; `/logs` paginated audit log with color-coded action badges, auto-refresh toggle
- **PR #24 — VPS deploy infra:** `deploy/photomind-frontend.service` (systemd unit, port 3003); `deploy/nginx/photomind.conf` (HTTP→HTTPS redirect, Tailscale TLS, proxy to 3003); `deploy/env.production.template`; `scripts/deploy.sh` (full deploy pipeline with `--no-daemon` flag); `scripts/smoke-test.sh` (18-check smoke test)

**Key files changed:**
- `frontend/src/app/(gallery)/layout.tsx` — sticky nav header with all 6 page links (gallery, search, faces, dashboard, logs, settings)
- `frontend/src/app/api/photos/[id]/route.ts` — single photo GET with face join
- `frontend/src/app/(gallery)/page.tsx` — PhotoCard as button + PhotoDetailDialog
- `frontend/src/app/api/faces/clusters/route.ts` — representative photo via raw SQL (Drizzle interpolation returned null for subquery)
- `frontend/src/app/(gallery)/logs/page.tsx` — `handleActionChange(value: ActionEnum | "ALL" | null)` — ShadCN Select passes null on clear
- `frontend/tests/api.faces.clusters.patch.test.ts` — `as Parameters<typeof PATCH>[0]` cast for both Request constructors
- `scripts/deploy.sh` — full deploy: pull → build → migrate → uv sync → restart → health check
- `scripts/smoke-test.sh` — 18 checks covering all pages, API routes, response shapes, bridge health

**Patterns established:**
- All 5 Sprint 4.1 branches were developed in parallel via git worktrees; `layout.tsx` was the only predictable merge conflict (each branch added nav links); resolved by keeping main's accumulated full-nav version at each merge
- ShadCN `Select.onValueChange` types its callback as `string` in JS but can pass `null` on clear — TypeScript strict mode caught this; handler must accept `ActionEnum | "ALL" | null`
- `new Request(...)` in Vitest/bun test files is typed as `Request`, not `NextRequest` — cast with `as Parameters<typeof GET>[0]` to satisfy route handler signatures
- Drizzle ORM subquery interpolation returns `null` for complex subqueries in some versions — use `db.run(sql\`...\`)` raw SQL when Drizzle's query builder doesn't produce correct SQL for correlated subqueries
- `deploy/nginx/photomind.conf` uses Tailscale TLS certs at `/etc/ssl/photomind/` — issued via `sudo tailscale cert <hostname>`; Tailscale handles automatic renewal
- `scripts/deploy.sh --no-daemon` flag allows frontend-only deploys without restarting the Python pipeline daemon (useful during active scans)
