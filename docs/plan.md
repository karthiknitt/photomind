# PhotoMind — Build Plan

## Overview

Personal Google Photos alternative on a remote Linux VPS. 200k+ photos across 3–5 OneDrive accounts,
processed via CLIP + InsightFace (CPU-only), renamed, deduped, meme-filtered, best-quality copy
uploaded to `OneDrive/PhotoMind/library/`. Originals never touched.

---

## Principles

- **Never modify originals** — all operations are read-only on source folders
- **TDD** — failing tests committed first, implementation second
- **Small, frequent commits** — every commit body documents decisions + what's next
- **Git log = long-term memory** — any agent reading the log should understand context
- **CPU-only AI** — no GPU required, runs on a cheap VPS

---

## Repository & Workflow Rules

- **GitHub repo**: private, `photomind`
- **Phase 0**: push directly to `main` (bootstrap only)
- **All subsequent work**: feature branches → PR → CI pass → merge
- **Branch protection**: enabled after Phase 0
- **Commits**: small, frequent, conventional (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `wip:`)
- **Parallel work**: sub-agents in git worktrees
- **Handoff**: every sub-agent maintains `handoff.md` in its worktree root
- **Status**: `status.md` always reflects current project state — updated every session

---

## Tech Stack

| Concern | Tool |
|---|---|
| Frontend runtime | Bun |
| Frontend framework | Next.js 15 (App Router, `src/`) |
| Package manager | bun |
| TS lint/format | Biome |
| TS testing | Vitest (bun runner) |
| ORM | Drizzle + `drizzle-orm/bun-sqlite` |
| SQLite | `bun:sqlite` |
| UI | ShadCN + Tailwind v4 |
| Auth | Better Auth |
| Python env | uv + pyproject.toml |
| Python format/lint | Ruff |
| Python testing | pytest |
| AI: embeddings | `open_clip` ViT-B/32 float16 CPU |
| AI: faces | InsightFace `buffalo_sc` CPU |
| Vector DB | ChromaDB (disk-backed, Python) |
| Geocoding | `reverse_geocoder` (offline) |
| Face clustering | HDBSCAN (scikit-learn) |
| Dedup | `imagehash` pHash |
| Source/output | rclone (OneDrive OAuth, already configured) |
| VPN | Tailscale (Windows ↔ VPS, already configured) |

---

## Phase Breakdown

### PHASE 0 — Bootstrap
**Goal**: Repo exists, CI works, local dev works, `main` is protected.

- Sprint 0.1: Repo + Docs (plan, prd, techstack, CLAUDE.md, status.md)
- Sprint 0.2: Frontend Scaffold (Next.js 15, Biome, ShadCN, Drizzle, Vitest)
- Sprint 0.3: Backend Scaffold (uv, Ruff, pytest)
- Sprint 0.4: CI + Branch Protection

### PHASE 1 — Data Foundation
**Goal**: Scan OneDrive, download, extract EXIF, thumbnail, dedup, log.

- Sprint 1.1: Database Schema (Drizzle, bun:sqlite)
- Sprint 1.2: Parallel — rclone service, EXIF service, thumbnail service, action log
- Sprint 1.3: Sequential — dedup service, meme detector

### PHASE 2 — AI Intelligence
**Goal**: CLIP embeddings, semantic search, geocoding, smart renaming, full pipeline.

- Sprint 2.1: Parallel — CLIP service + ChromaDB, Geo service
- Sprint 2.2: Sequential — rename service, core pipeline

### PHASE 3 — Faces + API + Basic UI
**Goal**: Faces detected and clustered. API routes live. Gallery browsable.

- Sprint 3.1: Parallel — face service, gallery API, search API
- Sprint 3.2: Daemon + UI (background daemon, gallery UI, search UI)

### PHASE 4 — Full UI + Events + Deploy
**Goal**: Face labeling, events, audit log, processing dashboard, VPS deployment.

- Sprint 4.1: Parallel — faces UI, events UI, logs UI, processing dashboard, settings
- Sprint 4.2: VPS deploy (systemd, nginx, env management)

---

## Execution Order

```
Phase 0  →  Sprint 0.1 → 0.2 → 0.3 → 0.4  (sequential)
Phase 1  →  Sprint 1.1 → 1.2 (4 parallel) → 1.3 (sequential)
Phase 2  →  Sprint 2.1 (2 parallel) → 2.2 (sequential)
Phase 3  →  Sprint 3.1 (3 parallel) → 3.2 (sequential then parallel)
Phase 4  →  Sprint 4.1 (5 parallel) → 4.2
```

---

## Database Schema (Drizzle / bun:sqlite)

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
| city | TEXT | nullable, from geocoding |
| state | TEXT | nullable |
| country | TEXT | nullable |
| camera_make | TEXT | nullable |
| camera_model | TEXT | nullable |
| software | TEXT | EXIF software field (WhatsApp detection) |
| width | INTEGER | |
| height | INTEGER | |
| file_size | INTEGER | bytes |
| phash | TEXT | perceptual hash for dedup |
| is_meme | INTEGER | 0 or 1 |
| meme_reason | TEXT | CSV of signal names |
| clip_indexed | INTEGER | 0 or 1 |
| face_count | INTEGER | |
| status | TEXT | QUEUED/PROCESSING/DONE/ERROR |
| created_at | INTEGER | Unix timestamp |
| updated_at | INTEGER | Unix timestamp |

### faces
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| photo_id | TEXT FK | → photos.id |
| cluster_id | TEXT | → face_clusters.id, nullable |
| embedding_id | TEXT | ChromaDB ID |
| bbox_x | INTEGER | |
| bbox_y | INTEGER | |
| bbox_w | INTEGER | |
| bbox_h | INTEGER | |
| det_score | REAL | InsightFace confidence |

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
| source | TEXT | clip/manual |
| confidence | REAL | nullable |

### events
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | |
| date_start | INTEGER | |
| date_end | INTEGER | |
| cover_photo_id | TEXT FK | |

### action_log
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| photo_id | TEXT FK | nullable |
| action | TEXT | COPIED/SKIPPED_DUPLICATE/SKIPPED_MEME/SKIPPED_ERROR/INDEXED/FACE_DETECTED |
| detail | TEXT | JSON or string |
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

## Pipeline Stages (15 stages per photo)

1. **Download** — rclone copy from source remote to temp dir
2. **Hash** — compute file SHA256 for exact duplicate check
3. **EXIF** — extract date, GPS, camera, software
4. **Meme check** — 5-signal classifier (skip if meme)
5. **Dedup** — pHash against existing library (skip if duplicate)
6. **Thumbnail** — generate 400px JPEG thumbnail
7. **CLIP embed** — generate 512-dim float16 vector
8. **ChromaDB insert** — store embedding with photo_id
9. **Zero-shot label** — CLIP labels → photo_tags
10. **Face detect** — InsightFace buffalo_sc, store embeddings
11. **Face cluster** — HDBSCAN (periodic job, not per-photo)
12. **Geocode** — GPS → city/state/country (offline)
13. **Rename** — generate final filename from metadata
14. **Upload** — rclone copy to OneDrive/PhotoMind/library/
15. **DB finalize** — update photo record, action_log entry

---

## Naming Convention

```
YYYY-MM-DD_HHMMSS_[City]_[Person1-Person2]_[CameraModel]_[4chars].jpg

Examples:
  2024-12-25_143022_Ooty_Karthik-Priya_iPhone14Pro_a3f2.jpg
  2024-08-15_092000_Chennai_Ammu_unknown_b1c9.jpg
  2023-01-01_120000_Trichy_a9d1.jpg   (no faces, no GPS city)
```

Rules:
- Collision: append `_v2`, `_v3`
- Special characters: stripped, spaces → hyphens
- Max filename length: 200 chars (truncate city/names if needed)

---

## Meme Detection Signals

| Signal | Weight | Logic |
|---|---|---|
| EXIF software contains "whatsapp" | high | case-insensitive match |
| Aspect ratio: 9:16 or 1:1 or 16:9 (tight) | medium | ±2% tolerance |
| No EXIF date | medium | forwards often have no metadata |
| File size < 150KB (for image > 500px) | low | compressed forward |
| CLIP zero-shot: "meme" / "text overlay" / "screenshot" | high | top-3 labels |

Decision: `is_meme = True` if high-weight signal fires OR ≥2 medium/low signals fire.

---

## Commit Message Guidelines

```
<type>(<scope>): <subject>   ← max 72 chars

<body>

Decisions:
- <key decision and why>

Tested:
- <what was tested>

Next:
- <what follows>

Refs: <task ID>
```

Types: `feat`, `test`, `fix`, `chore`, `docs`, `refactor`, `wip`, `style`
