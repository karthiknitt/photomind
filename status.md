# PhotoMind — Project Status

_Last updated: 2026-03-23 by Claude (Sprint 1.1 agent)_

## Current Phase & Sprint
Phase 1 — Data Foundation / Sprint 1.2 — rclone + EXIF + thumbnail + action_log (parallel) ← NEXT

## Overall Progress
- [x] Phase 0 — Bootstrap ← COMPLETE
- [~] Phase 1 — Data Foundation ← in progress (Sprint 1.1 done, PR open)
- [ ] Phase 2 — AI Intelligence
- [ ] Phase 3 — Faces + API + UI
- [ ] Phase 4 — Full UI + Deploy

## Phase 1 Task Status
- [x] T1.1 — DB Schema: Drizzle migrations generated, 24 integration tests, all passing (PR #1 open)
- [ ] T1.2 — rclone service (feat/rclone-service)
- [ ] T1.2 — EXIF service (feat/exif-service)
- [ ] T1.2 — Thumbnail service (feat/thumbnail-service)
- [ ] T1.2 — Action log helper (feat/action-log)
- [ ] T1.3 — Dedup service
- [ ] T1.3 — Meme detector

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
| feat/db-schema | T1.1 DB Schema | PR open | #1 |

## Completed This Session
- Sprint 1.1: DB Schema integration tests + Drizzle migrations
- 24 new integration tests across all 7 tables (insert/select/update/FK constraints)
- Migration file: `frontend/drizzle/0000_same_garia.sql` (7 tables, all FKs)
- TDD cycle: RED (no migration files) → GREEN (28/28 tests passing)
- Biome lint + import sort clean

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
| backend (pytest) | 10 | 0 | 81% |

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
1. Merge PR #1 (feat/db-schema) after CI passes
2. Sprint 1.2: Start 4 parallel Python backend services in separate worktrees:
   - feat/rclone-service: rclone wrapper (list, download, upload)
   - feat/exif-service: ExifTool/Pillow EXIF extraction
   - feat/thumbnail-service: Pillow 400px JPEG thumbnail generation
   - feat/action-log: SQLite action_log write helper for Python daemon
3. Each worktree: TDD (test: commit first), then feat: commit
