# PhotoMind

> Private Google Photos alternative — processes 200k+ family photos from OneDrive, fully on-device with no cloud AI.

## Overview

PhotoMind is a self-hosted photo management system built for a family with photos scattered across multiple OneDrive accounts. It scans source drives, deduplicates, filters memes and screenshots, extracts EXIF metadata, generates CLIP embeddings for semantic search, detects and clusters faces, reverse-geocodes GPS coordinates, and renames photos into a consistent library — all on a Linux VPS with no GPU.

Originals are never modified. The processed library is written to a dedicated OneDrive output folder.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend runtime | Bun |
| Frontend framework | Next.js 16.1.7 (App Router) |
| UI components | ShadCN + Tailwind v4 |
| TS lint/format | Biome 2.4.7 |
| TS testing | Vitest 4 (via bun) |
| ORM | Drizzle ORM + `bun:sqlite` |
| Auth | Better Auth |
| Python env | uv + pyproject.toml |
| Python lint/format | Ruff |
| Python testing | pytest + pytest-cov |
| Dedup | imagehash (pHash) + SHA256 |
| OneDrive sync | rclone |
| VPN | Tailscale |
| CI | GitHub Actions (Node 24) |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) >= 1.3
- [uv](https://docs.astral.sh/uv/) >= 0.5
- [rclone](https://rclone.org/) with OneDrive remotes configured
- [Tailscale](https://tailscale.com/) (for VPS access)
- Python 3.12+

### Setup

```bash
# Clone the repo
git clone https://github.com/karthiknitt/photomind.git
cd photomind

# Frontend dependencies
cd frontend && bun install

# Backend dependencies
cd ../backend && uv sync
```

### Configuration (VPS only)

Create `config.yaml` in the project root (gitignored — never commit this):

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

### Running Locally

```bash
# Frontend dev server
cd frontend && bun dev

# Backend daemon (requires config.yaml)
cd backend && uv run python -m photomind.worker.daemon

# Database migrations (run once after clone or schema changes)
cd frontend && bun run db:generate && bun run db:migrate

# Database inspector (visual UI for SQLite)
cd frontend && bun run db:studio
```

## Features

**Phase 1 — Data Foundation (complete)**
- rclone integration — list and download files from any configured OneDrive remote
- EXIF extraction — date, GPS, camera make/model, software, dimensions
- Thumbnail generation — 400px JPEG thumbnails with EXIF orientation correction
- Action log — SQLite audit trail of every pipeline action (COPIED, SKIPPED, ERROR, etc.)
- Deduplication — exact dedup via SHA256, near-dedup via pHash (Hamming distance ≤ 10)
- Meme / screenshot detection — 5-signal weighted classifier (WhatsApp software, aspect ratio, no EXIF date, small file size, CLIP labels)

**Planned — Phase 2+**
- CLIP semantic embeddings + ChromaDB vector search
- Offline GPS reverse geocoding
- Smart filename renaming
- InsightFace face detection and HDBSCAN clustering
- Gallery and search UI
- VPS deployment with systemd

## Project Structure

```
photomind/
├── .github/workflows/ci.yml   # CI: Biome + Vitest + Ruff + pytest
├── docs/
│   ├── plan.md                # Full phased build plan
│   ├── prd.md                 # Product requirements
│   ├── techstack.md           # Tech choices with rationale
│   └── documentation.md      # Living technical reference
├── frontend/                  # Next.js 15 (Bun runtime)
│   ├── src/
│   │   ├── app/               # App Router pages + API routes
│   │   ├── components/        # ShadCN + custom components
│   │   └── lib/db/            # Drizzle schema + bun:sqlite client
│   └── tests/
├── backend/                   # Python daemon + pipeline services
│   ├── src/photomind/
│   │   ├── services/          # rclone, exif, thumbnail, action_log, dedup, meme
│   │   ├── worker/            # daemon, pipeline, scheduler (Phase 2+)
│   │   └── config.py          # Config loader (safe defaults for CI)
│   └── tests/
├── scripts/
│   ├── submit-pr.sh           # Create PR + assign CodeRabbit reviewer
│   └── review-pr.sh           # Dump / reply to / merge PR with CodeRabbit
├── CLAUDE.md                  # AI agent instructions and architecture notes
└── status.md                  # Always-current project progress
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_PATH` | Absolute path to the SQLite database file | `~/photomind/photomind.db` |

All other runtime configuration lives in `config.yaml` (see above).

## Development

### Commands

```bash
# Frontend
cd frontend
bun dev               # Start dev server
bun test              # Run Vitest tests
bun run lint          # Biome lint check
bun run lint:fix      # Biome lint + auto-fix
bun run format        # Biome format
bun run db:generate   # Generate Drizzle migration files
bun run db:migrate    # Apply pending migrations
bun run db:studio     # Open Drizzle Studio (visual DB inspector)

# Backend
cd backend
uv run pytest                          # Run all tests with coverage
uv run pytest -k "test_name" -v        # Run a single test by name
uv run ruff check src/ tests/          # Lint
uv run ruff format src/ tests/         # Format
uv run python -m photomind.worker.daemon  # Start background daemon
```

### Conventions

- **Branches**: `feat/<name>`, `fix/<name>`, `chore/<name>`
- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `wip:`)
- **TDD**: Write failing tests first, commit as `test:`, then implement, commit as `feat:`
- **Coverage**: Must stay ≥ 80% (enforced in CI)
- **TypeScript**: `strict: true`, no `any`
- **Python**: type hints mandatory on all functions

### PR Workflow

```bash
# Submit a PR (reads body from stdin)
scripts/submit-pr.sh feat/my-feature "feat(scope): description" main <<'EOF'
## What
...
## Why
...
EOF

# Process CodeRabbit review
scripts/review-pr.sh <PR> wait    # Wait for review
scripts/review-pr.sh <PR> dump    # Read all comments
scripts/review-pr.sh <PR> merge   # Squash merge (preserves branch)
scripts/review-pr.sh <PR> sync    # Pull latest main
```

## License

Private — personal use only.
