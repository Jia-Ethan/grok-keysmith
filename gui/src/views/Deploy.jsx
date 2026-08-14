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

  return (
    <div>
      <FadeIn><h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("deploy.title")}</h1></FadeIn>
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
        {file ? <p className="mt-3 break-all font-mono text-xs">{file}</p> : null}
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
          <dl className="grid gap-2">
            <Row label="source" value={plan.prompt_source} />
            <Row label="sha256" value={plan.prompt_sha256} />
            <Row label="token" value={binding?.token} />
            <Row label="rule" value={`${plan.rule?.kind} ${plan.rule?.path || ""}`} />
            <Row label="compat" value={plan.config?.will_write_markers ? "write markers" : "—"} />
            <Row label="stripped" value={(plan.config?.stripped_external_compat || []).join(", ") || "—"} />
            <Row label="hooks" value={(plan.hooks_to_isolate || []).join(", ") || "—"} />
            <Row label="external .disabled" value={(plan.external_disabled_untouched || []).join(", ") || "—"} />
          </dl>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("deploy.confirm")}
        body={[plan?.prompt_sha256, binding?.token].filter(Boolean).join("\n")}
        danger
        confirmDisabled={busy}
        onConfirm={applyDeploy}
      />
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[140px_1fr] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-xs">{value || "—"}</dd>
    </div>
  );
}
