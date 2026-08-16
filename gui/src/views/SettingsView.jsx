import React from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { getSettings, saveSettings } from "@/lib/settings";
import {
  detectCli,
  detectGrok,
  fetchStatus,
  grokInspect,
  isTauriMissing,
  readManifest,
  resolveCli,
} from "@/lib/api";
import { buildInfo } from "@/lib/buildInfo";
import { buildDiagnosticsPayload } from "@/lib/diagnostics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FadeIn } from "@/components/FadeIn";
import { TechnicalDetails } from "@/components/TechnicalDetails";
import { beginCliCheck, completeCliCheck } from "@/lib/store";
import { useAppState } from "@/hooks/useAppState";

export function SettingsView() {
  const { t, i18n } = useTranslation();
  const { cliInfo } = useAppState();
  const [settings, setLocal] = React.useState(getSettings());
  const [error, setError] = React.useState("");
  const [diagnostics, setDiagnostics] = React.useState(null);
  const [diagLoading, setDiagLoading] = React.useState(false);
  const outsideTauri = typeof window !== "undefined" && !window.__TAURI_INTERNALS__;

  function patch(next) {
    const saved = saveSettings(next);
    setLocal(saved);
    if (next.lang) i18n.changeLanguage(next.lang);
  }

  async function pick(key) {
    setError("");
    try {
      const selected = await open({ multiple: false });
      if (typeof selected === "string") patch({ [key]: selected });
    } catch (pickError) {
      if (!isTauriMissing(pickError)) setError(String(pickError.message || pickError));
    }
  }

  async function pickDir() {
    setError("");
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") patch({ defaultGrokDir: selected });
    } catch (pickError) {
      if (!isTauriMissing(pickError)) setError(String(pickError.message || pickError));
    }
  }

  // 诊断按需加载：不会在启动或 Dashboard 刷新时自动执行。
  async function loadDiagnostics() {
    if (!outsideTauri && !cliInfo.path) {
      setError(t("common.cliUnavailable"));
      return null;
    }
    setDiagLoading(true);
    setError("");
    try {
      const status = outsideTauri ? null : await fetchStatus();
      const grokDir = status?.target?.grok_dir || settings.defaultGrokDir || "";
      let inspect = null;
      let manifest = null;
      if (!outsideTauri) {
        try {
          const inspectOut = await grokInspect();
          inspect = inspectOut.stdout ? JSON.parse(inspectOut.stdout) : inspectOut;
        } catch (inspectError) {
          inspect = { error: String(inspectError.message || inspectError) };
        }
        if (grokDir) {
          try {
            manifest = await readManifest(grokDir);
          } catch {
            manifest = null;
          }
        }
      }
      const payload = buildDiagnosticsPayload({
        buildInfo,
        cliInfo,
        settings,
        status,
        inspect,
        manifest,
        detectedCli: outsideTauri ? null : await detectCli().catch((e) => String(e)),
        detectedGrok: outsideTauri ? null : await detectGrok(settings.grokBin).catch((e) => String(e)),
      });
      setDiagnostics(payload);
      return payload;
    } catch (diagError) {
      if (!isTauriMissing(diagError)) setError(String(diagError.message || diagError));
      return null;
    } finally {
      setDiagLoading(false);
    }
  }

  async function exportDiag() {
    setError("");
    const payload = diagnostics || await loadDiagnostics();
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success(t("common.copied"));
    } catch (exportError) {
      setError(String(exportError.message || exportError));
    }
  }

  async function recheck() {
    const generation = beginCliCheck();
    try {
      completeCliCheck(generation, { ...(await resolveCli(settings.cliPath)), error: null, checked: true });
    } catch (error) {
      completeCliCheck(generation, { path: null, version: "", runtime: "", error: String(error.message || error), checked: true });
    }
  }

  return (
    <div>
      <FadeIn><h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("settings.title")}</h1></FadeIn>

      <div className="flex flex-col gap-4">
        <section className="card-glass grid gap-4 p-5" aria-label={t("settings.title")}>
          <Field id="settings-cli" label={t("settings.cli")} pickLabel={t("settings.choose", { field: t("settings.cli") })} value={settings.cliPath} onChange={(cliPath) => patch({ cliPath })} onPick={() => pick("cliPath")} />
          <Field id="settings-grok" label={t("settings.grok")} pickLabel={t("settings.choose", { field: t("settings.grok") })} value={settings.grokBin} onChange={(grokBin) => patch({ grokBin })} onPick={() => pick("grokBin")} />
          <Field id="settings-grok-dir" label={t("settings.grokDir")} pickLabel={t("settings.choose", { field: t("settings.grokDir") })} value={settings.defaultGrokDir} onChange={(defaultGrokDir) => patch({ defaultGrokDir })} onPick={pickDir} />
          <label className="text-sm">
            {t("settings.lang")}
            <select className="mt-1 h-9 w-full rounded-[10px] border border-border bg-background px-3" value={settings.lang} onChange={(e) => patch({ lang: e.target.value })}>
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="text-sm">
            {t("settings.theme")}
            <select className="mt-1 h-9 w-full rounded-[10px] border border-border bg-background px-3" value={settings.theme} onChange={(e) => patch({ theme: e.target.value })}>
              <option value="system">system</option>
              <option value="light">light</option>
              <option value="dark">dark</option>
            </select>
          </label>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm">{t("settings.advancedTools")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.advancedToolsHint")}</p>
            </div>
            <Switch
              checked={settings.showAdvancedTools}
              onCheckedChange={(showAdvancedTools) => patch({ showAdvancedTools })}
              aria-label={t("settings.advancedTools")}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={recheck} disabled={!cliInfo.checked}>{t("settings.recheck")}</Button>
          </div>
          <div className="rounded-[10px] border border-border bg-background p-3" aria-live="polite">
            {!cliInfo.checked ? (
              <p className="text-sm text-muted-foreground"><span className="spinner mr-2" />{t("settings.checking")}</p>
            ) : cliInfo.error ? (
              <>
                <p className="text-sm font-medium text-danger">{t("settings.cliCheckFailed")}</p>
                <pre className="log-block mt-2" role="alert">{cliInfo.error}</pre>
              </>
            ) : (
              <dl className="grid gap-1 font-mono text-xs">
                <div className="truncate" title={cliInfo.path || ""}>{cliInfo.path || t("settings.cliNotFound")}</div>
                <div>{cliInfo.version || "—"}</div>
                <div>{cliInfo.runtime ? t(`runtime.${cliInfo.runtime}`) : "—"}</div>
              </dl>
            )}
          </div>
        </section>

        <section className="card-glass p-5" aria-label={t("settings.about")}>
          <h2 className="text-sm font-semibold">{t("settings.about")}</h2>
          <dl className="mt-3 grid gap-1 font-mono text-xs">
            <div>Desktop {buildInfo.desktopVersion}</div>
            <div>CLI {cliInfo.version || "—"}</div>
            <div>{cliInfo.runtime ? t(`runtime.${cliInfo.runtime}`) : "—"}</div>
            <div>{buildInfo.channel}</div>
            <div>{buildInfo.sourceCommit || "development"}</div>
          </dl>
        </section>

        <section className="card-glass p-5" aria-label={t("settings.diagnostics")}>
          <h2 className="text-sm font-semibold">{t("settings.diagnostics")}</h2>
          <p className="mt-2 text-xs text-muted-foreground">{t("settings.diagnosticsHint")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" onClick={loadDiagnostics} disabled={diagLoading}>
              {diagLoading ? t("settings.loadingDiagnostics") : t("settings.loadDiagnostics")}
            </Button>
            <Button variant="outline" onClick={exportDiag} disabled={diagLoading}>{t("settings.export")}</Button>
          </div>
          {diagnostics ? (
            <TechnicalDetails>
              <pre className="log-block mt-2">{JSON.stringify(diagnostics, null, 2)}</pre>
            </TechnicalDetails>
          ) : null}
        </section>
      </div>

      {error ? <pre className="log-block mt-4" role="alert">{error}</pre> : null}
    </div>
  );
}

function Field({ id, label, pickLabel, value, onChange, onPick }) {
  return (
    <label className="text-sm" htmlFor={id}>
      {label}
      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
        <Button variant="outline" type="button" aria-label={pickLabel} onClick={onPick}>…</Button>
      </div>
    </label>
  );
}
