# PhotoMind

> Private Google Photos alternative — processes 200k+ family photos from OneDrive, fully on-device with no cloud AI.

## Overview

PhotoMind is a self-hosted photo management system built for a family with photos scattered across multiple OneDrive accounts. It scans source drives, deduplicates, filters memes and screenshots, extracts EXIF metadata, generates CLIP embeddings for semantic search, detects and clusters faces, reverse-geocodes GPS coordinates, and renames photos into a consistent library — all on a Linux VPS with no GPU.

Originals are never modified. The processed library is written to a dedicated OneDrive output folder.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend runtime | Bun |
| Frontend framework | Next.js 15 (App Router) |
| UI components | ShadCN + Tailwind v4 |
| TS lint/format | Biome |
| TS testing | Vitest (via bun) |
| ORM | Drizzle ORM + `bun:sqlite` |
| Python env | uv + pyproject.toml |
| Python lint/format | Ruff |
| Python testing | pytest + pytest-cov |
| AI: embeddings | open_clip ViT-B/32 (CPU) |
| AI: faces | InsightFace buffalo_sc (CPU) |
| Vector DB | ChromaDB (disk-backed) |
| Geocoding | reverse_geocoder (offline) |
| Face clustering | HDBSCAN (scikit-learn) |
| Dedup | imagehash (pHash) + SHA256 |
| OneDrive sync | rclone |
| VPN | Tailscale |
| CI | GitHub Actions |
| CD | VPS deploy via `scripts/deploy.sh` |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) >= 1.3
- [uv](https://docs.astral.sh/uv/) >= 0.5
- [rclone](https://rclone.org/) with OneDrive remotes configured
- Python 3.12+

### Setup

```bash
git clone https://github.com/karthiknitt/photomind.git
cd photomind

# Frontend dependencies
cd frontend && bun install

# Backend dependencies
cd ../backend && uv sync
```

### Configuration

Create `config.yaml` in the project root (this file is gitignored — never commit it). See `docs/documentation.md` for the full schema and all available options.

### Running Locally

```bash
# Frontend dev server
cd frontend && bun dev

# Backend daemon (requires config.yaml)
cd backend && uv run python -m photomind.worker

# Database migrations (run once after clone or schema changes)
cd frontend && bun run db:generate && bun run db:migrate

# Database inspector (visual UI for SQLite)
cd frontend && bun run db:studio
```

## Features

**Pipeline (Python daemon)**
- rclone integration — list and download files from any configured OneDrive remote
- EXIF extraction — date, GPS, camera make/model, software, dimensions
- Meme / screenshot detection — 5-signal weighted classifier (WhatsApp EXIF, aspect ratio, no date, file size, CLIP labels)
- Deduplication — exact dedup via SHA256, near-dedup via pHash (Hamming distance ≤ 10)
- Thumbnail generation — 400px JPEG thumbnails with EXIF orientation correction
- CLIP semantic embeddings — ViT-B/32 float16, stored in ChromaDB
- Offline GPS reverse geocoding
- Smart filename renaming — `YYYY-MM-DD_HHMMSS_City_Person_Camera_hash.jpg`
- InsightFace face detection — buffalo_sc CPU model, bbox + confidence stored
- HDBSCAN face clustering — periodic background job, cluster IDs linked back to faces
- Upload to library — rclone copy to OneDrive output folder
- Action log — SQLite audit trail of every pipeline action

**Frontend (Next.js)**
- Gallery — paginated photo grid (48/page), click-to-open detail lightbox
- Photo detail — full metadata panel: date, location, camera, dimensions, faces
- Search — hybrid text + CLIP semantic search with mode selector
- Faces — cluster browser with representative thumbnails, inline name labeling
- Dashboard — pipeline stats (by status), health bar, live activity feed
- Logs — paginated audit log with action-type filter
- Settings — system config display, CLIP bridge health check, source list

## Project Structure

```
photomind/
├── .github/workflows/ci.yml        # CI: Biome + Vitest + Ruff + pytest
├── deploy/
│   ├── photomind-daemon.service    # systemd unit — Python pipeline daemon
│   ├── photomind-bridge.service    # systemd unit — CLIP FastAPI bridge
│   ├── photomind-frontend.service  # systemd unit — Next.js on port 3003
│   ├── nginx/photomind.conf        # nginx reverse proxy + Tailscale TLS
│   └── env.production.template    # env var template (copy, fill, gitignore)
├── docs/
│   ├── plan.md                    # Full phased build plan
│   ├── prd.md                     # Product requirements
│   ├── techstack.md               # Tech choices with rationale
│   └── documentation.md          # Living technical reference + session log
├── frontend/                      # Next.js 15 (Bun runtime)
│   ├── src/
│   │   ├── app/
│   │   │   ├── (gallery)/         # Pages: gallery, search, faces, dashboard, logs, settings
│   │   │   └── api/               # Routes: photos, search, faces, dashboard, logs, settings
│   │   ├── components/ui/         # ShadCN components
│   │   └── lib/db/                # Drizzle schema + bun:sqlite client
│   └── tests/                     # Vitest tests (131 tests)
├── backend/                       # Python daemon + pipeline services
│   ├── src/photomind/
│   │   ├── services/              # clip, face, exif, geo, rename, dedup, meme, rclone, thumbnail
│   │   ├── worker/                # daemon, pipeline, scheduler
│   │   └── config.py             # Config loader (safe defaults for CI)
│   └── tests/                    # pytest tests (432 tests, ~92% coverage)
├── scripts/
│   ├── deploy.sh                  # Full VPS deploy: pull → build → migrate → restart
│   ├── smoke-test.sh              # 18-check smoke test against live instance
│   ├── submit-pr.sh               # Create PR + assign CodeRabbit reviewer
│   └── review-pr.sh              # Dump / reply to / merge PR with CodeRabbit
├── CLAUDE.md                      # AI agent instructions and architecture notes
└── status.md                      # Always-current project progress
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_PATH` | Absolute path to the SQLite database file | `~/photomind/photomind.db` |
| `THUMBNAILS_PATH` | Absolute path to thumbnails directory | `~/photomind/thumbnails` |
| `CLIP_BRIDGE_URL` | URL of the Python CLIP bridge service | `http://localhost:8765` |

For production, copy `deploy/env.production.template` to your deployment path and fill in values. See `docs/documentation.md` for full configuration reference.

## Development

### Commands

```bash
# Frontend
cd frontend
bun dev               # Start dev server
bun test              # Run Vitest tests
bun run lint          # Biome lint check
bun run lint:fix      # Biome lint + auto-fix
bun run db:generate   # Generate Drizzle migration files
bun run db:migrate    # Apply pending migrations
bun run db:studio     # Open Drizzle Studio (visual DB inspector)
bunx tsc --noEmit     # Type check

# Backend
cd backend
uv run pytest                             # Run all tests with coverage
uv run pytest -k "test_name" -v           # Run a single test by name
uv run ruff check src/ tests/             # Lint
uv run ruff format src/ tests/            # Format
uv run python -m photomind.worker         # Start background daemon
uv run python -m photomind.worker --scan-once  # Single scan then exit
```

### Conventions

- **Branches**: `feat/<name>`, `fix/<name>`, `chore/<name>`
- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `wip:`)
- **TDD**: Write failing tests first (`test:` commit), then implement (`feat:` commit)
- **Coverage**: Must stay ≥ 80% (enforced in CI)
- **TypeScript**: `strict: true`, no `any`
- **Python**: type hints mandatory on all functions

### PR Workflow

```bash
# Submit a PR
scripts/submit-pr.sh feat/my-feature "feat(scope): description"

# Process CodeRabbit review
scripts/review-pr.sh <PR> wait    # Wait for review
scripts/review-pr.sh <PR> dump    # Read all comments
scripts/review-pr.sh <PR> merge   # Squash merge (preserves branch)
scripts/review-pr.sh <PR> sync    # Pull latest main
```

## Deployment

```bash
# First-time setup: see deploy/nginx/photomind.conf for cert + nginx instructions

# Every deploy thereafter
scripts/deploy.sh

# Verify
scripts/smoke-test.sh https://<tailscale-hostname>
```

See `docs/documentation.md` for the full VPS setup guide.

## License

Private — personal use only.
