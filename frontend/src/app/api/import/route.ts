import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { desc } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { importJobs } from "@/lib/db/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImportJobResponse {
  id: string;
  status: "RUNNING" | "DONE" | "ERROR";
  localPath: string;
  label: string | null;
  totalCount: number | null;
  processedCount: number;
  errorCount: number;
  createdAt: number;
  finishedAt: number | null;
}

// ─── Security ─────────────────────────────────────────────────────────────────

const SAFE_ROOTS = ["/media", "/mnt", "/home"];

function isPathAllowed(resolvedPath: string): boolean {
  return SAFE_ROOTS.some((root) => resolvedPath === root || resolvedPath.startsWith(`${root}/`));
}

// ─── GET /api/import — list recent import jobs ────────────────────────────────

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const rows = await db
      .select({
        id: importJobs.id,
        status: importJobs.status,
        localPath: importJobs.localPath,
        label: importJobs.label,
        totalCount: importJobs.totalCount,
        processedCount: importJobs.processedCount,
        errorCount: importJobs.errorCount,
        createdAt: importJobs.createdAt,
        finishedAt: importJobs.finishedAt,
      })
      .from(importJobs)
      .orderBy(desc(importJobs.createdAt))
      .limit(20);

    const jobs: ImportJobResponse[] = rows.map((row) => ({
      id: row.id,
      status: row.status as "RUNNING" | "DONE" | "ERROR",
      localPath: row.localPath,
      label: row.label ?? null,
      totalCount: row.totalCount ?? null,
      processedCount: row.processedCount,
      errorCount: row.errorCount,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt ?? null,
    }));

    return NextResponse.json({ jobs }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/import] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/import — start a new import job ────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const { localPath, label } = body as Record<string, unknown>;

  // Validate localPath
  if (!localPath || typeof localPath !== "string") {
    return NextResponse.json(
      { error: "localPath is required and must be a string" },
      { status: 400 }
    );
  }

  // Resolve to prevent directory traversal
  const resolvedPath = path.resolve(localPath);

  // Security: must be under a safe root
  if (!isPathAllowed(resolvedPath)) {
    return NextResponse.json(
      { error: "Access denied: path is outside allowed directories (/media, /mnt, /home)" },
      { status: 403 }
    );
  }

  // Must exist
  if (!existsSync(resolvedPath)) {
    return NextResponse.json({ error: "Path does not exist" }, { status: 400 });
  }

  // Must be a directory
  const stat = statSync(resolvedPath);
  if (!stat.isDirectory()) {
    return NextResponse.json({ error: "Path must be a directory, not a file" }, { status: 400 });
  }

  // Generate a job ID (crypto.randomUUID is available in modern Bun/Node)
  const jobId = crypto.randomUUID();

  const dbPath =
    process.env.DATABASE_PATH ??
    path.join(process.env.HOME ?? os.homedir(), "photomind", "photomind.db");

  const backendDir = process.env.BACKEND_DIR ?? path.join(process.cwd(), "..", "backend");

  // Insert job row
  const now = Math.floor(Date.now() / 1000);
  try {
    await db.insert(importJobs).values({
      id: jobId,
      status: "RUNNING",
      localPath: resolvedPath,
      label: typeof label === "string" ? label : null,
      totalCount: null,
      processedCount: 0,
      errorCount: 0,
      createdAt: now,
      finishedAt: null,
    });
  } catch (err) {
    console.error("[POST /api/import] DB insert error:", err);
    return NextResponse.json({ error: "Failed to create import job" }, { status: 500 });
  }

  // Spawn the Python import runner as a detached background process
  const pythonScript = `
import sys, os
os.chdir(sys.argv[4])
from photomind.services.import_runner import run_import_job
from photomind.config import load_config
config = load_config()
config.database_path = sys.argv[3]
run_import_job(sys.argv[1], sys.argv[2], sys.argv[3], config)
`.trim();

  const child = spawn(
    "uv",
    [
      "run",
      "--project",
      backendDir,
      "python",
      "-c",
      pythonScript,
      jobId,
      resolvedPath,
      dbPath,
      backendDir,
    ],
    {
      detached: true,
      stdio: "ignore",
      cwd: backendDir,
    }
  );

  // Detach the child so it survives the parent process
  child.unref();

  return NextResponse.json({ jobId }, { status: 201 });
}
