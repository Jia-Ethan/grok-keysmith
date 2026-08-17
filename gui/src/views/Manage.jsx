import React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Trash2, History, LifeBuoy } from "lucide-react";
import { cliExecute, fetchPreview, fetchStatus, isTauriMissing } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TechnicalDetails } from "@/components/TechnicalDetails";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FadeIn } from "@/components/FadeIn";
import { useAppState } from "@/hooks/useAppState";
import { beginExclusiveOperation, endOperation, setLastStatus } from "@/lib/store";
import { getSettings } from "@/lib/settings";
import { comparePreviewBindings, createPreviewBinding } from "@/lib/contract";
import {
  managePlanSummary,
  manageStatusPresentation,
  operationIssuePresentation,
  previewGatePresentation,
} from "@/lib/previewPresentation";
import { cn } from "@/lib/utils";

const OPERATIONS = [
  { kind: "uninstall", icon: Trash2, danger: true },
  { kind: "restore", icon: History, danger: false },
  { kind: "recover", icon: LifeBuoy, danger: true },
];

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
  const { cliInfo, lastStatus } = useAppState();
  const [preview, setPreview] = React.useState(null);
  const [binding, setBinding] = React.useState(null);
  const [kind, setKind] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [backups, setBackups] = React.useState(() => lastStatus?.result?.backups || []);
  const [statusResult, setStatusResult] = React.useState(() => lastStatus?.result || null);
  const outsideTauri = typeof window !== "undefined" && !window.__TAURI_INTERNALS__;
  const cliReady = outsideTauri || (cliInfo.checked && Boolean(cliInfo.path));
  const cliUnavailable = !outsideTauri && cliInfo.checked && !cliInfo.path;
  const statusModel = manageStatusPresentation(statusResult, t);

  function showIssue(issue) {
    setError(issue);
  }

  function showRawIssue(values, fallbackKey = "manage.failed") {
    showIssue(operationIssuePresentation({ values, fallbackKey }, t));
  }

  const loadStatus = React.useCallback(async () => {
    if (!cliReady) return null;
    try {
      const envelope = await fetchStatus();
      setError(null);
      setBackups(envelope.result?.backups || []);
      setStatusResult(envelope.result || null);
      setLastStatus(envelope);
      return envelope;
    } catch (err) {
      if (!isTauriMissing(err)) showRawIssue(err.message || err, "manage.statusFailed");
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
      showRawIssue(cliInfo.error || t("common.cliUnavailable"), "manage.statusFailed");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const settings = getSettings();
      const envelope = await fetchPreview(PREVIEW_ARGS[nextKind]);
      if (!envelope.gate.ok) {
        setKind(nextKind);
        setPreview(envelope);
        setBinding(null);
        setConfirmOpen(false);
        showIssue(previewGatePresentation(envelope, "manage.previewBlocked", t));
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
      showRawIssue(err.message || err, "manage.previewFailed");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!kind || !binding) return;
    const lease = beginExclusiveOperation();
    if (!lease) return;
    setBusy(true);
    setError(null);
    try {
      const settings = getSettings();
      const freshPreview = await fetchPreview(PREVIEW_ARGS[kind]);
      if (!freshPreview.gate.ok) {
        invalidatePreview();
        showIssue(previewGatePresentation(freshPreview, "manage.previewBlocked", t));
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
        showIssue({ summary: t("manage.stale"), details: t("manage.staleFields", { fields: comparison.changed.join(", ") || "token" }) });
        return;
      }

      const previewToken = freshPreview.plan?.confirmation_token;
      if (!previewToken) {
        invalidatePreview();
        showIssue({ summary: t("manage.stale"), details: t("manage.staleFields", { fields: "confirmation_token" }) });
        return;
      }
      const result = await cliExecute([
        ...APPLY_ARGS[kind],
        "--expected-preview-token",
        previewToken,
      ]);
      if (!result.ok) {
        showRawIssue(result.diagnostics || [], "manage.failed");
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
        setStatusResult(status.result || null);
      } else {
        setLastStatus(null);
      }
      invalidatePreview();
      if (verificationErrors.length) {
        showIssue({ summary: t("manage.verifyFailed"), details: verificationErrors.join("\n") });
      } else {
        toast.success(t("manage.complete", { operation: t(`manage.operation.${kind}`) }));
      }
    } catch (err) {
      if (isTauriMissing(err)) return;
      showRawIssue(err.message || err);
    } finally {
      endOperation(lease);
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  const previewSummary = preview ? managePlanSummary(preview.plan || {}, kind, t) : [];
  const grokDir = preview?.target?.grok_dir || "";

  return (
    <div>
      <FadeIn><h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("manage.title")}</h1></FadeIn>

      <div className="grid gap-3" aria-busy={busy}>
        {OPERATIONS.map(({ kind: opKind, icon: Icon, danger }) => {
          const isRecover = opKind === "recover";
          const enabled = cliReady && (
            (opKind === "uninstall" && statusModel.canUninstall)
            || (opKind === "restore" && statusModel.canRestore)
            || (opKind === "recover" && statusModel.canRecover)
          );
          return (
            <div
              key={opKind}
              data-operation={opKind}
              className={cn(
                "card-glass flex flex-wrap items-center justify-between gap-3 p-5",
                isRecover && statusModel.canRecover && "border-warn/50",
              )}
            >
              <div className="flex min-w-0 items-start gap-3">
                <Icon className={cn("mt-0.5 size-5 shrink-0", danger ? "text-danger" : "text-muted-foreground")} aria-hidden="true" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">{t(`manage.operation.${opKind}`)}</h2>
                    {isRecover && statusModel.canRecover ? (
                      <Badge variant="yellow">{t("manage.recoverAvailable")}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t(`manage.${opKind === "restore" ? "restoreHooks" : opKind}Desc`)}</p>
                </div>
              </div>
              <Button
                variant={danger ? (isRecover ? "warning" : "destructive") : "outline"}
                disabled={busy || !enabled}
                onClick={() => previewOp(opKind)}
              >
                {t("manage.previewAction")}
              </Button>
            </div>
          );
        })}
      </div>

      {cliUnavailable ? (
        <div className="card-glass mt-4 border-danger/40 p-4" role="alert">
          <p className="text-sm text-danger">{t("common.cliUnavailable")}</p>
          {cliInfo.error ? (
            <TechnicalDetails><pre className="log-block mt-2">{cliInfo.error}</pre></TechnicalDetails>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="card-glass mt-4 border-danger/40 p-4" role="alert">
          <p className="text-sm text-danger">{error.summary}</p>
          {error.details ? (
            <TechnicalDetails><pre className="log-block mt-2">{error.details}</pre></TechnicalDetails>
          ) : null}
        </div>
      ) : null}

      {statusModel.issueLines.length ? (
        <div className="card-glass mt-4 border-warn/40 p-5" role="status">
          <h2 className="text-sm font-semibold">{t("manage.issues")}</h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {statusModel.issueLines.map((line) => <li key={line}>{line}</li>)}
          </ul>
          {statusModel.technicalDetails ? (
            <TechnicalDetails>
              <pre className="log-block mt-2">{statusModel.technicalDetails}</pre>
            </TechnicalDetails>
          ) : null}
        </div>
      ) : null}

      <div className="card-glass mt-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{t("manage.backups")}</h2>
          <Button variant="ghost" size="sm" onClick={loadStatus} disabled={busy || !cliReady}>{t("common.refresh")}</Button>
        </div>
        {backups.length > 0 ? (
          <>
            <p className="mt-3 text-sm">{t("manage.backupsSummary", { count: backups.length })}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={backups[backups.length - 1]}>
              {t("manage.latestBackup", { name: backups[backups.length - 1] })}
            </p>
            <TechnicalDetails label={t("manage.backupList")}>
              <pre className="log-block mt-2">{backups.join("\n")}</pre>
            </TechnicalDetails>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t("manage.backupsSummary", { count: 0 })}</p>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={kind ? t(`manage.operation.${kind}`) : ""}
        body={[
          grokDir ? t("dash.grokDir") + ": " + grokDir : "",
          ...previewSummary,
        ].filter(Boolean).join("\n")}
        danger={kind === "uninstall"}
        confirmDisabled={busy}
        onConfirm={apply}
      />
      {preview ? (
        <TechnicalDetails>
          <pre className="log-block mt-2">{JSON.stringify(preview.plan || {}, null, 2)}</pre>
        </TechnicalDetails>
      ) : null}
    </div>
  );
}
