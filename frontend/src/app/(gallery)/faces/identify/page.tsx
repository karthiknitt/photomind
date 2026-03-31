"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FaceRow } from "@/components/face-crop";
import { FaceCrop } from "@/components/face-crop";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClusterRow {
  id: string;
  label: string | null;
  photoCount: number;
  createdAt: number;
}

interface SimilarCluster {
  id: string;
  avgSimilarity: number;
  photoCount: number;
  representativeFaceId: string;
}

// ─── Wizard state machine ─────────────────────────────────────────────────────
// labeling:  show current cluster, "Who is this?" input
// suggesting: show similarity comparison, "Is this also [name]?" prompt
// done:       all clusters processed

type WizardPhase =
  | { type: "loading" }
  | { type: "labeling"; cluster: ClusterRow; clusterFaces: FaceRow[]; knownPeople: ClusterRow[] }
  | {
      type: "suggesting";
      labeledCluster: ClusterRow;
      suggestions: SimilarCluster[];
      suggestionIndex: number;
      candidateFaces: FaceRow[];
      labeledFaces: FaceRow[];
    }
  | { type: "done"; labeled: number };

// ─── Mini SplitPanel for wizard ───────────────────────────────────────────────

interface InlineSplitProps {
  clusterId: string;
  faces: FaceRow[];
  onSplit: (newClusterId: string, newFaces: FaceRow[]) => void;
  onCancel: () => void;
}

function InlineSplit({ clusterId, faces, onSplit, onCancel }: InlineSplitProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [splitting, setSplitting] = useState(false);
  const [label, setLabel] = useState("");

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleSplit = async () => {
    if (selected.size === 0) return;
    setSplitting(true);
    try {
      const res = await fetch(`/api/faces/clusters/${clusterId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faceIds: [...selected], label: label || undefined }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = (await res.json()) as { newCluster: { id: string } };
      // faces that were split out
      const splitFaces = faces.filter((f) => selected.has(f.id));
      onSplit(data.newCluster.id, splitFaces);
    } catch {
      setSplitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
      <p className="mb-3 text-sm text-amber-800 dark:text-amber-300">
        Select faces that belong to a <strong>different person</strong>, then split them out.
      </p>
      <div className="flex flex-wrap gap-2">
        {faces.map((f) => (
          <FaceCrop
            key={f.id}
            face={f}
            selected={selected.has(f.id)}
            onToggle={() => toggle(f.id)}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name for split cluster (optional)"
          className="flex-1 rounded border border-zinc-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
        />
        <button
          type="button"
          onClick={handleSplit}
          disabled={selected.size === 0 || splitting}
          className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {splitting
            ? "Splitting…"
            : `Split ${selected.size} face${selected.size === 1 ? "" : "s"}`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Wizard page ──────────────────────────────────────────────────────────────

export default function IdentifyPage() {
  const [phase, setPhase] = useState<WizardPhase>({ type: "loading" });
  const [showSplit, setShowSplit] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [labeling, setLabeling] = useState(false);
  const [suggestingAction, setSuggestingAction] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Load next unlabeled cluster
  const loadNext = useCallback(
    async (knownPeople: ClusterRow[]) => {
      setPhase({ type: "loading" });
      setShowSplit(false);
      setNameInput("");

      try {
        const res = await fetch("/api/faces/clusters?label=null&limit=1&orderBy=photoCount");
        if (!res.ok) throw new Error(`API error ${res.status}`);
        const data = (await res.json()) as { clusters: ClusterRow[]; total: number };

        setProgress((p) => ({ ...p, total: data.total + p.done }));

        if (data.clusters.length === 0) {
          setPhase({ type: "done", labeled: progress.done });
          return;
        }

        const cluster = data.clusters[0];

        // Fetch faces for this cluster
        const facesRes = await fetch(`/api/faces/clusters/${cluster.id}/faces`);
        const facesData = (await facesRes.json()) as { faces: FaceRow[] };

        setPhase({
          type: "labeling",
          cluster,
          clusterFaces: facesData.faces,
          knownPeople,
        });

        setTimeout(() => nameInputRef.current?.focus(), 50);
      } catch {
        setPhase({ type: "done", labeled: progress.done });
      }
    },
    [progress.done]
  );

  // Load known people (labeled clusters) once
  const [knownPeople, setKnownPeople] = useState<ClusterRow[]>([]);

  useEffect(() => {
    async function init() {
      const res = await fetch("/api/faces/clusters?label=set&limit=50");
      if (!res.ok) return;
      const data = (await res.json()) as { clusters: ClusterRow[]; total: number };
      const people = data.clusters;
      setKnownPeople(people);
      setProgress({ done: 0, total: 0 });
      await loadNext(people);
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadNext]);

  // Label the current cluster and fetch suggestions
  const handleLabel = useCallback(
    async (clusterId: string, label: string, currentFaces: FaceRow[]) => {
      if (!label.trim()) return;
      setLabeling(true);
      try {
        const patchRes = await fetch(`/api/faces/clusters/${clusterId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: label.trim() }),
        });
        if (!patchRes.ok) throw new Error(`PATCH error ${patchRes.status}`);

        const updatedCluster = (await patchRes.json()) as ClusterRow;
        const newKnown = [...knownPeople.filter((p) => p.id !== clusterId), updatedCluster];
        setKnownPeople(newKnown);
        setProgress((p) => ({ ...p, done: p.done + 1 }));

        // Fetch similarity suggestions
        const simRes = await fetch(`/api/faces/clusters/${clusterId}/similar`);
        const simData = (await simRes.json()) as {
          clusters: SimilarCluster[];
          bridgeUnavailable?: boolean;
        };

        if (simData.clusters.length === 0) {
          await loadNext(newKnown);
          return;
        }

        // Load first candidate's faces
        const first = simData.clusters[0];
        const candRes = await fetch(`/api/faces/clusters/${first.id}/faces`);
        const candData = (await candRes.json()) as { faces: FaceRow[] };

        setPhase({
          type: "suggesting",
          labeledCluster: updatedCluster,
          suggestions: simData.clusters,
          suggestionIndex: 0,
          candidateFaces: candData.faces,
          labeledFaces: currentFaces,
        });
      } finally {
        setLabeling(false);
      }
    },
    [knownPeople, loadNext]
  );

  // Advance to next suggestion or next cluster
  const advanceSuggestion = useCallback(
    async (phase: WizardPhase & { type: "suggesting" }, newKnown: ClusterRow[]) => {
      const nextIdx = phase.suggestionIndex + 1;
      if (nextIdx >= phase.suggestions.length) {
        await loadNext(newKnown);
        return;
      }
      const next = phase.suggestions[nextIdx];
      const candRes = await fetch(`/api/faces/clusters/${next.id}/faces`);
      const candData = (await candRes.json()) as { faces: FaceRow[] };
      setPhase({
        ...phase,
        suggestionIndex: nextIdx,
        candidateFaces: candData.faces,
      });
    },
    [loadNext]
  );

  const handleYes = useCallback(async () => {
    if (phase.type !== "suggesting") return;
    setSuggestingAction(true);
    try {
      const candidate = phase.suggestions[phase.suggestionIndex];
      await fetch(`/api/faces/clusters/${phase.labeledCluster.id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceClusterId: candidate.id }),
      });
      await advanceSuggestion(phase, knownPeople);
    } finally {
      setSuggestingAction(false);
    }
  }, [phase, knownPeople, advanceSuggestion]);

  const handleNo = useCallback(async () => {
    if (phase.type !== "suggesting") return;
    setSuggestingAction(true);
    try {
      const candidate = phase.suggestions[phase.suggestionIndex];
      await fetch("/api/faces/pairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterIdA: phase.labeledCluster.id,
          clusterIdB: candidate.id,
          isSame: false,
        }),
      });
      await advanceSuggestion(phase, knownPeople);
    } finally {
      setSuggestingAction(false);
    }
  }, [phase, knownPeople, advanceSuggestion]);

  const handleSkipSuggestion = useCallback(async () => {
    if (phase.type !== "suggesting") return;
    await advanceSuggestion(phase, knownPeople);
  }, [phase, knownPeople, advanceSuggestion]);

  // ─── Render ───────────────────────────────────────────────────────────────

  const progressPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Identify People</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Label each cluster — the app will learn and suggest matches.
          </p>
        </div>
        <Link
          href="/faces"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Back to all faces
        </Link>
      </div>

      {/* Progress bar */}
      {progress.total > 0 && (
        <div className="mb-6">
          <div className="mb-1 flex justify-between text-xs text-zinc-500">
            <span>{progress.done} labeled</span>
            <span>{progress.total - progress.done} remaining</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Loading */}
      {phase.type === "loading" && (
        <div className="py-16 text-center text-sm text-zinc-400">Loading next cluster…</div>
      )}

      {/* Done */}
      {phase.type === "done" && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-6 py-10 text-center dark:border-green-800 dark:bg-green-950/30">
          <div className="text-4xl">🎉</div>
          <h2 className="mt-3 text-xl font-semibold text-green-800 dark:text-green-300">
            All done!
          </h2>
          <p className="mt-1 text-sm text-green-700 dark:text-green-400">
            {progress.done > 0
              ? `You labeled ${progress.done} cluster${progress.done === 1 ? "" : "s"}.`
              : "No unlabeled clusters remaining."}
          </p>
          <Link
            href="/faces"
            className="mt-5 inline-block rounded bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            View all faces →
          </Link>
        </div>
      )}

      {/* Labeling phase */}
      {phase.type === "labeling" && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          {/* Cluster info */}
          <div className="mb-4 flex items-center justify-between">
            <span className="text-xs text-zinc-400">
              {phase.cluster.photoCount} photo{phase.cluster.photoCount === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() => setShowSplit(!showSplit)}
              className="text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400"
            >
              {showSplit ? "▲ Hide split" : "✂ Split this cluster"}
            </button>
          </div>

          {/* Face crops */}
          {phase.clusterFaces.length > 0 ? (
            <div className="mb-5 flex flex-wrap gap-2">
              {phase.clusterFaces.slice(0, 20).map((f) => (
                <FaceCrop key={f.id} face={f} size={88} />
              ))}
              {phase.clusterFaces.length > 20 && (
                <span className="self-center text-xs text-zinc-400">
                  +{phase.clusterFaces.length - 20} more
                </span>
              )}
            </div>
          ) : (
            <p className="mb-5 text-sm text-zinc-400">No face crops available.</p>
          )}

          {/* Inline split */}
          {showSplit && (
            <div className="mb-5">
              <InlineSplit
                clusterId={phase.cluster.id}
                faces={phase.clusterFaces}
                onSplit={(_newId, _splitFaces) => {
                  // After split, reload the same cluster with remaining faces
                  setShowSplit(false);
                  // Refresh faces
                  fetch(`/api/faces/clusters/${phase.cluster.id}/faces`)
                    .then((r) => r.json())
                    .then((d: { faces: FaceRow[] }) => {
                      setPhase((p) =>
                        p.type === "labeling" ? { ...p, clusterFaces: d.faces } : p
                      );
                    })
                    .catch(() => {});
                }}
                onCancel={() => setShowSplit(false)}
              />
            </div>
          )}

          {/* Who is this? */}
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Who is this?
            </p>

            {/* Known people chips */}
            {phase.knownPeople.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {phase.knownPeople.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    disabled={labeling}
                    onClick={() =>
                      handleLabel(phase.cluster.id, person.label ?? "", phase.clusterFaces)
                    }
                    className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                  >
                    {person.label}
                  </button>
                ))}
              </div>
            )}

            {/* New name input */}
            <div className="flex gap-2">
              <input
                ref={nameInputRef}
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && nameInput.trim()) {
                    handleLabel(phase.cluster.id, nameInput, phase.clusterFaces);
                  }
                }}
                placeholder="Type a new name…"
                maxLength={100}
                className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
              />
              <button
                type="button"
                onClick={() => handleLabel(phase.cluster.id, nameInput, phase.clusterFaces)}
                disabled={!nameInput.trim() || labeling}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {labeling ? "Saving…" : "Label"}
              </button>
            </div>
          </div>

          {/* Skip */}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => loadNext(phase.knownPeople)}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Skip →
            </button>
          </div>
        </div>
      )}

      {/* Suggesting phase */}
      {phase.type === "suggesting" &&
        (() => {
          const suggestion = phase.suggestions[phase.suggestionIndex];
          return (
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-zinc-400">
                  Suggestion {phase.suggestionIndex + 1} of {phase.suggestions.length}
                </span>
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                  {suggestion.avgSimilarity}% match
                </span>
              </div>

              <h2 className="mb-5 text-lg font-semibold text-zinc-800 dark:text-zinc-100">
                Is this also{" "}
                <span className="text-blue-600 dark:text-blue-400">
                  {phase.labeledCluster.label}
                </span>
                ?
              </h2>

              {/* Side-by-side comparison */}
              <div className="mb-6 grid grid-cols-2 gap-6">
                <div>
                  <p className="mb-2 text-center text-xs font-medium text-zinc-500">
                    {phase.labeledCluster.label}
                  </p>
                  <div className="flex flex-wrap justify-center gap-1">
                    {phase.labeledFaces.slice(0, 4).map((f) => (
                      <FaceCrop key={f.id} face={f} size={80} />
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-center text-xs font-medium text-zinc-500">
                    Unknown ({suggestion.photoCount} photos)
                  </p>
                  <div className="flex flex-wrap justify-center gap-1">
                    {phase.candidateFaces.slice(0, 4).map((f) => (
                      <FaceCrop key={f.id} face={f} size={80} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleYes}
                  disabled={suggestingAction}
                  className="flex-1 rounded bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {suggestingAction ? "…" : "✓ Yes, same person"}
                </button>
                <button
                  type="button"
                  onClick={handleNo}
                  disabled={suggestingAction}
                  className="flex-1 rounded bg-red-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
                >
                  {suggestingAction ? "…" : "✗ No, different"}
                </button>
                <button
                  type="button"
                  onClick={handleSkipSuggestion}
                  disabled={suggestingAction}
                  className="rounded border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Skip
                </button>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
