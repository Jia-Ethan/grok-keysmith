import React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cliExecute, fetchPreview, fetchStatus, isTauriMissing } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/FadeIn";
import { beginExclusiveOperation, endOperation, setLastStatus } from "@/lib/store";

export function Manage() {
  const { t } = useTranslation();
  const [preview, setPreview] = React.useState(null);
  const [kind, setKind] = React.useState("");
  const [target, setTarget] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState("");
  const [backups, setBackups] = React.useState([]);

  React.useEffect(() => {
    fetchStatus().then((envelope) => {
      setBackups(envelope.result?.backups || []);
    }).catch(() => {});
  }, []);

  async function previewOp(nextKind, extra) {
    setBusy(true);
    setError("");
    try {
      const status = await fetchStatus();
      const envelope = await fetchPreview(extra);
      if (!envelope.gate.ok && nextKind !== "restore") {
        setError(envelope.gate.reason || (envelope.diagnostics || []).join("\n"));
        setPreview(null);
        return;
      }
      setKind(nextKind);
      setPreview(envelope);
      setTarget(status.target?.grok_dir || "");
      setConfirmOpen(true);
    } catch (err) {
      if (isTauriMissing(err)) return;
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    const lease = beginExclusiveOperation();
    if (!lease) return;
    setBusy(true);
    try {
      const status = await fetchStatus();
      if ((status.target?.grok_dir || "") !== target) {
        setPreview(null);
        setError("stale");
        return;
      }
      const extra = kind === "uninstall"
        ? ["--uninstall", "--yes"]
        : kind === "recover"
          ? ["--recover", "--yes"]
          : ["--restore-hooks", "--yes"];
      const result = await cliExecute(extra);
      if (!result.ok) {
        setError((result.diagnostics || []).join("\n"));
        return;
      }
      setLastStatus(null);
      setPreview(null);
      toast.success(kind);
    } catch (err) {
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
      <div className="card-glass flex flex-wrap gap-2 p-5">
        <Button variant="destructive" disabled={busy} onClick={() => previewOp("uninstall", ["--uninstall"])}>
          {t("manage.uninstall")}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => previewOp("restore", ["--restore-hooks"])}>
          {t("manage.restoreHooks")}
        </Button>
        <Button variant="warning" disabled={busy} onClick={() => previewOp("recover", ["--recover"])}>
          {t("manage.recover")}
        </Button>
      </div>
      {error ? <pre className="log-block mt-4">{error}</pre> : null}
      <div className="card-glass mt-4 p-5">
        <h2 className="text-sm font-semibold">{t("manage.backups")}</h2>
        <pre className="log-block mt-3">{(backups || []).join("\n") || "—"}</pre>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={kind}
        body={preview ? JSON.stringify(preview.plan || preview.result || {}, null, 2) : ""}
        danger={kind === "uninstall"}
        confirmDisabled={busy}
        onConfirm={apply}
      />
    </div>
  );
}
