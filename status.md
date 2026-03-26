# PhotoMind — Project Status

_Last updated: 2026-03-27 by Claude (Sprint 3.2 complete, PRs #16-17 merged, #18 open)_

## Current Phase & Sprint
Phase 3 — Faces + API + UI / Sprint 3.2 IN PROGRESS (PRs #16 + #17 merged, #18 awaiting CodeRabbit)

## Overall Progress
- [x] Phase 0 — Bootstrap ← COMPLETE
- [x] Phase 1 — Data Foundation ← COMPLETE (all PRs merged)
- [x] Phase 2 — AI Intelligence ← COMPLETE (Sprints 2.1, 2.2, 2.3 done)
- [ ] Phase 3 — Faces + API + UI ← IN PROGRESS (Sprint 3.2 mostly done)
- [ ] Phase 4 — Full UI + Deploy

## Phase 3 Task Status
- [x] T3.1 — Face service: InsightFace buffalo_sc CPU detect + embed, cosine ChromaDB collection (PR #13)
- [x] T3.1 — Pipeline stage 10 wired: face detect + store_faces + update face_count (PR #13)
- [x] T3.1 — Gallery API: GET /api/photos paginated, Drizzle projection, offset/page (PR #14)
- [x] T3.1 — CLIP bridge: FastAPI GET /search, text→embedding→ChromaDB query (PR #15)
- [x] T3.1 — Search API: GET /api/search hybrid text+semantic, graceful degradation (PR #15)
- [x] T3.2 — Face clustering: HDBSCAN periodic job (run_clustering), scheduler integration (PR #16)
- [x] T3.2 — Bridge systemd service: deploy/photomind-bridge.service (PR #17)
- [ ] T3.2 — Gallery UI: paginated photo grid + search page (PR #18, awaiting review)

## Phase 2 Task Status
- [x] T2.1 — CLIP service: open_clip ViT-B/32 + ChromaDB (PR #8 merged)
- [x] T2.1 — Geo service: reverse_geocoder offline geocoding (PR #9 merged)
- [x] T2.2 — Rename service: generate final filename from metadata (PR #10 merged)
- [x] T2.2 — Core pipeline: orchestrate all 15 stages (PR #11 merged)
- [x] T2.3 — Meme fix: WhatsApp downgraded to MEDIUM signal + filename pattern detection (PR #12)
- [x] T2.3 — Daemon: run_scan() scans all sources, filters known paths, processes new images
- [x] T2.3 — Scheduler: run_forever() periodic loop, clean KeyboardInterrupt shutdown
- [x] T2.3 — SystemD service file: deploy/photomind-daemon.service
- [x] T2.3 — Worker entry point: python -m photomind.worker [--scan-once] [--config PATH]

## Phase 1 Task Status
- [x] T1.1 — DB Schema: Drizzle migrations, 24 integration tests (PR #1 merged)
- [x] T1.2 — rclone service (PR #2 merged)
- [x] T1.2 — EXIF service (PR #5 merged)
- [x] T1.2 — Thumbnail service (PR #3 merged)
- [x] T1.2 — Action log helper (PR #4 merged)
- [x] T1.3 — Dedup service: 25 tests, 100% coverage (PR #6 merged)
- [x] T1.3 — Meme detector: 30 tests, 97% coverage (PR #7 merged)

## Phase 0 Task Status
- [x] T0.1 — GitHub repo created (`karthiknitt/photomind`, private)
- [x] T0.2 — `docs/plan.md` written
- [x] T0.3 — `docs/prd.md` written
- [x] T0.4 — `docs/techstack.md` written
- [x] T0.5 — `CLAUDE.md` written
- [x] T0.6 — `status.md` initialized (this file)
- [x] T0.7 — First docs commit pushed to main (commit 7ac6fb3)
- [x] T0.8 — Frontend scaffold: Next.js 16.1.7, Bun, Biome 2.4.7, ShadCN, Drizzle, Vitest
- [x] T0.9 — Backend scaffold: uv, Ruff, pytest, config.py
- [x] T0.10 — CI: GitHub Actions (frontend + backend jobs, runs on PRs to main)
- [!] Branch protection: SKIPPED — requires GitHub Pro for private repos

## Test Status
| Suite | Passing | Failing | Coverage |
|---|---|---|---|
| frontend (bun test) | 65 | 0 | — |
| backend (pytest) on main | 432 | 0 | ~92% |

## Active Branches
| Branch | Task | Status | PR # |
|---|---|---|---|
| main | Phase 0 complete | merged | direct push |
| feat/db-schema | T1.1 DB Schema | merged | #1 |
| feat/rclone-service | T1.2 rclone | merged | #2 |
| feat/thumbnail-service | T1.2 thumbnail | merged | #3 |
| feat/action-log | T1.2 action log | merged | #4 |
| feat/exif-service | T1.2 EXIF | merged | #5 |
| feat/dedup-service | T1.3 dedup | merged | #6 |
| feat/meme-detector | T1.3 meme | merged | #7 |
| feat/clip-service | T2.1 CLIP | merged | #8 |
| feat/geo-service | T2.1 Geo | merged | #9 |
| feat/rename-service | T2.2 rename + photos_db | merged | #10 |
| feat/pipeline | T2.2 core pipeline | merged | #11 |
| feat/sprint-2.3 | T2.3 daemon + meme fix | merged | #12 |
| feat/face-service | T3.1 face service + pipeline | merged | #13 |
| feat/gallery-api | T3.1 gallery API | merged | #14 |
| feat/search-api | T3.1 CLIP bridge + search API | merged | #15 |
| feat/face-cluster | T3.2 HDBSCAN face clustering | merged | #16 |
| feat/bridge-service | T3.2 bridge systemd service | merged | #17 |
| feat/gallery-ui | T3.2 gallery + search UI | open | #18 |

## Completed This Session (Sprint 3.2)
- cluster.py: run_clustering() — HDBSCAN (sklearn, euclidean on L2-normed vectors)
  - Fetches all face embeddings from ChromaDB "faces" collection
  - Fresh rebuild each run: clears face_clusters + faces.cluster_id, re-inserts
  - Noise faces (label=-1) get cluster_id=NULL
  - ClusterResult dataclass: n_faces / n_clusters / n_noise
  - 10 tests, ruff-clean; fixed E501 docstrings (CodeRabbit PR #16)
- scheduler.py: clustering integrated into run_forever() periodic loop
  - last_cluster_time = time.time() at startup (avoids immediate run on boot)
  - Cluster errors logged + skipped; loop continues
  - 3 new scheduler tests for clustering integration
- deploy/photomind-bridge.service: systemd unit for CLIP bridge (uvicorn :8765)
  - Fixed: StartLimitInterval→StartLimitIntervalSec in [Unit] section (CodeRabbit PR #17)
- Gallery UI: (gallery) route group, shared sticky header layout
  - app/(gallery)/page.tsx: paginated photo grid (48/page), PhotoCard with next/image
  - app/(gallery)/search/page.tsx: 400ms debounced search, mode selector, ResultCard
  - GET /api/thumbnails/[id]: JPEG from THUMBNAILS_PATH, path-traversal guard
  - .gitignore: fixed thumbnails/ glob not to swallow Next.js source route
  - api.thumbnails.test.ts: 6 tests using bun:test mutable-cell pattern (no vi.resetModules)
  - THUMBNAILS_DIR read inside handler (not top-level const) — env var takes effect per-request
  - 65 frontend tests, 0 fail
- PR #16 merged, PR #17 merged, PR #18 open (awaiting CodeRabbit)

## Completed This Session (Sprint 3.1)
- face.py: InsightFace buffalo_sc singleton, detect() filters by det_thresh=0.5,
  store_faces() writes to SQLite faces table + ChromaDB "faces" collection (cosine distance)
  - embedding_id == face_id UUID (links SQLite ↔ ChromaDB)
  - cluster_id=NULL at detection time; HDBSCAN fills it in the periodic job
  - cv2.imread() None check added (CodeRabbit fix)
  - 12 tests, 96% coverage; full suite 370 pass, 92.58%
- pipeline.py: stage 10 stub replaced with real face_svc.detect() + store_faces() call
- pyproject.toml: insightface>=0.7.3 + onnxruntime>=1.20.0 added
- Gallery API: GET /api/photos (page/limit/status/from/to)
  - Drizzle projection: 17 public fields, internal fields omitted
  - Parallel COUNT(*) + data query with Promise.all
  - Sort: dateTaken DESC, createdAt DESC (stable secondary sort)
  - 14 tests, all pass; vi.resetModules() removed (not in bun vitest compat)
- CLIP bridge: FastAPI on localhost:8765
  - embed_text() added to clip.py (text→512-dim CLIP vector)
  - GET /search?q=<query>&n=20 → embeds query → ChromaDB "photos" query → returns [{id, distance}]
  - GET /health → liveness check
  - fastapi>=0.115.0 + uvicorn>=0.32.0 added
- Search API: GET /api/search?q=<query>&mode=hybrid&limit=20&page=1
  - text mode: LIKE on city/country/filenameFinal
  - semantic mode: calls CLIP_BRIDGE_URL, score = 1 - distance
  - hybrid mode: union+dedup, max score, "hybrid" matchSource for both hits
  - CLIP_BRIDGE_URL env var gates semantic (graceful text-only fallback in CI)
  - inArray() guard prevents empty-array SQLite error
  - 17 search tests + 12 bridge tests; all pass

## Completed This Session (Sprint 2.3)
- meme.py: WhatsApp EXIF software downgraded HIGH→MEDIUM; new `_check_whatsapp_filename()`
  MEDIUM signal detects IMG-YYYYMMDD-WA####.jpg, VID-…, "WhatsApp Image …" patterns
  - Genuine family photos shared via WhatsApp no longer falsely classified as memes
  - 45 tests, 97% coverage; `check_meme()` gains `filename` kwarg
- photos_db.py: `get_processed_source_paths()` returns set[(remote, path)] for daemon skip logic
- rclone.py: `list_files()` gains `recursive=True` flag (passes --recursive to rclone lsjson)
- daemon.py: `run_scan()` — scans all sources, skips known paths, calls process_photo per new image
  - `_is_image()` helper filters by extension (.jpg/.jpeg/.png/.heic/.heif/.tiff/.webp/.bmp/.gif)
  - RcloneError per-source is logged + skipped; other sources continue
  - 21 tests, 100% coverage
- scheduler.py: `run_forever()` — periodic loop, sleeps scan_interval_seconds between scans
  - Transient scan errors logged + retried; KeyboardInterrupt exits cleanly
  - 6 tests, 86% coverage
- worker/__main__.py: entry point `python -m photomind.worker`
  - Flags: --config PATH, --scan-once, --verbose
- deploy/photomind-daemon.service: systemd service file for VPS
- Full suite: 358 tests passing, 92.40% coverage

## Completed This Session (Sprint 2.2)
- rename.py: generate_filename with SHA256 salt, date prefix, optional segments (city/persons/camera),
  sanitization (spaces→hyphens), 200-char truncation, collision handling (_v2/_v3)
  - 35 tests, 99% coverage
- photos_db.py: create_photo, update_photo (dynamic SET clause), get_phashes, get_existing_filenames
  - WAL + FK-off sqlite3; _open() now a @contextmanager (closes conn in finally)
  - 19 tests, 99% coverage
- pipeline.py: process_photo() 15-stage orchestrator
  - _BailOut sentinel for meme/dedup bail-outs; all bail-outs set status=DONE
  - Intra-batch dedup: known_phashes.add(phash) after each successful photo
  - 15 integration tests (real SQLite, mocked rclone/CLIP/geo), 91% coverage
- Full suite: 307 tests passing, 94.87% coverage

## Blocked / Needs Attention
- Branch protection skipped (GitHub free plan limitation for private repos).
  Work discipline: always use feature branches + PRs. CI will still run.
- Note: Upgrade to GitHub Pro ($4/month) if enforcement is needed.

## Last Known Good State
- `main` is clean, CI passing (verify at GitHub Actions after first run)
- Phase 0 fully complete
- All tests green locally

## Test Status (Sprint 2.3 — superseded, see Sprint 3.1 status above)
| Suite | Passing | Failing | Coverage |
|---|---|---|---|
| frontend (bun test) | 28 | 0 | — |
| backend (pytest) on main | 358 | 0 | 92.40% |

## Environment Notes
- VPS: configure SSH + Tailscale IP in `config.yaml` (gitignored)
- rclone remotes: `onedrive_karthik`, `onedrive_wife` (+ others)
- PhotoMind output folder: `onedrive_karthik:PhotoMind/library/`
- bun version: 1.3.9
- Python version: 3.12.3
- GitHub repo: https://github.com/karthiknitt/photomind

## How to Resume
```bash
cd ~/projects/PhotoMind
git status
git log --oneline -10
cat status.md          # this file
cat handoff.md         # if mid-feature
cd frontend && bun test
cd backend && uv run pytest
```

## Next Session Should
1. Merge PR #18 (gallery-ui) after CodeRabbit review
2. Begin Phase 4: Full UI polish + VPS deploy
   - Photo detail view / lightbox
   - Face cluster labels UI (assign names to clusters)
   - VPS deploy: sync code, run migrations, start systemd services
   - End-to-end smoke test against real OneDrive photos
