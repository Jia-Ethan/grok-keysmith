import React from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { cliExecute, fetchPreview, fetchStatus, isTauriMissing } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/FadeIn";
import { beginExclusiveOperation, endOperation, setLastStatus } from "@/lib/store";

export function Deploy() {
  const { t } = useTranslation();
  const [source, setSource] = React.useState("bundled");
  const [file, setFile] = React.useState("");
  const [preview, setPreview] = React.useState(null);
  const [previewTarget, setPreviewTarget] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState("");

  const deployArgs = React.useCallback(() => {
    const args = ["--dry-run"];
    if (source === "local" && file) args.push("--file", file);
    return args;
  }, [source, file]);

  async function currentTarget() {
    const status = await fetchStatus();
    return status.target?.grok_dir || "";
  }

  async function makePreview() {
    setBusy(true);
    setError("");
    try {
      const target = await currentTarget();
      const envelope = await fetchPreview(deployArgs());
      if (!envelope.gate.ok) {
        setPreview(null);
        setError(envelope.gate.reason);
        return;
      }
      setPreview(envelope);
      setPreviewTarget(target);
    } catch (err) {
      if (isTauriMissing(err)) return;
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function applyDeploy() {
    const lease = beginExclusiveOperation();
    if (!lease) return;
    setBusy(true);
    try {
      const target = await currentTarget();
      if (target !== previewTarget) {
        setPreview(null);
        setError(t("deploy.stale"));
        return;
      }
      const args = [];
      if (source === "local" && file) args.push("--file", file);
      args.push("--yes");
      const result = await cliExecute(args);
      if (!result.ok) {
        setError((result.diagnostics || []).join("\n") || "deploy failed");
        return;
      }
      setLastStatus(null);
      setPreview(null);
      toast.success(result.result?.deployment_id || "ok");
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      endOperation(lease);
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  async function chooseFile() {
    const selected = await open({ multiple: false, filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (typeof selected === "string") {
      setFile(selected);
      setPreview(null);
    }
  }

  const plan = preview?.plan;

  return (
    <div>
      <FadeIn><h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("deploy.title")}</h1></FadeIn>
      <div className="card-glass p-5">
        <div className="flex flex-wrap gap-2">
          <Button variant={source === "bundled" ? "default" : "outline"} onClick={() => { setSource("bundled"); setPreview(null); }}>
            {t("deploy.bundled")}
          </Button>
          <Button variant={source === "local" ? "default" : "outline"} onClick={() => { setSource("local"); setPreview(null); }}>
            {t("deploy.local")}
          </Button>
          {source === "local" && (
            <Button variant="secondary" onClick={chooseFile}>{t("deploy.choose")}</Button>
          )}
        </div>
        {file ? <p className="mt-3 break-all font-mono text-xs">{file}</p> : null}
        <div className="mt-4 flex gap-2">
          <Button onClick={makePreview} disabled={busy || (source === "local" && !file)}>{t("deploy.preview")}</Button>
          <Button
            variant="destructive"
            disabled={!preview || busy}
            onClick={() => setConfirmOpen(true)}
          >
            {t("deploy.confirm")}
          </Button>
        </div>
      </div>

      {error ? <pre className="log-block mt-4">{error}</pre> : null}

      {plan && (
        <div className="card-glass mt-4 p-5 text-sm">
          <dl className="grid gap-2">
            <Row label="source" value={plan.prompt_source} />
            <Row label="sha256" value={plan.prompt_sha256} />
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
        body={plan?.prompt_sha256}
        danger
        confirmDisabled={busy}
        onConfirm={applyDeploy}
      />
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-xs">{value}</dd>
    </div>
  );
}
