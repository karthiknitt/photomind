"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type Provider = "onedrive" | "drive" | "dropbox" | "r2" | "s3";
type Step = "provider" | "credentials" | "details";

interface ProviderMeta {
  id: Provider;
  label: string;
  category: "oauth" | "apikey";
}

const PROVIDERS: ProviderMeta[] = [
  { id: "onedrive", label: "OneDrive", category: "oauth" },
  { id: "drive", label: "Google Drive", category: "oauth" },
  { id: "dropbox", label: "Dropbox", category: "oauth" },
  { id: "r2", label: "Cloudflare R2", category: "apikey" },
  { id: "s3", label: "Amazon S3", category: "apikey" },
];

interface R2Params {
  access_key_id: string;
  secret_access_key: string;
  account_id: string;
  bucket: string;
}

interface S3Params {
  access_key_id: string;
  secret_access_key: string;
  region: string;
}

interface OAuthState {
  authUrl: string | null;
  token: string;
}

interface DetailsState {
  name: string;
  scan_path: string;
  label: string;
}

export interface AddCloudSourceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// ─── Animation variants ───────────────────────────────────────────────────────

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 80 : -80,
    opacity: 0,
  }),
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      {Array.from({ length: total }).map((_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: static step count, index is stable
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i < current
              ? "w-6 bg-primary"
              : i === current
                ? "w-6 bg-primary/80"
                : "w-3 bg-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium text-foreground">{label}</p>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50"
    />
  );
}

// ─── Step 1: Provider selection ───────────────────────────────────────────────

function ProviderStep({
  selected,
  onSelect,
}: {
  selected: Provider | null;
  onSelect: (p: Provider) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Choose your cloud storage provider.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className={`rounded-lg border px-3 py-3 text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-ring/50 ${
              selected === p.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-foreground hover:bg-muted"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step 2a: API key credentials (R2 / S3) ──────────────────────────────────

function ApiKeyStep({
  provider,
  r2Params,
  setR2Params,
  s3Params,
  setS3Params,
  onTest,
  testing,
  testResult,
}: {
  provider: Provider;
  r2Params: R2Params;
  setR2Params: React.Dispatch<React.SetStateAction<R2Params>>;
  s3Params: S3Params;
  setS3Params: React.Dispatch<React.SetStateAction<S3Params>>;
  onTest: () => void;
  testing: boolean;
  testResult: { ok: boolean; error?: string } | null;
}) {
  if (provider === "r2") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">Enter your Cloudflare R2 credentials.</p>
        <FieldRow label="Access Key ID">
          <TextInput
            value={r2Params.access_key_id}
            onChange={(v) => setR2Params((p) => ({ ...p, access_key_id: v }))}
            placeholder="AKIAIOSFODNN7EXAMPLE"
          />
        </FieldRow>
        <FieldRow label="Secret Access Key">
          <TextInput
            type="password"
            value={r2Params.secret_access_key}
            onChange={(v) => setR2Params((p) => ({ ...p, secret_access_key: v }))}
            placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
          />
        </FieldRow>
        <FieldRow label="Account ID">
          <TextInput
            value={r2Params.account_id}
            onChange={(v) => setR2Params((p) => ({ ...p, account_id: v }))}
            placeholder="a1b2c3d4e5f6..."
          />
        </FieldRow>
        <FieldRow label="Bucket">
          <TextInput
            value={r2Params.bucket}
            onChange={(v) => setR2Params((p) => ({ ...p, bucket: v }))}
            placeholder="my-photos-bucket"
          />
        </FieldRow>
        <TestConnectionButton onTest={onTest} testing={testing} testResult={testResult} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Enter your Amazon S3 credentials.</p>
      <FieldRow label="Access Key ID">
        <TextInput
          value={s3Params.access_key_id}
          onChange={(v) => setS3Params((p) => ({ ...p, access_key_id: v }))}
          placeholder="AKIAIOSFODNN7EXAMPLE"
        />
      </FieldRow>
      <FieldRow label="Secret Access Key">
        <TextInput
          type="password"
          value={s3Params.secret_access_key}
          onChange={(v) => setS3Params((p) => ({ ...p, secret_access_key: v }))}
          placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
        />
      </FieldRow>
      <FieldRow label="Region">
        <TextInput
          value={s3Params.region}
          onChange={(v) => setS3Params((p) => ({ ...p, region: v }))}
          placeholder="us-east-1"
        />
      </FieldRow>
      <TestConnectionButton onTest={onTest} testing={testing} testResult={testResult} />
    </div>
  );
}

function TestConnectionButton({
  onTest,
  testing,
  testResult,
}: {
  onTest: () => void;
  testing: boolean;
  testResult: { ok: boolean; error?: string } | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="sm" onClick={onTest} disabled={testing}>
        {testing ? "Testing..." : "Test Connection"}
      </Button>
      {testResult !== null && (
        <p
          className={`text-xs px-3 py-2 rounded-lg font-mono ${
            testResult.ok
              ? "bg-green-500/10 text-green-700 dark:text-green-400"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {testResult.ok ? "Connection successful" : (testResult.error ?? "Connection failed")}
        </p>
      )}
    </div>
  );
}

// ─── Step 2b: OAuth flow ─────────────────────────────────────────────────────

function OAuthStep({
  provider,
  oauthState,
  setOauthState,
  onGenerateUrl,
  generatingUrl,
  urlError,
}: {
  provider: Provider;
  oauthState: OAuthState;
  setOauthState: React.Dispatch<React.SetStateAction<OAuthState>>;
  onGenerateUrl: () => void;
  generatingUrl: boolean;
  urlError: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Connect your{" "}
        {provider === "onedrive" ? "OneDrive" : provider === "drive" ? "Google Drive" : "Dropbox"}{" "}
        account via OAuth.
      </p>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Step 1 — Generate auth URL
        </p>
        <Button variant="outline" size="sm" onClick={onGenerateUrl} disabled={generatingUrl}>
          {generatingUrl ? "Generating..." : "Generate Auth URL"}
        </Button>
        {urlError && (
          <p className="text-xs text-destructive font-mono bg-destructive/10 px-2 py-1 rounded">
            {urlError}
          </p>
        )}
        {oauthState.authUrl && (
          <a
            href={oauthState.authUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-xs text-primary underline underline-offset-2 hover:opacity-80"
          >
            {oauthState.authUrl}
          </a>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Step 2 — Sign in and copy the code
        </p>
        <p className="text-xs text-muted-foreground">
          Open the URL above in your browser, sign in, then paste the code shown below.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Step 3 — Paste your code
        </p>
        <textarea
          value={oauthState.token}
          onChange={(e) => setOauthState((s) => ({ ...s, token: e.target.value }))}
          placeholder="Paste the authorization code or JSON token here..."
          rows={3}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/50 font-mono resize-none"
        />
      </div>
    </div>
  );
}

// ─── Step 3: Name + Scan Path + Label ────────────────────────────────────────

function DetailsStep({
  details,
  setDetails,
}: {
  details: DetailsState;
  setDetails: React.Dispatch<React.SetStateAction<DetailsState>>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Name this source and set the scan path on the remote.
      </p>
      <FieldRow label="Remote Name">
        <TextInput
          value={details.name}
          onChange={(v) => setDetails((d) => ({ ...d, name: v.replace(/[^a-zA-Z0-9_]/g, "_") }))}
          placeholder="gdrive_karthik"
        />
        <p className="text-xs text-muted-foreground">
          Alphanumeric and underscores only. Used as the rclone remote identifier.
        </p>
      </FieldRow>
      <FieldRow label="Scan Path">
        <TextInput
          value={details.scan_path}
          onChange={(v) => setDetails((d) => ({ ...d, scan_path: v }))}
          placeholder="/Photos"
        />
      </FieldRow>
      <FieldRow label="Label (optional)">
        <TextInput
          value={details.label}
          onChange={(v) => setDetails((d) => ({ ...d, label: v }))}
          placeholder="My Google Drive"
        />
      </FieldRow>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const STEP_ORDER: Step[] = ["provider", "credentials", "details"];

export function AddCloudSource({ open, onOpenChange, onSuccess }: AddCloudSourceProps) {
  const [step, setStep] = useState<Step>("provider");
  const [direction, setDirection] = useState(1);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);

  // API-key credentials
  const [r2Params, setR2Params] = useState<R2Params>({
    access_key_id: "",
    secret_access_key: "",
    account_id: "",
    bucket: "",
  });
  const [s3Params, setS3Params] = useState<S3Params>({
    access_key_id: "",
    secret_access_key: "",
    region: "",
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  // OAuth state
  const [oauthState, setOauthState] = useState<OAuthState>({ authUrl: null, token: "" });
  const [generatingUrl, setGeneratingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  // Details
  const [details, setDetails] = useState<DetailsState>({ name: "", scan_path: "", label: "" });

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function resetAll() {
    setStep("provider");
    setDirection(1);
    setSelectedProvider(null);
    setR2Params({ access_key_id: "", secret_access_key: "", account_id: "", bucket: "" });
    setS3Params({ access_key_id: "", secret_access_key: "", region: "" });
    setTesting(false);
    setTestResult(null);
    setOauthState({ authUrl: null, token: "" });
    setGeneratingUrl(false);
    setUrlError(null);
    setDetails({ name: "", scan_path: "", label: "" });
    setSaving(false);
    setSaveError(null);
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) resetAll();
    onOpenChange(isOpen);
  }

  function goForward() {
    setDirection(1);
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) {
      setStep(STEP_ORDER[idx + 1]);
    }
  }

  function goBack() {
    setDirection(-1);
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) {
      setStep(STEP_ORDER[idx - 1]);
    }
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleTestConnection() {
    if (!selectedProvider) return;
    const tempName = `__photomind_test_${Date.now()}`;
    setTesting(true);
    setTestResult(null);

    try {
      // Create temp rclone config via POST /api/sources, then test it
      const params =
        selectedProvider === "r2"
          ? {
              access_key_id: r2Params.access_key_id,
              secret_access_key: r2Params.secret_access_key,
              account_id: r2Params.account_id,
            }
          : {
              access_key_id: s3Params.access_key_id,
              secret_access_key: s3Params.secret_access_key,
              region: s3Params.region,
            };

      const createRes = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "apikey",
          provider: selectedProvider,
          name: tempName,
          scan_path: "/",
          label: "test",
          params,
        }),
      });

      if (!createRes.ok) {
        const data = (await createRes.json()) as { error?: string };
        setTestResult({ ok: false, error: data.error ?? "Failed to create temp config" });
        return;
      }

      const testRes = await fetch("/api/sources/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: tempName }),
      });
      const testData = (await testRes.json()) as { ok: boolean; error?: string };
      setTestResult(testData);

      // Cleanup temp config
      await fetch("/api/sources", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: tempName }),
      });
    } catch {
      setTestResult({ ok: false, error: "Network error during connection test" });
    } finally {
      setTesting(false);
    }
  }

  async function handleGenerateUrl() {
    if (!selectedProvider) return;
    setGeneratingUrl(true);
    setUrlError(null);
    try {
      const res = await fetch(`/api/sources/oauth-auth?provider=${selectedProvider}`);
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setUrlError(data.error ?? "Failed to generate URL");
      } else {
        setOauthState((s) => ({ ...s, authUrl: data.url ?? null }));
      }
    } catch {
      setUrlError("Network error");
    } finally {
      setGeneratingUrl(false);
    }
  }

  async function handleSave() {
    if (!selectedProvider) return;
    setSaving(true);
    setSaveError(null);

    const providerMeta = PROVIDERS.find((p) => p.id === selectedProvider);
    if (!providerMeta) return;

    try {
      let body: object;

      if (providerMeta.category === "oauth") {
        body = {
          type: "oauth",
          provider: selectedProvider,
          name: details.name,
          scan_path: details.scan_path,
          label: details.label || details.name,
          token: oauthState.token,
        };
      } else {
        const params =
          selectedProvider === "r2"
            ? {
                access_key_id: r2Params.access_key_id,
                secret_access_key: r2Params.secret_access_key,
                account_id: r2Params.account_id,
              }
            : {
                access_key_id: s3Params.access_key_id,
                secret_access_key: s3Params.secret_access_key,
                region: s3Params.region,
              };

        body = {
          type: "apikey",
          provider: selectedProvider,
          name: details.name,
          scan_path: details.scan_path,
          label: details.label || details.name,
          params,
        };
      }

      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setSaveError(data.error ?? "Failed to save source");
        return;
      }

      onSuccess();
      handleOpenChange(false);
    } catch {
      setSaveError("Network error while saving");
    } finally {
      setSaving(false);
    }
  }

  // ── Validation ───────────────────────────────────────────────────────────────

  const providerMeta = selectedProvider ? PROVIDERS.find((p) => p.id === selectedProvider) : null;
  const stepIndex = STEP_ORDER.indexOf(step);

  function canAdvanceFromProvider() {
    return selectedProvider !== null;
  }

  function canAdvanceFromCredentials() {
    if (!providerMeta) return false;
    if (providerMeta.category === "oauth") {
      return oauthState.token.trim().length > 0;
    }
    if (selectedProvider === "r2") {
      return (
        r2Params.access_key_id.trim() !== "" &&
        r2Params.secret_access_key.trim() !== "" &&
        r2Params.account_id.trim() !== ""
      );
    }
    return s3Params.access_key_id.trim() !== "" && s3Params.secret_access_key.trim() !== "";
  }

  function canSave() {
    return details.name.trim() !== "" && details.scan_path.trim() !== "";
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const stepTitles: Record<Step, string> = {
    provider: "Choose Provider",
    credentials: "Connect Account",
    details: "Name & Scan Path",
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg overflow-hidden" showCloseButton>
        <DialogHeader>
          <StepIndicator current={stepIndex} total={3} />
          <DialogTitle>{stepTitles[step]}</DialogTitle>
        </DialogHeader>

        {/* Animated step content */}
        <div className="relative min-h-[220px]">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="w-full"
            >
              {step === "provider" && (
                <ProviderStep selected={selectedProvider} onSelect={setSelectedProvider} />
              )}

              {step === "credentials" &&
                providerMeta?.category === "apikey" &&
                selectedProvider && (
                  <ApiKeyStep
                    provider={selectedProvider as "r2" | "s3"}
                    r2Params={r2Params}
                    setR2Params={setR2Params}
                    s3Params={s3Params}
                    setS3Params={setS3Params}
                    onTest={() => void handleTestConnection()}
                    testing={testing}
                    testResult={testResult}
                  />
                )}

              {step === "credentials" && providerMeta?.category === "oauth" && selectedProvider && (
                <OAuthStep
                  provider={selectedProvider as "onedrive" | "drive" | "dropbox"}
                  oauthState={oauthState}
                  setOauthState={setOauthState}
                  onGenerateUrl={() => void handleGenerateUrl()}
                  generatingUrl={generatingUrl}
                  urlError={urlError}
                />
              )}

              {step === "details" && <DetailsStep details={details} setDetails={setDetails} />}
            </motion.div>
          </AnimatePresence>
        </div>

        {saveError && (
          <p className="text-xs text-destructive font-mono bg-destructive/10 px-3 py-2 rounded-lg">
            {saveError}
          </p>
        )}

        <DialogFooter>
          {stepIndex > 0 && (
            <Button variant="outline" onClick={goBack} disabled={saving}>
              Back
            </Button>
          )}

          {step !== "details" && (
            <Button
              onClick={goForward}
              disabled={
                step === "provider" ? !canAdvanceFromProvider() : !canAdvanceFromCredentials()
              }
            >
              Next
            </Button>
          )}

          {step === "details" && (
            <Button onClick={() => void handleSave()} disabled={!canSave() || saving}>
              {saving ? "Saving..." : "Save Source"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
