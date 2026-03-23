# PhotoMind — Claude Instructions

## What This Project Is

Personal photo management system (Google Photos alternative). Processes 200k+ family photos
from OneDrive accounts. Runs on a remote Linux VPS. Fully private, no cloud AI.
Single user (Karthik + family, single shared login).

## Key Files to Read First

1. `status.md` — current project state, what's done, what's next
2. `docs/plan.md` — full build plan with phases and tasks
3. `docs/techstack.md` — every tech choice with reasons
4. `handoff.md` — if present in this worktree, mid-feature context

## Architecture in One Paragraph

Next.js 15 (Bun runtime) serves the frontend and API routes, reading from a bun:sqlite
database via Drizzle ORM. A separate Python daemon (uv, asyncio) runs in the background:
it reads photos from OneDrive via rclone, processes them through a 15-stage pipeline
(EXIF → meme-check → dedup → CLIP embed → face detect → geocode → rename), and uploads
the result back to OneDrive/PhotoMind/library/. ChromaDB (disk-backed) stores CLIP vectors
for semantic search. The frontend queries both SQLite (metadata) and ChromaDB (via a Python
HTTP bridge) for hybrid search.

## Shared SQLite Architecture (Critical)

Both Next.js and the Python daemon write to the **same SQLite file**. Key details:
- Next.js uses Drizzle ORM (`drizzle-orm/bun-sqlite`); SQLite is opened with WAL mode + `foreign_keys=ON`
- Python daemon uses raw `sqlite3` with WAL mode + `foreign_keys=OFF` (FK checks disabled because `action_log` may be written before the `photos` table exists)
- `backend/src/photomind/services/action_log.py` creates `action_log` with `CREATE TABLE IF NOT EXISTS` — it can bootstrap before Drizzle migrations have run
- Database path is controlled by `DATABASE_PATH` env var; defaults to `~/photomind/photomind.db`
- For tests, set `DATABASE_PATH` to a temp path — no `config.yaml` needed

## config.yaml (gitignored — create manually on VPS)

```yaml
database_path: /home/karthik/photomind/photomind.db
chroma_db_path: /home/karthik/photomind/chroma_db
thumbnails_path: /home/karthik/photomind/thumbnails
tmp_path: /home/karthik/photomind/tmp

sources:
  - remote: onedrive_karthik
    scan_path: /Pictures
    label: Karthik OneDrive

output:
  remote: onedrive_karthik
  path: PhotoMind/library/

pipeline:
  batch_size: 10
  max_concurrent: 1
  meme_threshold: 0.7
  dedup_hamming_threshold: 10

daemon:
  scan_interval_seconds: 3600
  face_cluster_interval_seconds: 86400
```

`load_config()` in `backend/src/photomind/config.py` returns safe defaults if `config.yaml` is absent (enables tests to run in CI without secrets).

## Project Structure

```
photomind/
├── .github/workflows/      # CI (ci.yml)
├── docs/                   # plan.md, prd.md, techstack.md
├── frontend/               # Next.js 15, Bun, Biome, ShadCN, Drizzle
│   ├── src/
│   │   ├── app/            # App Router pages + API routes
│   │   ├── components/     # ShadCN + custom
│   │   └── lib/db/         # Drizzle schema + bun:sqlite client
│   └── tests/
├── backend/                # Python daemon + services
│   ├── src/photomind/
│   │   ├── services/       # clip, face, exif, geo, rename, dedup, meme, rclone, thumbnail
│   │   ├── worker/         # daemon, pipeline, scheduler
│   │   └── config.py
│   └── tests/fixtures/
├── CLAUDE.md               # this file
├── status.md               # always-current project status
└── handoff.md              # per-worktree agent handoff (if present)
```

## Stack Conventions

- **Runtime**: Bun everywhere for frontend/TS
- **Package manager**: `bun install` (never npm or pnpm)
- **TS lint/format**: Biome (`bun run lint`, `bun run format`)
- **TS tests**: Vitest via `bun test`
- **Python env**: uv (`uv run`, `uv add`, never pip)
- **Python lint/format**: Ruff (`ruff check`, `ruff format`)
- **Python tests**: pytest (`uv run pytest`)
- **ORM**: Drizzle with `drizzle-orm/bun-sqlite` — schema in `frontend/src/lib/db/schema.ts`
- **UI**: ShadCN components + Tailwind v4
- **No `any` in TypeScript** — strict mode enforced
- **Type hints mandatory** on all Python functions

## TDD Rules (mandatory)

1. Write test file first → commit as `test: ...`
2. Run tests → confirm FAIL
3. Write implementation → commit as `feat: ...`
4. Tests must PASS before PR is opened
5. Coverage must stay ≥ 80%

## Commit Message Format

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

Subject: imperative mood, no period at end.

## Branch Naming

- Feature: `feat/<name>` (e.g., `feat/exif-service`)
- Fix: `fix/<name>`
- Chore: `chore/<name>`

## Never Do

- **Never modify original photos** on OneDrive source folders
- **Never commit** `.env`, `config.yaml`, `photomind.db`, `chroma_db/`, `thumbnails/`
- **Never push directly to `main`** after Phase 0
- **Never use `pip install`** — use `uv add`
- **Never use `npm install`** — use `bun add`
- **Never skip tests** to meet a deadline
- **Never use `any`** in TypeScript

## Running the Project Locally

```bash
# Frontend dev server
cd frontend && bun install && bun dev

# Backend daemon
cd backend && uv sync && uv run python -m photomind.worker.daemon

# Tests
cd frontend && bun test
cd backend && uv run pytest --cov=src/photomind

# Lint
cd frontend && bun run lint     # biome
cd backend && uv run ruff check src/ && uv run ruff format src/

# DB migrations
cd frontend && bun run db:generate && bun run db:migrate

# DB studio (visual data inspector)
cd frontend && bun run db:studio

# Run a single frontend test by name pattern
cd frontend && bun test --reporter=verbose -t "test name pattern"

# Run a single backend test by name pattern
cd backend && uv run pytest -k "test_name_pattern" -v
```

## VPS Access

- SSH: `ssh karthik@<tailscale-ip>`
- rclone remotes: `onedrive_karthik`, `onedrive_wife` (+ others in config.yaml)
- PhotoMind library output: `onedrive_karthik:PhotoMind/library/`
- Daemon managed by systemd: `systemctl status photomind-daemon`
- ChromaDB path: `/home/karthik/photomind/chroma_db`
- DB path: `/home/karthik/photomind/photomind.db`

## Handoff Protocol

If you are an agent picking up mid-feature:
1. `git log --oneline -20` — read recent history
2. `cat handoff.md` — read current state
3. `bun test` / `uv run pytest` — confirm current test status
4. Continue from "Next Immediate Action" in handoff.md

If you are an agent finishing work:
1. Update `handoff.md` with current state
2. Update `status.md` with progress
3. Commit both with `wip: update handoff and status`
4. Push branch

## Phase Completion Checklist

Before marking any task complete:
- [ ] All tests passing (`bun test` + `uv run pytest`)
- [ ] Coverage ≥ 80%
- [ ] Biome passes (`bun run lint`)
- [ ] Ruff passes (`uv run ruff check src/`)
- [ ] No secrets committed
- [ ] `status.md` updated
- [ ] `handoff.md` updated (if applicable)
- [ ] PR description follows template in `docs/plan.md`

---

## PR Submission + CodeRabbit Workflow

Scripts live in `scripts/`. Run from the project root.

### Submitting a PR

```bash
scripts/submit-pr.sh <branch> "<title>" [base_branch]
# Example:
scripts/submit-pr.sh feat/exif-service "feat(exif): add EXIF extraction service"
```

This creates the PR and attempts to assign `coderabbitai` as reviewer. CodeRabbit will
auto-review within ~2 minutes (free tier, public repo, one PR at a time).

### Processing CodeRabbit comments (Claude's workflow)

```bash
# 1. Wait for CodeRabbit to finish reviewing
scripts/review-pr.sh <PR> wait

# 2. Dump all comments (inline + PR-level + review walkthrough)
scripts/review-pr.sh <PR> dump

# 3a. For VALID comments — reply "working on it", implement fix, commit, reply "fixed"
scripts/review-pr.sh <PR> reply-inline <comment_id> "Working on it."
# ... implement fix, git commit ...
scripts/review-pr.sh <PR> reply-inline <comment_id> "Fixed in $(git rev-parse --short HEAD)."

# 3b. For INVALID comments — explain disagreement inline
scripts/review-pr.sh <PR> reply-inline <comment_id> "Disagree: <reason>"

# 4. Post a final PR-level summary
scripts/review-pr.sh <PR> reply-pr "All actionable comments addressed. Merging."

# 5. Merge (checks for conflicts first)
scripts/review-pr.sh <PR> merge

# 6. Sync local main
scripts/review-pr.sh <PR> sync
```

### Comment validity guidelines

| Comment type | Action |
|---|---|
| Real bug / correctness issue | Valid — fix it |
| Security concern | Valid — fix it |
| Style already covered by ruff/biome | Invalid — disagree |
| False positive (e.g. pathlib trailing slash in Python 3.12) | Invalid — explain why |
| Architecture suggestion (out of scope for current PR) | Note it, decline politely |

### Multiple PR queue

CodeRabbit free = one PR reviewed at a time. Submit all PRs, then process serially:

```bash
for PR in $(gh pr list --json number --jq '.[].number'); do
  scripts/review-pr.sh $PR wait
  scripts/review-pr.sh $PR dump
  # ... Claude reads dump, replies, implements fixes ...
  scripts/review-pr.sh $PR merge
  scripts/review-pr.sh $PR sync
done
```

---

## Development Skills (Always Use)

When developing this Next.js project, always use these two skills:

- **`/portless`** — Use when starting the dev server. Provides a public URL for the local server without needing to expose ports manually.
- **`/agent-browser`** — Use to verify UI behavior in the browser after making changes. Run after starting the dev server to visually confirm pages load correctly, forms work, and key UI renders as expected.

Workflow:
1. Start dev server → use `/portless` to get a public URL
2. After any UI change → use `/agent-browser` to verify it looks and works correctly
3. Before marking any feature complete → run `/agent-browser` to do a visual gut-check
