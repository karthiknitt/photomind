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
