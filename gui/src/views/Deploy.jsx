import React from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  cliExecute,
  fetchPreview,
  fetchStatus,
  grokInspect,
  isTauriMissing,
} from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TechnicalDetails } from "@/components/TechnicalDetails";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/FadeIn";
import { useAppState } from "@/hooks/useAppState";
import { beginExclusiveOperation, endOperation, setLastStatus } from "@/lib/store";
import { getSettings } from "@/lib/settings";
import {
  comparePreviewBindings,
  createPreviewBinding,
  verifyGrokInspect,
} from "@/lib/contract";
import { cn } from "@/lib/utils";
import { deployConfirmBody, deployPreviewSummary } from "@/lib/previewPresentation";

export function Deploy() {
  const { t } = useTranslation();
  const { cliInfo } = useAppState();
  const [source, setSource] = React.useState("bundled");
  const [file, setFile] = React.useState("");
  const [preview, setPreview] = React.useState(null);
  const [binding, setBinding] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState("");
  const outsideTauri = typeof window !== "undefined" && !window.__TAURI_INTERNALS__;
  const cliReady = outsideTauri || (cliInfo.checked && Boolean(cliInfo.path));
  const cliUnavailable = !outsideTauri && cliInfo.checked && !cliInfo.path;

  // 三步流程：1 选择内容 → 2 查看预览 → 3 确认执行
  const step = confirmOpen || (preview && binding) ? (confirmOpen ? 3 : 2) : 1;

  const deployArgs = React.useCallback((dryRun) => {
    const args = dryRun ? ["--dry-run"] : [];
    if (source === "local" && file) args.push("--file", file);
    return args;
  }, [source, file]);

  const intent = React.useCallback(() => ({
    action: "deploy",
    source,
    file: source === "local" ? file : "",
  }), [source, file]);

  function invalidatePreview() {
    setPreview(null);
    setBinding(null);
    setConfirmOpen(false);
  }

  async function makePreview() {
    if (!cliReady) {
      setError(cliInfo.error || t("common.cliUnavailable"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const settings = getSettings();
      const envelope = await fetchPreview(deployArgs(true));
      if (!envelope.gate.ok) {
        invalidatePreview();
        setError(envelope.gate.reason);
        return;
      }
      const nextBinding = await createPreviewBinding({ envelope, intent: intent(), settings });
      setPreview(envelope);
      setBinding(nextBinding);
    } catch (err) {
      if (isTauriMissing(err)) return;
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function applyDeploy() {
    if (!cliReady) {
      setError(cliInfo.error || t("common.cliUnavailable"));
      return;
    }
    const lease = beginExclusiveOperation();
    if (!lease) return;
    setBusy(true);
    setError("");
    try {
      const settings = getSettings();
      const freshPreview = await fetchPreview(deployArgs(true));
      if (!freshPreview.gate.ok) {
        invalidatePreview();
        setError(freshPreview.gate.reason);
        return;
      }
      const freshBinding = await createPreviewBinding({
        envelope: freshPreview,
        intent: intent(),
        settings,
      });
      const comparison = comparePreviewBindings(binding, freshBinding);
      if (!comparison.ok) {
        invalidatePreview();
        setError(t("deploy.staleFields", { fields: comparison.changed.join(", ") || "token" }));
        return;
      }

      const previewToken = freshPreview.plan?.confirmation_token;
      if (!previewToken) {
        invalidatePreview();
        setError(t("deploy.staleFields", { fields: "confirmation_token" }));
        return;
      }
      const result = await cliExecute([
        ...deployArgs(false),
        "--yes",
        "--expected-preview-token",
        previewToken,
      ]);
      if (!result.ok) {
        setError((result.diagnostics || []).join("\n") || t("deploy.failed"));
        return;
      }

      const verificationErrors = [];
      let verifiedStatus = null;
      try {
        verifiedStatus = await fetchStatus();
        if (!verifiedStatus.ok || verifiedStatus.result?.state !== "active-aligned") {
          verificationErrors.push(t("deploy.verifyStatus", {
            state: verifiedStatus.result?.state || "unknown",
          }));
        }
      } catch (verifyError) {
        verificationErrors.push(String(verifyError.message || verifyError));
      }
      try {
        const inspect = await grokInspect();
        verifyGrokInspect(inspect, verifiedStatus?.target?.grok_dir);
      } catch (verifyError) {
        verificationErrors.push(`${t("deploy.verifyInspect")}: ${String(verifyError.message || verifyError)}`);
      }

      setLastStatus(verifiedStatus);
      invalidatePreview();
      if (verificationErrors.length) {
        setError(`${t("deploy.verifyFailed")}\n${verificationErrors.join("\n")}`);
      } else {
        toast.success(result.result?.deployment_id || t("deploy.complete"));
      }
    } catch (err) {
      if (isTauriMissing(err)) return;
      setError(String(err.message || err));
    } finally {
      endOperation(lease);
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  async function chooseFile() {
    setError("");
    try {
      const selected = await open({ multiple: false, filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (typeof selected === "string") {
        setFile(selected);
        invalidatePreview();
      }
    } catch (err) {
      if (!isTauriMissing(err)) setError(String(err.message || err));
    }
  }

  const plan = preview?.plan;
  const grokDir = preview?.target?.grok_dir || "";
  const sourceLabel = source === "bundled" ? t("deploy.bundled") : (file || t("deploy.local"));
  const summary = plan ? deployPreviewSummary(plan, sourceLabel, t) : null;

  return (
    <div>
      <FadeIn><h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("deploy.title")}</h1></FadeIn>

      <ol className="mb-6 flex flex-wrap items-center gap-3 text-sm" aria-label={t("deploy.title")}>
        {[1, 2, 3].map((n) => (
          <li
            key={n}
            aria-current={step === n ? "step" : undefined}
            className="flex items-center gap-2"
          >
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-xs font-medium",
                n < step && "bg-[var(--ok-soft)] text-[var(--ok)]",
                n === step && "bg-accent-soft text-accent",
                n > step && "bg-elevated text-muted-foreground",
              )}
            >
              {n < step ? "✓" : n}
            </span>
            <span className={cn(n === step ? "text-foreground" : "text-muted-foreground")}>
              {t(`deploy.step${n}`)}
            </span>
            {n < 3 ? <span className="text-muted-foreground" aria-hidden="true">→</span> : null}
          </li>
        ))}
      </ol>

      <div className="card-glass p-5" aria-busy={busy}>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("deploy.source")}>
          <Button
            variant={source === "bundled" ? "default" : "outline"}
            aria-pressed={source === "bundled"}
            onClick={() => { setSource("bundled"); invalidatePreview(); }}
          >
            {t("deploy.bundled")}
          </Button>
          <Button
            variant={source === "local" ? "default" : "outline"}
            aria-pressed={source === "local"}
            onClick={() => { setSource("local"); invalidatePreview(); }}
          >
            {t("deploy.local")}
          </Button>
          {source === "local" && (
            <Button variant="secondary" onClick={chooseFile}>{t("deploy.choose")}</Button>
          )}
        </div>
        {file ? (
          <p className="mt-3 truncate font-mono text-xs text-muted-foreground" title={file}>{file}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={makePreview} disabled={busy || !cliReady || (source === "local" && !file)}>{t("deploy.preview")}</Button>
          <Button
            variant="destructive"
            disabled={!preview || !binding || busy || !cliReady}
            onClick={() => setConfirmOpen(true)}
          >
            {t("deploy.confirm")}
          </Button>
        </div>
      </div>

      {cliUnavailable ? (
        <pre className="log-block mt-4" role="alert">{cliInfo.error || t("common.cliUnavailable")}</pre>
      ) : null}
      {error ? <pre className="log-block mt-4" role="alert">{error}</pre> : null}

      {plan && (
        <div className="card-glass mt-4 p-5 text-sm">
          <h2 className="text-sm font-semibold">{t("deploy.step2")}</h2>
          <ul className="mt-3 grid gap-2">
            {summary.lines.map((line, index) => <li key={index}>{line}</li>)}
            {summary.blocked ? <li className="text-danger">{t("deploy.blocked")}</li> : null}
          </ul>
          <TechnicalDetails>
            <pre className="log-block mt-2">{JSON.stringify(plan, null, 2)}</pre>
          </TechnicalDetails>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("deploy.confirm")}
        body={deployConfirmBody({ grokDir, sourceLabel }, t)}
        danger
        confirmDisabled={busy}
        onConfirm={applyDeploy}
      />
    </div>
  );
}
