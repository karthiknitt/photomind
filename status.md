# PhotoMind — Project Status

_Last updated: 2026-03-26 by Claude (Sprint 2.1 agent)_

## Current Phase & Sprint
Phase 2 — AI Intelligence / Sprint 2.1 COMPLETE (PRs #8 and #9 open) → Sprint 2.2 next

## Overall Progress
- [x] Phase 0 — Bootstrap ← COMPLETE
- [x] Phase 1 — Data Foundation ← COMPLETE (all PRs merged)
- [ ] Phase 2 — AI Intelligence ← IN PROGRESS (Sprint 2.1 done, Sprint 2.2 next)
- [ ] Phase 3 — Faces + API + UI
- [ ] Phase 4 — Full UI + Deploy

## Phase 2 Task Status
- [ ] T2.1 — CLIP service: open_clip ViT-B/32 + ChromaDB (PR #8 open) ← PENDING REVIEW
- [ ] T2.1 — Geo service: reverse_geocoder offline geocoding (PR #9 open) ← PENDING REVIEW
- [ ] T2.2 — Rename service: generate final filename from metadata
- [ ] T2.2 — Core pipeline: orchestrate all 15 stages

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
| feat/clip-service | T2.1 CLIP | open PR | #8 |
| feat/geo-service | T2.1 Geo | open PR | #9 |

## Completed This Session
- Sprint 2.1: CLIP service + Geo service (TDD, both reviewed)
- clip.py: embed_image, insert_to_chroma, query_similar, zero_shot_label, get_chroma_collection
  - open_clip ViT-B/32 float16 CPU singleton (thread-safe double-checked locking)
  - ChromaDB upsert semantics (retry-safe); empty collection safe (clamps n_results)
  - 31 tests (all mocked — no 300MB model in CI), clip.py 100% coverage
- geo.py: reverse_geocode, batch_reverse_geocode (offline, reverse_geocoder library)
  - Validates lat/lon, batch uses single search() call, empty-result guard
  - 25 tests using real coordinates (Chennai, London, NYC verified)
- open-clip-torch, chromadb, reverse_geocoder added as dependencies
- 212 tests passing on clip branch, 207 on geo branch, ~94% coverage each

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
| backend (pytest) on main | 181 | 0 | 92% |
| backend on feat/clip-service | 212 | 0 | 94% |
| backend on feat/geo-service | 207 | 0 | 93% |

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
1. Merge PR #8 (clip-service) and PR #9 (geo-service) after CodeRabbit review
2. Sprint 2.2: Two services in sequence:
   - feat/rename-service: generate final filename (YYYY-MM-DD_HHMMSS_City_Person_Model_hash.ext)
   - feat/pipeline: orchestrate all 15 stages end-to-end
3. Each in its own worktree, TDD cycle
