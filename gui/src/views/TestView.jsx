import React from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { cliExecute, isTauriMissing, openPath } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FadeIn } from "@/components/FadeIn";
import { beginExclusiveOperation, endOperation } from "@/lib/store";
import { getSettings } from "@/lib/settings";

export function TestView() {
  const { t } = useTranslation();
  const [bank, setBank] = React.useState("prompts.txt");
  const [mode, setMode] = React.useState("default");
  const [reps, setReps] = React.useState("1");
  const [timeoutSec, setTimeoutSec] = React.useState("180");
  const [interval, setInterval] = React.useState("0");
  const [concurrency, setConcurrency] = React.useState("1");
  const [outputDir, setOutputDir] = React.useState("");
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function chooseBank() {
    const selected = await open({ multiple: false, filters: [{ name: "Text", extensions: ["txt"] }] });
    if (typeof selected === "string") setBank(selected);
  }

  async function chooseOut() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setOutputDir(selected);
  }

  function args(extra = []) {
    const settings = getSettings();
    const list = [
      "breaktest",
      "--bank", bank,
      "--mode", mode,
      "--repetitions", String(Math.max(1, Number(reps) || 1)),
      "--timeout", String(Math.max(1, Number(timeoutSec) || 180)),
      "--interval", String(Math.max(0, Number(interval) || 0)),
      "--concurrency", String(Math.min(4, Math.max(1, Number(concurrency) || 1))),
    ];
    if (outputDir) list.push("--output-dir", outputDir);
    if (settings.grokBin) list.push("--grok-bin", settings.grokBin);
    list.push(...extra);
    return list;
  }

  async function start(extra = []) {
    const lease = beginExclusiveOperation();
    if (!lease) return;
    setBusy(true);
    setError("");
    try {
      const envelope = await cliExecute(args(extra), 600_000);
      if (!envelope.ok) {
        setError((envelope.diagnostics || []).join("\n"));
        return;
      }
      setResult(envelope.result);
      toast.success(envelope.result?.run_dir || "ok");
    } catch (err) {
      if (isTauriMissing(err)) return;
      setError(String(err.message || err));
    } finally {
      endOperation(lease);
      setBusy(false);
    }
  }

  return (
    <div>
      <FadeIn><h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("test.title")}</h1></FadeIn>
      <div className="card-glass p-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 flex gap-2">
            <Input value={bank} onChange={(e) => setBank(e.target.value)} aria-label={t("test.bank")} />
            <Button variant="outline" onClick={chooseBank}>{t("test.bank")}</Button>
          </div>
          <select className="h-9 rounded-[10px] border border-border bg-background px-3 text-sm" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="default">default</option>
            <option value="override">override</option>
            <option value="ab">A/B</option>
          </select>
          <Input value={reps} onChange={(e) => setReps(e.target.value)} aria-label="repetitions" />
          <Input value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} aria-label="timeout" />
          <Input value={interval} onChange={(e) => setInterval(e.target.value)} aria-label="interval" />
          <Input value={concurrency} onChange={(e) => setConcurrency(e.target.value)} aria-label="concurrency" />
          <div className="col-span-2 flex gap-2">
            <Input value={outputDir} onChange={(e) => setOutputDir(e.target.value)} />
            <Button variant="outline" onClick={chooseOut}>dir</Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => start()} disabled={busy}>{t("test.start")}</Button>
          <Button variant="outline" onClick={() => start(["--retry-failed"])} disabled={busy || !outputDir}>{t("test.retry")}</Button>
          <Button variant="outline" onClick={() => start(["--resume"])} disabled={busy || !outputDir}>{t("test.resume")}</Button>
          <Button variant="ghost" disabled={!result?.report} onClick={() => result?.report && openPath(result.report)}>
            {t("test.openReport")}
          </Button>
        </div>
      </div>
      {error ? <pre className="log-block mt-4">{error}</pre> : null}
      {result ? <pre className="log-block mt-4">{JSON.stringify(result, null, 2)}</pre> : null}
    </div>
  );
}
