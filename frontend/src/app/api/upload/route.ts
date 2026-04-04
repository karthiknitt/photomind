import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { importJobs } from "@/lib/db/schema";

function getUploadsDir(): string {
  return (
    process.env.UPLOADS_DIR ?? path.join(process.env.HOME ?? os.homedir(), "photomind", "uploads")
  );
}

function getDbPath(): string {
  return (
    process.env.DATABASE_PATH ??
    path.join(process.env.HOME ?? os.homedir(), "photomind", "photomind.db")
  );
}

function getBackendDir(): string {
  return process.env.BACKEND_DIR ?? path.join(process.cwd(), "..", "backend");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Failed to parse form data" }, { status: 400 });
  }

  const entries = formData.getAll("files");
  const files = entries.filter((e): e is File => e instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const label = formData.get("label");

  const jobId = crypto.randomUUID();
  const stagingDir = path.join(getUploadsDir(), jobId);

  // Compute all destination paths upfront and validate each is inside stagingDir
  const destPaths: { file: File; destPath: string }[] = [];
  for (const file of files) {
    const destPath = path.join(stagingDir, path.normalize(file.name));
    if (!destPath.startsWith(stagingDir + path.sep)) {
      return NextResponse.json({ error: `Invalid file path: ${file.name}` }, { status: 400 });
    }
    destPaths.push({ file, destPath });
  }

  try {
    for (const { file, destPath } of destPaths) {
      await mkdir(path.dirname(destPath), { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(destPath, buffer);
    }
  } catch (err) {
    console.error("[POST /api/upload] Failed to write files:", err);
    return NextResponse.json({ error: "Failed to save uploaded files" }, { status: 500 });
  }

  const now = Math.floor(Date.now() / 1000);
  const dbPath = getDbPath();
  const backendDir = getBackendDir();

  try {
    await db.insert(importJobs).values({
      id: jobId,
      status: "RUNNING",
      localPath: stagingDir,
      label: typeof label === "string" && label.trim() ? label.trim() : null,
      totalCount: null,
      processedCount: 0,
      errorCount: 0,
      createdAt: now,
      finishedAt: null,
    });
  } catch (err) {
    console.error("[POST /api/upload] DB insert error:", err);
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    return NextResponse.json({ error: "Failed to create import job" }, { status: 500 });
  }

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
      stagingDir,
      dbPath,
      backendDir,
    ],
    { detached: true, stdio: "ignore", cwd: backendDir }
  );
  child.unref();

  return NextResponse.json({ jobId }, { status: 201 });
}
