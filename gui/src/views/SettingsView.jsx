import React from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { getSettings, saveSettings } from "@/lib/settings";
import { detectCli, detectGrok, resolveCli } from "@/lib/api";
import { buildInfo } from "@/lib/buildInfo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FadeIn } from "@/components/FadeIn";
import { beginCliCheck, completeCliCheck } from "@/lib/store";

export function SettingsView() {
  const { t, i18n } = useTranslation();
  const [settings, setLocal] = React.useState(getSettings());

  function patch(next) {
    const saved = saveSettings(next);
    setLocal(saved);
    if (next.lang) i18n.changeLanguage(next.lang);
  }

  async function pick(key) {
    const selected = await open({ multiple: false });
    if (typeof selected === "string") patch({ [key]: selected });
  }

  async function pickDir() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") patch({ defaultGrokDir: selected });
  }

  async function exportDiag() {
    const payload = {
      desktop: buildInfo,
      settings: { ...settings, cliPath: settings.cliPath ? "[set]" : "", grokBin: settings.grokBin ? "[set]" : "" },
      detectedCli: await detectCli().catch((error) => String(error)),
      detectedGrok: await detectGrok(settings.grokBin).catch((error) => String(error)),
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    toast.success("ok");
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
        <Field label={t("settings.cli")} value={settings.cliPath} onChange={(cliPath) => patch({ cliPath })} onPick={() => pick("cliPath")} />
        <Field label={t("settings.grok")} value={settings.grokBin} onChange={(grokBin) => patch({ grokBin })} onPick={() => pick("grokBin")} />
        <Field label={t("settings.grokDir")} value={settings.defaultGrokDir} onChange={(defaultGrokDir) => patch({ defaultGrokDir })} onPick={pickDir} />
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
          <Button onClick={recheck}>CLI</Button>
          <Button variant="outline" onClick={exportDiag}>{t("settings.export")}</Button>
        </div>
        <dl className="grid gap-1 font-mono text-xs">
          <div>Desktop {buildInfo.desktopVersion}</div>
          <div>{buildInfo.channel}</div>
          <div>{buildInfo.sourceCommit || "development"}</div>
        </dl>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, onPick }) {
  return (
    <label className="text-sm">
      {label}
      <div className="mt-1 flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
        <Button variant="outline" type="button" onClick={onPick}>…</Button>
      </div>
    </label>
  );
}
