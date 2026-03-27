import { eq } from "drizzle-orm";
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

// ─── GET /api/import/[id] — get single job status ────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

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
      .where(eq(importJobs.id, id));

    if (rows.length === 0) {
      return NextResponse.json({ error: "Import job not found" }, { status: 404 });
    }

    const row = rows[0];
    const job: ImportJobResponse = {
      id: row.id,
      status: row.status as "RUNNING" | "DONE" | "ERROR",
      localPath: row.localPath,
      label: row.label ?? null,
      totalCount: row.totalCount ?? null,
      processedCount: row.processedCount,
      errorCount: row.errorCount,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt ?? null,
    };

    return NextResponse.json(job, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/import/${id}] DB error:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
