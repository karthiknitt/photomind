# PhotoMind — Product Requirements Document

_Version 1.0 — Phase 0 Bootstrap_

---

## Problem Statement

Karthik's family photos (200k+) are scattered across 3–5 OneDrive accounts with no organization,
no search, no deduplication, and no face recognition. WhatsApp forwards and screenshots pollute
the library. Google Photos is not a viable option (privacy, cost, Indian regulatory concerns).
The goal is a private, self-hosted system that processes, organizes, and serves these photos
beautifully — running on a cheap VPS over Tailscale.

---

## User Stories

### Core User: Karthik (primary)

**US-1: Browse by Timeline**
> As Karthik, I want to scroll through my photos in chronological order so I can relive
> memories in the order they happened.

Acceptance criteria:
- Photos displayed in reverse-chronological order by `date_taken`
- Infinite scroll or pagination with 48 photos per page
- Date grouping headers (e.g., "December 2024", "Christmas 2024")
- Thumbnails load fast (< 200ms) — served from local disk, not OneDrive

**US-2: Search by Memory**
> As Karthik, I want to type "beach Ooty 2023" and find relevant photos so I don't
> have to scroll through years of images.

Acceptance criteria:
- Natural language search via CLIP semantic embeddings
- Results ranked by relevance, not date
- Search response < 500ms for 200k photo library
- Empty results show friendly message, not error

**US-3: Find by Person**
> As Karthik, I want to click "Priya" and see all photos featuring my wife so I can
> compile a birthday album without manually sorting.

Acceptance criteria:
- Face clusters auto-generated via HDBSCAN
- Cluster labeling UI: see representative faces, type a name
- Once labeled, all photos in cluster are searchable by name
- Retroactive rename: files in library renamed when cluster gets labeled

**US-4: Know What Was Skipped**
> As Karthik, I want to see a full audit log of what was copied, what was skipped (and why),
> so I can trust the system and investigate edge cases.

Acceptance criteria:
- Every photo action logged: COPIED / SKIPPED_DUPLICATE / SKIPPED_MEME / SKIPPED_ERROR
- Log viewable in UI with filters (by date, action type, source)
- CSV export available

**US-5: Source Management**
> As Karthik, I want to add/remove OneDrive accounts as sources and trigger manual scans
> so I can onboard new family members' phones.

Acceptance criteria:
- Sources list in settings UI
- Enable/disable toggle per source
- "Scan now" button triggers daemon scan
- Last-scanned timestamp displayed

**US-6: Processing Status**
> As Karthik, I want to see a live dashboard of what the daemon is currently processing
> so I know the system is working and can estimate completion time.

Acceptance criteria:
- Real-time updates via SSE (Server-Sent Events)
- Shows: current file, stage, queue depth, photos processed today, errors
- Daemon pause/resume button
- Error details expandable

**US-7: Gallery Detail View**
> As Karthik, I want to click any photo and see all its metadata (date, location, camera,
> faces, tags, similar photos) so I can understand the full context.

Acceptance criteria:
- Full-size image (or max 2000px) with EXIF overlay
- Map showing GPS location (if available)
- Face thumbnails for detected faces
- CLIP-derived tags displayed
- "Similar photos" carousel (top 5 ANN results)
- Original source path shown

---

## User Journeys

### Journey 1: First-Time Setup
1. Karthik SSHes into VPS via Tailscale
2. Runs `systemctl start photomind-daemon`
3. Opens browser → navigates to `http://photomind.local` (Tailscale hostname)
4. Creates admin account (Better Auth)
5. Goes to Settings → Sources → Adds their rclone remote with scan path `Pictures/`
6. Clicks "Scan Now" — daemon starts scanning
7. Watches Processing Dashboard — sees files being queued
8. After 10 minutes, first photos appear in Gallery

### Journey 2: Daily Use
1. Morning: opens PhotoMind on phone/laptop via Tailscale
2. New photos from previous day are already processed (daemon runs hourly)
3. Browses timeline — sees yesterday's dinner photos
4. Searches "daughter school 2024" — finds correct photos
5. Creates quick album for school events

### Journey 3: Family Album Creation
1. Selects photos by date range (Christmas 2024)
2. Filters by person "Priya" + "Kids"
3. Downloads selected 45 photos as ZIP
4. Shares ZIP via WhatsApp (outside app)

### Journey 4: Investigating a Skip
1. Notices a photo is missing from gallery
2. Goes to Audit Log
3. Filters by filename
4. Sees: `SKIPPED_MEME — signals: whatsapp_software, no_exif_date`
5. Decides: this was actually a real photo — clicks "Override" (future feature)

---

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Gallery load time (100 photos) | < 1 second |
| Search latency (200k corpus) | < 500ms |
| Thumbnail serve latency | < 200ms |
| Pipeline throughput | ≥ 20 photos/minute (CPU-only) |
| Storage overhead (thumbnails) | ≤ 15% of original size |
| System uptime | ≥ 99% (personal use, acceptable downtime) |
| Max VPS RAM usage | ≤ 2GB (CLIP model + ChromaDB) |
| Privacy | Zero external API calls (all AI runs locally) |

---

## Out of Scope (v1.0)

- Video processing (Phase 3+ future)
- Multi-user support (single-user, family shares via shared login)
- Mobile app (Tailscale browser access is sufficient)
- Automatic cloud backup (rclone to OneDrive IS the backup)
- Photo editing (view-only)
- Social sharing features
- HEIC → JPEG conversion (Pillow fallback, not primary concern)

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| CLIP model too slow on CPU | Medium | ViT-B/32 benchmarked at ~2s/image on 2-core VPS — acceptable |
| InsightFace model download fails | Low | Bundle model files in repo / Dockerfile |
| OneDrive rate limits during bulk scan | Medium | rclone has built-in backoff, scan is incremental |
| 200k pHash comparisons too slow | Low | SQLite index on phash + early-exit if exact hash match |
| ChromaDB memory usage > 2GB | Medium | Use float16 embeddings, batch inserts, monitor |
| Family photos misidentified as memes | Medium | Conservative threshold, full audit log, override mechanism |

---

## Success Metrics

After Phase 4 launch:
- 100% of photos from all 3 sources scanned within 48 hours
- < 5% false-positive meme detection rate
- Face clusters created for all family members with > 20 photos
- Search returns relevant results for 10 test queries (manual evaluation)
- System runs stably for 2 weeks without intervention
