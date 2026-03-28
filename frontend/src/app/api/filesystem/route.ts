import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FilesystemEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface FilesystemResponse {
  path: string;
  entries: FilesystemEntry[];
  parent: string | null;
}

// ─── Security ─────────────────────────────────────────────────────────────────

const SAFE_ROOTS = ["/media", "/mnt", "/home"];

function isPathAllowed(resolvedPath: string): boolean {
  return SAFE_ROOTS.some((root) => resolvedPath === root || resolvedPath.startsWith(`${root}/`));
}

/**
 * Compute the parent path for the given path.
 * Returns null if the parent would be outside all safe roots (e.g. parent of /media is /).
 */
function getParent(resolvedPath: string): string | null {
  if (SAFE_ROOTS.includes(resolvedPath)) {
    // At a safe root — parent is / which is not allowed
    return null;
  }
  const parent = path.dirname(resolvedPath);
  if (isPathAllowed(parent)) {
    return parent;
  }
  return null;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export function GET(req: NextRequest): NextResponse {
  const { searchParams } = new URL(req.url);
  const rawPath = searchParams.get("path");

  // No path param or "/" → return list of safe roots that exist
  if (!rawPath || rawPath === "/") {
    const entries: FilesystemEntry[] = SAFE_ROOTS.filter((root) => existsSync(root)).map(
      (root) => ({
        name: root.slice(1), // strip leading slash: "/media" → "media"
        path: root,
        is_dir: true,
      })
    );

    const body: FilesystemResponse = {
      path: "/",
      entries,
      parent: null,
    };
    return NextResponse.json(body);
  }

  // Resolve the path to prevent traversal attacks
  const resolvedPath = path.resolve(rawPath);

  // Security check — must be under a safe root
  if (!isPathAllowed(resolvedPath)) {
    return NextResponse.json(
      { error: "Access denied: path is outside allowed directories" },
      { status: 403 }
    );
  }

  // Check existence
  if (!existsSync(resolvedPath)) {
    return NextResponse.json({ error: "Path not found" }, { status: 404 });
  }

  // Read directory entries
  let dirents: import("node:fs").Dirent<string>[];
  try {
    dirents = readdirSync(resolvedPath, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return NextResponse.json({ error: "Cannot read directory" }, { status: 404 });
  }

  // Filter: directories only, no hidden entries
  const entries: FilesystemEntry[] = dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({
      name: d.name,
      path: path.join(resolvedPath, d.name),
      is_dir: true,
    }));

  const body: FilesystemResponse = {
    path: resolvedPath,
    entries,
    parent: getParent(resolvedPath),
  };

  return NextResponse.json(body);
}
