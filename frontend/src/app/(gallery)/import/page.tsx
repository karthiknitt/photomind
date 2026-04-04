"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Folder, FolderOpen, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

interface FolderNode {
  entry: FilesystemEntry;
  children: FolderNode[] | null; // null = not yet loaded, [] = loaded but empty
  isOpen: boolean;
  isLoading: boolean;
}

type JobStatus = "RUNNING" | "DONE" | "ERROR";

interface ImportJob {
  id: string;
  status: JobStatus;
  localPath: string;
  label: string | null;
  totalCount: number | null;
  processedCount: number;
  errorCount: number;
  createdAt: number;
  finishedAt: number | null;
}

interface ImportJobsResponse {
  jobs: ImportJob[];
}

// ─── Upload Types ─────────────────────────────────────────────────────────────

interface UploadFile {
  file: File;
  relPath: string;
}

type UploadState = "idle" | "uploading" | "done" | "error";

// ─── Tree utilities (module-scope, no state deps) ────────────────────────────

function cloneTree(nodes: FolderNode[]): FolderNode[] {
  return nodes.map((n) => ({
    ...n,
    children: n.children ? cloneTree(n.children) : null,
  }));
}

function updateNodeInTree(
  nodes: FolderNode[],
  targetPath: string,
  updater: (node: FolderNode) => void
): boolean {
  for (const node of nodes) {
    if (node.entry.path === targetPath) {
      updater(node);
      return true;
    }
    if (node.children && updateNodeInTree(node.children, targetPath, updater)) {
      return true;
    }
  }
  return false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildBreadcrumb(selectedPath: string): string[] {
  if (!selectedPath || selectedPath === "/") return ["/"];
  const parts = selectedPath.split("/").filter(Boolean);
  return ["/", ...parts];
}

function formatTimestamp(unix: number): string {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function hasRunningJob(jobs: ImportJob[]): boolean {
  return jobs.some((j) => j.status === "RUNNING");
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: JobStatus }) {
  const classMap: Record<JobStatus, string> = {
    RUNNING:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    DONE: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
    ERROR:
      "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
  };
  return (
    <Badge variant="outline" className={`text-xs font-medium ${classMap[status]}`}>
      {status}
    </Badge>
  );
}

// ─── Folder Tree Node ─────────────────────────────────────────────────────────

interface FolderNodeProps {
  node: FolderNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}

function FolderTreeNode({ node, depth, selectedPath, onSelect, onToggle }: FolderNodeProps) {
  const isSelected = selectedPath === node.entry.path;
  const indentPx = depth * 16;

  function handleClick() {
    if (node.isOpen) {
      // Collapse
      onToggle(node.entry.path);
    } else {
      // Select + expand
      onSelect(node.entry.path);
      onToggle(node.entry.path);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition-colors ${
          isSelected
            ? "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200"
            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
        style={{ paddingLeft: `${indentPx + 8}px` }}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform duration-200 ${
            node.isOpen ? "rotate-90" : ""
          }`}
        />
        {node.isOpen ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-amber-500" />
        )}
        <span className="truncate">{node.entry.name}</span>
        {node.isLoading && (
          <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">loading…</span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {node.isOpen && node.children !== null && (
          <motion.div
            key={`children-${node.entry.path}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {node.children.length === 0 && !node.isLoading && (
              <div
                className="py-1 text-xs text-zinc-400 dark:text-zinc-500"
                style={{ paddingLeft: `${indentPx + 32}px` }}
              >
                Empty folder
              </div>
            )}
            {node.children.map((child) => (
              <FolderTreeNode
                key={child.entry.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Filesystem Browser ───────────────────────────────────────────────────────

interface FilesystemBrowserProps {
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function FilesystemBrowser({ selectedPath, onSelect }: FilesystemBrowserProps) {
  const [roots, setRoots] = useState<FolderNode[]>([]);
  const [loadingRoots, setLoadingRoots] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mutable ref for tree state so we can update it without re-render on every keystroke
  const treeRef = useRef<FolderNode[]>([]);

  const fetchEntries = useCallback(async (dirPath: string): Promise<FilesystemEntry[]> => {
    const params = new URLSearchParams({ path: dirPath });
    const res = await fetch(`/api/filesystem?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as FilesystemResponse;
    return json.entries;
  }, []);

  // Initial load: fetch roots
  const loadRoots = useCallback(async () => {
    setLoadingRoots(true);
    setError(null);
    try {
      const res = await fetch("/api/filesystem");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as FilesystemResponse;
      const nodes: FolderNode[] = json.entries.map((e) => ({
        entry: e,
        children: null,
        isOpen: false,
        isLoading: false,
      }));
      treeRef.current = nodes;
      setRoots(cloneTree(nodes));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load filesystem");
    } finally {
      setLoadingRoots(false);
    }
  }, []);

  useEffect(() => {
    void loadRoots();
  }, [loadRoots]);

  const handleToggle = useCallback(
    async (path: string) => {
      // Determine current state
      let nodeSnapshot: FolderNode | null = null;
      updateNodeInTree(treeRef.current, path, (n) => {
        nodeSnapshot = { ...n };
      });
      if (!nodeSnapshot) return;

      const snap = nodeSnapshot as FolderNode;

      if (snap.isOpen) {
        // Collapse
        updateNodeInTree(treeRef.current, path, (n) => {
          n.isOpen = false;
        });
        setRoots(cloneTree(treeRef.current));
        return;
      }

      // Expand: if children not loaded yet, fetch them
      if (snap.children === null) {
        // Mark loading
        updateNodeInTree(treeRef.current, path, (n) => {
          n.isOpen = true;
          n.isLoading = true;
        });
        setRoots(cloneTree(treeRef.current));

        try {
          const entries = await fetchEntries(path);
          const childNodes: FolderNode[] = entries.map((e) => ({
            entry: e,
            children: null,
            isOpen: false,
            isLoading: false,
          }));
          updateNodeInTree(treeRef.current, path, (n) => {
            n.children = childNodes;
            n.isLoading = false;
          });
        } catch {
          updateNodeInTree(treeRef.current, path, (n) => {
            n.children = [];
            n.isLoading = false;
          });
        }
      } else {
        // Already loaded, just open
        updateNodeInTree(treeRef.current, path, (n) => {
          n.isOpen = true;
        });
      }

      setRoots(cloneTree(treeRef.current));
    },
    [fetchEntries]
  );

  if (loadingRoots) {
    return (
      <div className="space-y-2 p-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-7 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-600 dark:text-red-400">
        Failed to load filesystem: {error}
        <button
          type="button"
          onClick={() => void loadRoots()}
          className="ml-2 underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 py-1">
      {roots.map((node) => (
        <FolderTreeNode
          key={node.entry.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onToggle={(p) => void handleToggle(p)}
        />
      ))}
    </div>
  );
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({ path }: { path: string }) {
  const parts = buildBreadcrumb(path);
  // Build stable cumulative path keys: "/", "/media", "/media/usb_drive", …
  const segmentPaths = parts.map((_, i) => (i === 0 ? "/" : `/${parts.slice(1, i + 1).join("/")}`));
  return (
    <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
      {parts.map((part, i) => (
        <span key={segmentPaths[i]} className="flex items-center gap-1">
          {i > 0 && <span className="text-zinc-300 dark:text-zinc-600">/</span>}
          <span
            className={i === parts.length - 1 ? "font-medium text-zinc-700 dark:text-zinc-300" : ""}
          >
            {part}
          </span>
        </span>
      ))}
    </div>
  );
}

// ─── Recent Imports Table ─────────────────────────────────────────────────────

interface RecentImportsProps {
  jobs: ImportJob[];
  loading: boolean;
}

function RecentImports({ jobs, loading }: RecentImportsProps) {
  if (loading && jobs.length === 0) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
        ))}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
        No imports yet. Select a folder and click Start Import.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-200 dark:border-zinc-800">
            <TableHead className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Label
            </TableHead>
            <TableHead className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Path
            </TableHead>
            <TableHead className="w-28 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Progress
            </TableHead>
            <TableHead className="w-24 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Status
            </TableHead>
            <TableHead className="w-36 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Started
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id} className="border-zinc-100 dark:border-zinc-800">
              <TableCell className="text-sm text-zinc-800 dark:text-zinc-200">
                {job.label ? (
                  job.label
                ) : (
                  <span className="italic text-zinc-400 dark:text-zinc-500">(unlabeled)</span>
                )}
              </TableCell>
              <TableCell
                className="max-w-xs truncate font-mono text-xs text-zinc-500 dark:text-zinc-400"
                title={job.localPath}
              >
                {job.localPath}
              </TableCell>
              <TableCell className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
                {job.processedCount} / {job.totalCount !== null ? job.totalCount : "?"}
              </TableCell>
              <TableCell>
                <StatusBadge status={job.status} />
              </TableCell>
              <TableCell className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                {formatTimestamp(job.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Upload Dropzone ──────────────────────────────────────────────────────────

interface UploadDropzoneProps {
  onJobStarted: () => void;
}

function UploadDropzone({ onJobStarted }: UploadDropzoneProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [label, setLabel] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => {
    return () => {
      xhrRef.current?.abort();
    };
  }, []);

  function collectFiles(fileList: FileList): UploadFile[] {
    return Array.from(fileList).map((f) => ({
      file: f,
      relPath: f.webkitRelativePath || f.name,
    }));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) setFiles(collectFiles(e.target.files));
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      setFiles(collectFiles(e.dataTransfer.files));
    }
  }

  const totalBytes = files.reduce((sum, f) => sum + f.file.size, 0);

  function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  async function handleUpload() {
    if (files.length === 0) return;
    setUploadState("uploading");
    setUploadProgress(0);
    setErrorMsg(null);

    const fd = new FormData();
    for (const { file, relPath } of files) {
      fd.append("files", new File([file], relPath, { type: file.type }));
    }
    if (label.trim()) fd.append("label", label.trim());

    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open("POST", "/api/upload");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status === 201) {
            resolve();
            return;
          }
          let msg = `HTTP ${xhr.status}`;
          try {
            msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg;
          } catch {
            // ignore non-JSON error body
          }
          reject(new Error(msg));
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(fd);
      });

      xhrRef.current = null;
      setUploadState("done");
      setFiles([]);
      setLabel("");
      setUploadProgress(0);
      onJobStarted();
    } catch (err) {
      setUploadState("error");
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
    }
  }

  return (
    <div className="space-y-4">
      <section
        aria-label="File drop zone"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-colors ${
          isDragOver
            ? "border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/20"
            : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/50"
        }`}
      >
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Drag &amp; drop photos or a folder here
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            Browse Files
          </Button>
          <Button variant="outline" size="sm" onClick={() => folderInputRef.current?.click()}>
            Browse Folder
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      </section>

      {files.length > 0 && (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-medium">
            {files.length} file{files.length !== 1 ? "s" : ""}
          </span>{" "}
          selected <span className="text-zinc-400">({formatBytes(totalBytes)})</span>
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <label
            htmlFor="upload-label"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Label <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span>
          </label>
          <input
            id="upload-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Summer Trip 2024"
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
          />
        </div>
        <Button
          onClick={() => void handleUpload()}
          disabled={files.length === 0 || uploadState === "uploading"}
          size="lg"
          className="shrink-0"
        >
          {uploadState === "uploading" ? "Uploading…" : "Upload & Import"}
        </Button>
      </div>

      <div aria-live="polite">
        {uploadState === "uploading" && (
          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <motion.div
                className="h-full bg-blue-500"
                initial={{ width: 0 }}
                animate={{ width: `${uploadProgress}%` }}
                transition={{ ease: "easeOut", duration: 0.3 }}
              />
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Uploading… {uploadProgress}%</p>
          </div>
        )}

        {uploadState === "done" && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
            Upload complete — processing started. See progress below.
          </div>
        )}
        {uploadState === "error" && errorMsg && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserRefreshKey = useRef(0);
  const [browserKey, setBrowserKey] = useState(0);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/import");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ImportJobsResponse;
      setJobs(json.jobs);
    } catch {
      // silently ignore poll errors
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    const running = hasRunningJob(jobs);
    if (running && pollingRef.current === null) {
      pollingRef.current = setInterval(() => {
        void fetchJobs();
      }, 3_000);
    } else if (!running && pollingRef.current !== null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current !== null) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [jobs, fetchJobs]);

  async function handleStartImport() {
    if (!selectedPath) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localPath: selectedPath, label: label.trim() || null }),
      });
      if (!res.ok) {
        const errJson = (await res.json()) as { error?: string };
        throw new Error(errJson.error ?? `HTTP ${res.status}`);
      }
      setSelectedPath(null);
      setLabel("");
      await fetchJobs();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to start import");
    } finally {
      setSubmitting(false);
    }
  }

  function handleRefreshBrowser() {
    browserRefreshKey.current += 1;
    setBrowserKey(browserRefreshKey.current);
    setSelectedPath(null);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Import Photos
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Browse server folders (USB / NAS / rclone mounts) or upload from your computer.
        </p>
      </div>

      <Tabs defaultValue="server">
        <TabsList className="mb-4">
          <TabsTrigger value="server">Browse Server</TabsTrigger>
          <TabsTrigger value="upload">Upload from Computer</TabsTrigger>
        </TabsList>

        <TabsContent value="server" className="space-y-4">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Browse Folder
              </h2>
              <Button variant="outline" size="sm" onClick={handleRefreshBrowser}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
            <Card>
              <CardContent className="p-0">
                {selectedPath && (
                  <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                    <Breadcrumb path={selectedPath} />
                  </div>
                )}
                <div className="max-h-72 overflow-y-auto px-1 py-1">
                  <FilesystemBrowser
                    key={browserKey}
                    selectedPath={selectedPath}
                    onSelect={setSelectedPath}
                  />
                </div>
              </CardContent>
            </Card>
            {selectedPath ? (
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                <span className="font-medium">Folder selected:</span>{" "}
                <span className="font-mono">{selectedPath}</span>
              </p>
            ) : (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">
                Click a folder above to select it for import.
              </p>
            )}
          </section>

          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <label
                  htmlFor="import-label"
                  className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Label{" "}
                  <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span>
                </label>
                <input
                  id="import-label"
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Summer Trip 2024"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
                />
              </div>
              <Button
                onClick={() => void handleStartImport()}
                disabled={!selectedPath || submitting}
                size="lg"
                className="shrink-0"
              >
                {submitting ? "Starting…" : "Start Import"}
              </Button>
            </div>
            {submitError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
                {submitError}
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="upload">
          <UploadDropzone onJobStarted={() => void fetchJobs()} />
        </TabsContent>
      </Tabs>

      <hr className="border-zinc-200 dark:border-zinc-800" />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Recent Imports
          </h2>
          {hasRunningJob(jobs) && (
            <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              Live updating
            </span>
          )}
        </div>
        <RecentImports jobs={jobs} loading={jobsLoading} />
      </section>
    </div>
  );
}
