import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SourceEntry {
  remote: string;
  scan_path: string;
  label: string;
}

interface ConfigYaml {
  sources?: SourceEntry[];
  [key: string]: unknown;
}

interface SourceResponse {
  remote: string;
  label: string;
  scan_path: string;
  provider: string;
  status: "active";
}

interface ApikeyPostBody {
  type: "apikey";
  provider: "r2" | "s3";
  name: string;
  scan_path: string;
  label: string;
  params: Record<string, string>;
}

interface OauthPostBody {
  type: "oauth";
  provider: "drive" | "dropbox" | "onedrive";
  name: string;
  scan_path: string;
  label: string;
  token: string;
}

type PostBody = ApikeyPostBody | OauthPostBody;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RCLONE = "rclone";

function getConfigPath(): string {
  return process.env.CONFIG_PATH ?? path.join(process.env.HOME ?? "/root", "config.yaml");
}

function readConfig(): ConfigYaml {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return { sources: [] };
  }
  const raw = readFileSync(configPath, "utf-8");
  return (parseYaml(raw) as ConfigYaml) ?? { sources: [] };
}

function writeConfig(config: ConfigYaml): void {
  writeFileSync(getConfigPath(), stringifyYaml(config));
}

/**
 * Detect the provider label by calling rclone config show <remote> and
 * parsing the type field from the output.
 */
function detectProvider(remoteName: string): string {
  const result = spawnSync(RCLONE, ["config", "show", remoteName], {
    encoding: "buffer",
  });
  const output = result.stdout.toString("utf-8");
  const match = /type\s*=\s*(\S+)/i.exec(output);
  if (!match) return "Unknown";
  const rcloneType = match[1].toLowerCase();
  return rcloneTypeToProvider(rcloneType);
}

function rcloneTypeToProvider(rcloneType: string): string {
  switch (rcloneType) {
    case "drive":
      return "Google Drive";
    case "onedrive":
      return "OneDrive";
    case "dropbox":
      return "Dropbox";
    case "s3":
      return "S3";
    default:
      return rcloneType;
  }
}

/**
 * Write an OAuth remote directly to the rclone config file to avoid exposing
 * the token as a command-line argument visible in process listings.
 */
function writeOAuthRemoteConfig(name: string, rcloneType: string, token: string): void {
  const fileResult = spawnSync(RCLONE, ["config", "file"], { encoding: "buffer" });
  const lines = fileResult.stdout
    .toString("utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const configPath = lines[lines.length - 1];
  if (!configPath || !path.isAbsolute(configPath)) {
    throw new Error("Cannot determine rclone config file path");
  }

  // Ensure directory exists (first-run scenario)
  mkdirSync(path.dirname(configPath), { recursive: true });

  // Remove any stale section, then append the new one
  spawnSync(RCLONE, ["config", "delete", name], { encoding: "buffer" });

  const section = [`\n[${name}]`, `type = ${rcloneType}`, `token = ${token}`, ""].join("\n");
  appendFileSync(configPath, section);
}

function providerToRcloneType(provider: string): string {
  switch (provider) {
    case "drive":
      return "drive";
    case "dropbox":
      return "dropbox";
    case "onedrive":
      return "onedrive";
    case "r2":
      return "s3";
    case "s3":
      return "s3";
    default:
      return provider;
  }
}

// ─── GET /api/sources ─────────────────────────────────────────────────────────

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const config = readConfig();
    const sourcesRaw = config.sources ?? [];

    const sources: SourceResponse[] = sourcesRaw.map((entry) => ({
      remote: entry.remote,
      label: entry.label,
      scan_path: entry.scan_path,
      provider: detectProvider(entry.remote),
      status: "active",
    }));

    return NextResponse.json({ sources }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/sources] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/sources ────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { type, name, scan_path, label } = body as {
    type?: string;
    name?: string;
    scan_path?: string;
    label?: string;
  };

  if (!type || !name || !scan_path || !label) {
    return NextResponse.json(
      { error: "Missing required fields: type, name, scan_path, label" },
      { status: 400 }
    );
  }

  const provider = (body as ApikeyPostBody).provider ?? (body as OauthPostBody).provider ?? "";
  const rcloneType = providerToRcloneType(provider);

  // Build rclone config create args
  const configCreateArgs: string[] = ["config", "create", name, rcloneType];

  if (body.type === "apikey") {
    const apikeyBody = body as ApikeyPostBody;
    if (apikeyBody.provider === "r2") {
      configCreateArgs.push(
        "provider=Cloudflare",
        `access_key_id=${apikeyBody.params.access_key_id ?? ""}`,
        `secret_access_key=${apikeyBody.params.secret_access_key ?? ""}`,
        `endpoint=https://${apikeyBody.params.account_id ?? ""}.r2.cloudflarestorage.com`
      );
    } else {
      for (const [k, v] of Object.entries(apikeyBody.params)) {
        configCreateArgs.push(`${k}=${v}`);
      }
    }

    const result = spawnSync(RCLONE, configCreateArgs, { encoding: "buffer" });
    if (result.status !== 0) {
      const stderr = result.stderr.toString("utf-8");
      console.error("[POST /api/sources] rclone config create failed:", stderr);
      return NextResponse.json(
        { error: `rclone config create failed: ${stderr}` },
        { status: 500 }
      );
    }
  } else if (body.type === "oauth") {
    // Write token directly to rclone config file — avoids exposing the token
    // as a command-line argument (visible in ps / /proc/*/cmdline)
    const oauthBody = body as OauthPostBody;
    try {
      writeOAuthRemoteConfig(name, rcloneType, oauthBody.token);
    } catch (err) {
      console.error("[POST /api/sources] Failed to write rclone OAuth config:", err);
      return NextResponse.json({ error: "Failed to create rclone remote" }, { status: 500 });
    }
  } else {
    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  }

  // Append source to config.yaml
  const config = readConfig();
  if (!config.sources) config.sources = [];
  config.sources.push({ remote: name, scan_path, label });
  writeConfig(config);

  return NextResponse.json({ ok: true }, { status: 201 });
}

// ─── DELETE /api/sources ──────────────────────────────────────────────────────

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  let body: { name?: string };
  try {
    body = (await request.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name } = body;
  if (!name) {
    return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
  }

  // Check source exists in config.yaml
  const config = readConfig();
  const sources = config.sources ?? [];
  const idx = sources.findIndex((s) => s.remote === name);
  if (idx === -1) {
    return NextResponse.json(
      { error: `Source '${name}' not found in config.yaml` },
      { status: 404 }
    );
  }

  // Remove from rclone config (log failure but continue — remote may already be gone)
  const deleteResult = spawnSync(RCLONE, ["config", "delete", name], { encoding: "buffer" });
  if (deleteResult.status !== 0) {
    console.warn(
      `[DELETE /api/sources] rclone config delete failed for ${name}:`,
      deleteResult.stderr.toString("utf-8")
    );
  }

  // Remove from config.yaml
  sources.splice(idx, 1);
  config.sources = sources;
  writeConfig(config);

  return NextResponse.json({ ok: true }, { status: 200 });
}
