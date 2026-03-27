"use client";

import { useCallback, useEffect, useState } from "react";
import { AddCloudSource } from "@/components/add-cloud-source";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SystemConfig {
  databasePath: string;
  thumbnailsPath: string;
  clipBridgeUrl: string;
}

// Source as returned by GET /api/sources
interface ApiSourceRow {
  remote: string;
  label: string;
  scan_path: string;
  provider: string;
  status: "active";
}

interface SettingsData {
  system: SystemConfig;
}

interface BridgeOk {
  status: "ok";
  url: string;
  latencyMs: number;
}

interface BridgeError {
  status: "error";
  url: string;
  error: string;
}

type BridgeStatus = BridgeOk | BridgeError;

type HealthCheckState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "done"; bridge: BridgeStatus };

// ─── Sub-components ───────────────────────────────────────────────────────────

function SystemConfigCard({ system }: { system: SystemConfig }) {
  const rows: { label: string; value: string }[] = [
    { label: "Database", value: system.databasePath },
    { label: "Thumbnails", value: system.thumbnailsPath },
    { label: "CLIP Bridge", value: system.clipBridgeUrl },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>System Configuration</CardTitle>
        <CardDescription>
          Read-only paths and service URLs configured via environment variables.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Setting</TableHead>
              <TableHead>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="font-medium text-foreground">{row.label}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {row.value}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BridgeHealthCard({ clipBridgeUrl }: { clipBridgeUrl: string }) {
  const [health, setHealth] = useState<HealthCheckState>({ phase: "idle" });

  const checkHealth = useCallback(async () => {
    setHealth({ phase: "checking" });
    try {
      const res = await fetch("/api/settings/health");
      const data = (await res.json()) as { bridge: BridgeStatus };
      setHealth({ phase: "done", bridge: data.bridge });
    } catch {
      setHealth({
        phase: "done",
        bridge: {
          status: "error",
          url: clipBridgeUrl,
          error: "Failed to reach health endpoint",
        },
      });
    }
  }, [clipBridgeUrl]);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  const isChecking = health.phase === "checking";
  const bridge = health.phase === "done" ? health.bridge : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>CLIP Bridge Health</CardTitle>
        <CardDescription>Status of the Python semantic search service.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Status indicator dot */}
              {health.phase === "idle" || isChecking ? (
                <span className="size-2.5 rounded-full bg-muted-foreground/40" />
              ) : bridge?.status === "ok" ? (
                <span className="size-2.5 rounded-full bg-green-500" />
              ) : (
                <span className="size-2.5 rounded-full bg-destructive" />
              )}

              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {health.phase === "idle"
                    ? "Not checked"
                    : isChecking
                      ? "Checking..."
                      : bridge?.status === "ok"
                        ? "Online"
                        : "Offline"}
                </span>
                <span className="text-xs text-muted-foreground font-mono">{clipBridgeUrl}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {bridge?.status === "ok" && (
                <span className="text-sm text-muted-foreground">{bridge.latencyMs}ms</span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void checkHealth()}
                disabled={isChecking}
              >
                {isChecking ? "Checking..." : "Check Now"}
              </Button>
            </div>
          </div>

          {bridge?.status === "error" && (
            <p className="text-xs text-destructive font-mono bg-destructive/5 rounded-lg px-3 py-2">
              {bridge.error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Skeleton rows for loading state ──────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {[1, 2].map((i) => (
        <TableRow key={i}>
          <TableCell>
            <div className="h-3 w-32 rounded bg-muted animate-pulse" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-24 rounded bg-muted animate-pulse" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-20 rounded bg-muted animate-pulse" />
          </TableCell>
          <TableCell>
            <div className="h-5 w-14 rounded bg-muted animate-pulse" />
          </TableCell>
          <TableCell>
            <div className="h-6 w-6 rounded bg-muted animate-pulse" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function PhotoSourcesCard() {
  const [sources, setSources] = useState<ApiSourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sources");
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = (await res.json()) as { sources: ApiSourceRow[] };
      setSources(data.sources);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSources();
  }, [fetchSources]);

  async function handleDelete(remote: string) {
    const confirmed = confirm(
      `Remove source "${remote}"? This will delete its rclone config and stop scanning it.`
    );
    if (!confirmed) return;

    setDeleting(remote);
    try {
      const res = await fetch("/api/sources", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: remote }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? "Failed to delete source");
        return;
      }
      await fetchSources();
    } catch {
      alert("Network error while deleting source");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Photo Sources</CardTitle>
            <CardDescription>rclone remotes scanned by the PhotoMind daemon.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            + Add Cloud Source
          </Button>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive py-2">{error}</p>}
          {!error && !loading && sources.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No photo sources configured yet.{" "}
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="text-primary underline underline-offset-2 hover:opacity-80"
              >
                Add a cloud source
              </button>{" "}
              to start scanning.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Remote Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Scan Path</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonRows />
                ) : (
                  sources.map((source) => (
                    <TableRow key={source.remote}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {source.remote}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {source.provider}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {source.scan_path}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {source.status === "active" ? "Active" : source.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => void handleDelete(source.remote)}
                          disabled={deleting === source.remote}
                          aria-label={`Remove ${source.remote}`}
                          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                        >
                          {deleting === source.remote ? (
                            <span className="text-xs">…</span>
                          ) : (
                            <span aria-hidden="true">✕</span>
                          )}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddCloudSource
        open={addOpen}
        onOpenChange={setAddOpen}
        onSuccess={() => void fetchSources()}
      />
    </>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json() as Promise<SettingsData>)
      .then(setSettings)
      .catch(() => setError("Failed to load settings."));
  }, []);

  if (error) {
    return <div className="py-12 text-center text-sm text-muted-foreground">{error}</div>;
  }

  if (!settings) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          System configuration and service health.
        </p>
      </div>

      <Separator />

      <SystemConfigCard system={settings.system} />

      <BridgeHealthCard clipBridgeUrl={settings.system.clipBridgeUrl} />

      <PhotoSourcesCard />
    </div>
  );
}
