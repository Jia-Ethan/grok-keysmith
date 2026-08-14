import React from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { getSettings, saveSettings } from "@/lib/settings";
import { detectCli, detectGrok, isTauriMissing, resolveCli } from "@/lib/api";
import { buildInfo } from "@/lib/buildInfo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FadeIn } from "@/components/FadeIn";
import { beginCliCheck, completeCliCheck } from "@/lib/store";
import { useAppState } from "@/hooks/useAppState";

export function SettingsView() {
  const { t, i18n } = useTranslation();
  const { cliInfo } = useAppState();
  const [settings, setLocal] = React.useState(getSettings());
  const [error, setError] = React.useState("");

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

  async function exportDiag() {
    setError("");
    try {
      const payload = {
        desktop: buildInfo,
        settings: { ...settings, cliPath: settings.cliPath ? "[set]" : "", grokBin: settings.grokBin ? "[set]" : "" },
        detectedCli: await detectCli().catch((exportError) => String(exportError)),
        detectedGrok: await detectGrok(settings.grokBin).catch((exportError) => String(exportError)),
      };
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
      <div className="card-glass grid gap-4 p-5">
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
        <div className="flex flex-wrap gap-2">
          <Button onClick={recheck} disabled={!cliInfo.checked}>{t("settings.recheck")}</Button>
          <Button variant="outline" onClick={exportDiag}>{t("settings.export")}</Button>
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
              <div className="break-all">{cliInfo.path || t("settings.cliNotFound")}</div>
              <div>{cliInfo.version || "—"}</div>
              <div>{cliInfo.runtime ? t(`runtime.${cliInfo.runtime}`) : "—"}</div>
            </dl>
          )}
        </div>
        <dl className="grid gap-1 font-mono text-xs">
          <div>Desktop {buildInfo.desktopVersion}</div>
          <div>{buildInfo.channel}</div>
          <div>{buildInfo.sourceCommit || "development"}</div>
        </dl>
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
