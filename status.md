# PhotoMind — Project Status

_Last updated: 2026-03-26 by Claude (Sprint 2.3 in progress, feat/sprint-2.3 branch)_

## Current Phase & Sprint
Phase 2 — AI Intelligence / Sprint 2.3 IN PROGRESS (feat/sprint-2.3 branch, PR pending)

## Overall Progress
- [x] Phase 0 — Bootstrap ← COMPLETE
- [x] Phase 1 — Data Foundation ← COMPLETE (all PRs merged)
- [ ] Phase 2 — AI Intelligence ← IN PROGRESS (Sprints 2.1 + 2.2 done)
- [ ] Phase 3 — Faces + API + UI
- [ ] Phase 4 — Full UI + Deploy

## Phase 2 Task Status
- [x] T2.1 — CLIP service: open_clip ViT-B/32 + ChromaDB (PR #8 merged)
- [x] T2.1 — Geo service: reverse_geocoder offline geocoding (PR #9 merged)
- [x] T2.2 — Rename service: generate final filename from metadata (PR #10 merged)
- [x] T2.2 — Core pipeline: orchestrate all 15 stages (PR #11 merged)
- [ ] T2.3 — Meme fix: WhatsApp downgraded to MEDIUM signal + filename pattern detection (PR pending)
- [ ] T2.3 — Daemon: run_scan() scans all sources, filters known paths, processes new images
- [ ] T2.3 — Scheduler: run_forever() periodic loop, clean KeyboardInterrupt shutdown
- [ ] T2.3 — SystemD service file: deploy/photomind-daemon.service
- [ ] T2.3 — Worker entry point: python -m photomind.worker [--scan-once] [--config PATH]

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
| feat/sprint-2.3 | T2.3 daemon + meme fix | open PR | #12 |

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

## Test Status
| Suite | Passing | Failing | Coverage |
|---|---|---|---|
| frontend (bun test) | 28 | 0 | — |
| backend (pytest) on feat/sprint-2.3 | 358 | 0 | 92.40% |

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
Sprint 3.1 (Phase 3 start — parallel work):
1. Face service (`services/face.py`) — InsightFace buffalo_sc CPU, detect + embed faces
2. Gallery API (`app/api/photos/route.ts`) — paginated photo list from SQLite
3. Search API (`app/api/search/route.ts`) — hybrid text + CLIP semantic search
   (see plan.md Sprint 3.1 for details)
