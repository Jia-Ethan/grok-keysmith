import React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cliExecute, fetchPreview, fetchStatus, isTauriMissing } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/FadeIn";
import { useAppState } from "@/hooks/useAppState";
import { beginExclusiveOperation, endOperation, setLastStatus } from "@/lib/store";
import { getSettings } from "@/lib/settings";
import { comparePreviewBindings, createPreviewBinding } from "@/lib/contract";

const PREVIEW_ARGS = {
  uninstall: ["--uninstall"],
  restore: ["--restore-hooks"],
  recover: ["--recover"],
};

const APPLY_ARGS = {
  uninstall: ["--uninstall", "--yes"],
  restore: ["--restore-hooks", "--yes"],
  recover: ["--recover", "--yes"],
};

export function Manage() {
  const { t } = useTranslation();
  const { cliInfo } = useAppState();
  const [preview, setPreview] = React.useState(null);
  const [binding, setBinding] = React.useState(null);
  const [kind, setKind] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState("");
  const [backups, setBackups] = React.useState([]);
  const outsideTauri = typeof window !== "undefined" && !window.__TAURI_INTERNALS__;
  const cliReady = outsideTauri || (cliInfo.checked && Boolean(cliInfo.path));
  const cliUnavailable = !outsideTauri && cliInfo.checked && !cliInfo.path;

  const loadStatus = React.useCallback(async () => {
    if (!cliReady) return null;
    try {
      const envelope = await fetchStatus();
      setError("");
      setBackups(envelope.result?.backups || []);
      setLastStatus(envelope);
      return envelope;
    } catch (err) {
      if (!isTauriMissing(err)) setError(String(err.message || err));
      return null;
    }
  }, [cliReady]);

  React.useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  function invalidatePreview() {
    setPreview(null);
    setBinding(null);
    setConfirmOpen(false);
  }

  function intent(nextKind) {
    return { action: nextKind, args: PREVIEW_ARGS[nextKind] };
  }

  async function previewOp(nextKind) {
    if (!cliReady) {
      setError(cliInfo.error || t("common.cliUnavailable"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const settings = getSettings();
      const envelope = await fetchPreview(PREVIEW_ARGS[nextKind]);
      if (!envelope.gate.ok) {
        invalidatePreview();
        setError(envelope.gate.reason || (envelope.diagnostics || []).join("\n"));
        return;
      }
      const nextBinding = await createPreviewBinding({
        envelope,
        intent: intent(nextKind),
        settings,
      });
      setKind(nextKind);
      setPreview(envelope);
      setBinding(nextBinding);
      setConfirmOpen(true);
    } catch (err) {
      if (isTauriMissing(err)) return;
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!kind || !binding) return;
    const lease = beginExclusiveOperation();
    if (!lease) return;
    setBusy(true);
    setError("");
    try {
      const settings = getSettings();
      const freshPreview = await fetchPreview(PREVIEW_ARGS[kind]);
      if (!freshPreview.gate.ok) {
        invalidatePreview();
        setError(freshPreview.gate.reason || (freshPreview.diagnostics || []).join("\n"));
        return;
      }
      const freshBinding = await createPreviewBinding({
        envelope: freshPreview,
        intent: intent(kind),
        settings,
      });
      const comparison = comparePreviewBindings(binding, freshBinding);
      if (!comparison.ok) {
        invalidatePreview();
        setError(t("manage.staleFields", { fields: comparison.changed.join(", ") || "token" }));
        return;
      }

      const previewToken = freshPreview.plan?.confirmation_token;
      if (!previewToken) {
        invalidatePreview();
        setError(t("manage.staleFields", { fields: "confirmation_token" }));
        return;
      }
      const result = await cliExecute([
        ...APPLY_ARGS[kind],
        "--expected-preview-token",
        previewToken,
      ]);
      if (!result.ok) {
        setError((result.diagnostics || []).join("\n") || t("manage.failed"));
        return;
      }

      let status = null;
      const verificationErrors = [];
      try {
        status = await fetchStatus();
        const state = status.result?.state || "unknown";
        const valid = status.ok && (
          (kind === "uninstall" && state === "not-installed")
          || (kind === "recover" && state !== "recovery-required")
          || (kind === "restore" && !["conflict", "recovery-required"].includes(state))
        );
        if (!valid) verificationErrors.push(t("manage.verifyStatus", { state }));
      } catch (verifyError) {
        verificationErrors.push(String(verifyError.message || verifyError));
      }

      if (status) {
        setLastStatus(status);
        setBackups(status.result?.backups || []);
      } else {
        setLastStatus(null);
      }
      invalidatePreview();
      if (verificationErrors.length) {
        setError(`${t("manage.verifyFailed")}\n${verificationErrors.join("\n")}`);
      } else {
        toast.success(t("manage.complete", { operation: t(`manage.operation.${kind}`) }));
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

  return (
    <div>
      <FadeIn><h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("manage.title")}</h1></FadeIn>
      <div className="card-glass flex flex-wrap gap-2 p-5" aria-busy={busy}>
        <Button variant="destructive" disabled={busy || !cliReady} onClick={() => previewOp("uninstall")}>
          {t("manage.uninstall")}
        </Button>
        <Button variant="outline" disabled={busy || !cliReady} onClick={() => previewOp("restore")}>
          {t("manage.restoreHooks")}
        </Button>
        <Button variant="warning" disabled={busy || !cliReady} onClick={() => previewOp("recover")}>
          {t("manage.recover")}
        </Button>
      </div>
      {cliUnavailable ? (
        <pre className="log-block mt-4" role="alert">{cliInfo.error || t("common.cliUnavailable")}</pre>
      ) : null}
      {error ? <pre className="log-block mt-4" role="alert">{error}</pre> : null}
      <div className="card-glass mt-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{t("manage.backups")}</h2>
          <Button variant="ghost" size="sm" onClick={loadStatus} disabled={busy || !cliReady}>{t("common.refresh")}</Button>
        </div>
        <pre className="log-block mt-3">{(backups || []).join("\n") || "—"}</pre>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={kind ? t(`manage.operation.${kind}`) : ""}
        body={preview ? [JSON.stringify(preview.plan || {}, null, 2), binding?.token].filter(Boolean).join("\n") : ""}
        danger={kind === "uninstall"}
        confirmDisabled={busy}
        onConfirm={apply}
      />
    </div>
  );
}
