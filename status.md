# PhotoMind — Project Status

_Last updated: 2026-03-18 by Claude (Phase 0 bootstrap agent)_

## Current Phase & Sprint
Phase 1 — Data Foundation / Sprint 1.1 — Database Schema ← starting next

## Overall Progress
- [x] Phase 0 — Bootstrap ← COMPLETE
- [~] Phase 1 — Data Foundation ← starting
- [ ] Phase 2 — AI Intelligence
- [ ] Phase 3 — Faces + API + UI
- [ ] Phase 4 — Full UI + Deploy

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

## Completed This Session
- Full Phase 0 bootstrap
- 2 commits on main (7ac6fb3, 0bd01e8)
- CI pipeline live at https://github.com/karthiknitt/photomind/actions
- Frontend: 4 tests passing (schema smoke tests)
- Backend: 10 tests passing, 81% coverage (config module)

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
| frontend (bun test) | 4 | 0 | — |
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
1. Create `feat/db-schema` branch (T1.1)
2. Write failing Drizzle schema tests first (TDD — test:)
3. Run `bun run db:generate && bun run db:migrate` to verify migration works
4. Write insert/select/update tests for each table
5. Open PR #1 with schema work
