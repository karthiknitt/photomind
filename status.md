# PhotoMind — Project Status

_Last updated: 2026-03-23 by Claude (Sprint 1.3 agent)_

## Current Phase & Sprint
Phase 1 — Data Foundation / Sprint 1.3 COMPLETE → Phase 2 Sprint 2.1 next

## Overall Progress
- [x] Phase 0 — Bootstrap ← COMPLETE
- [x] Phase 1 — Data Foundation ← COMPLETE (all PRs merged)
- [ ] Phase 2 — AI Intelligence
- [ ] Phase 3 — Faces + API + UI
- [ ] Phase 4 — Full UI + Deploy

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

## Completed This Session
- Sprint 1.3: Dedup service + Meme detector (both TDD, 52 new tests)
- dedup.py: compute_phash, compute_sha256, hamming_distance, is_duplicate
- meme.py: 5-signal classifier (whatsapp, clip, aspect ratio, no-date, file-size)
- imagehash added as dependency (pHash via ViT-aligned 64-bit hash)
- All 156 backend tests passing, 92% coverage

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
| backend (pytest) | 156 | 0 | 92% |

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
1. Sprint 2.1: Start 2 parallel Phase 2 services:
   - feat/clip-service: open_clip ViT-B/32 float16 embeddings + ChromaDB insert
   - feat/geo-service: reverse_geocoder offline GPS→city/state/country
3. Each in its own worktree, TDD cycle
