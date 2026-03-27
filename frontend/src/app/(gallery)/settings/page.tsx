"use client";

import { useCallback, useEffect, useState } from "react";
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

interface SourceRow {
  id: string;
  remoteName: string;
  displayName: string;
  scanPath: string;
  lastScannedAt: number | null;
  enabled: boolean;
}

interface SettingsData {
  system: SystemConfig;
  sources: SourceRow[];
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatLastScanned(ts: number | null): string {
  if (ts === null) return "Never";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

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

function PhotoSourcesCard({ sources }: { sources: SourceRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Photo Sources</CardTitle>
        <CardDescription>rclone remotes scanned by the PhotoMind daemon.</CardDescription>
      </CardHeader>
      <CardContent>
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No photo sources configured. Add sources to{" "}
            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">config.yaml</code>{" "}
            and restart the daemon.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Remote</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Scan Path</TableHead>
                <TableHead>Last Scanned</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((source) => (
                <TableRow key={source.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {source.remoteName}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">
                    {source.displayName}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {source.scanPath}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatLastScanned(source.lastScannedAt)}
                  </TableCell>
                  <TableCell>
                    {source.enabled ? (
                      <Badge variant="secondary">Enabled</Badge>
                    ) : (
                      <Badge variant="outline">Disabled</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
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

      <PhotoSourcesCard sources={settings.sources} />
    </div>
  );
}
