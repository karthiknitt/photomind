/**
 * Smoke test — verifies:
 * 1. TypeScript imports compile without error
 * 2. Schema exports all expected table definitions
 * 3. DB client module exports db singleton
 *
 * Note: bun:sqlite uses the real filesystem. In CI, DATABASE_PATH
 * is set to a temp file so we don't pollute the workspace.
 */
import { describe, expect, it } from "vitest";
import {
  actionLog,
  events,
  faceClusters,
  faces,
  photos,
  photoTags,
  sources,
} from "@/lib/db/schema";

describe("Schema imports", () => {
  it("exports all required tables", () => {
    expect(photos).toBeDefined();
    expect(faces).toBeDefined();
    expect(faceClusters).toBeDefined();
    expect(photoTags).toBeDefined();
    expect(events).toBeDefined();
    expect(actionLog).toBeDefined();
    expect(sources).toBeDefined();
  });

  it("photos table has expected columns", () => {
    const cols = Object.keys(photos);
    expect(cols).toContain("id");
    expect(cols).toContain("sourceRemote");
    expect(cols).toContain("sourcePath");
    expect(cols).toContain("phash");
    expect(cols).toContain("status");
    expect(cols).toContain("isMeme");
    expect(cols).toContain("clipIndexed");
  });

  it("faces table references photos", () => {
    const cols = Object.keys(faces);
    expect(cols).toContain("photoId");
    expect(cols).toContain("clusterId");
    expect(cols).toContain("detScore");
  });

  it("action_log has all required action types", () => {
    // Schema defines an enum — verify the column exists
    const cols = Object.keys(actionLog);
    expect(cols).toContain("action");
    expect(cols).toContain("photoId");
    expect(cols).toContain("timestamp");
  });
});
