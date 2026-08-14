import React from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { cliCancel, cliRunStream, isTauriMissing } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FadeIn } from "@/components/FadeIn";
import { getSettings } from "@/lib/settings";
import { parseEnvelope } from "@/lib/contract";

export function RunView() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = React.useState("");
  const [mode, setMode] = React.useState("default");
  const [model, setModel] = React.useState("");
  const [effort, setEffort] = React.useState("");
  const [cwd, setCwd] = React.useState("");
  const [contract, setContract] = React.useState("");
  const [output, setOutput] = React.useState("");
  const [error, setError] = React.useState("");
  const [runId, setRunId] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let unlisten = () => {};
    listen("cli-stream", (event) => {
      const payload = event.payload || {};
      if (payload.channel === "stdout" && payload.text) {
        setOutput((prev) => prev + payload.text);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten();
  }, []);

  async function start() {
    if (!prompt.trim()) {
      setError("prompt");
      return;
    }
    setBusy(true);
    setOutput("");
    setError("");
    const settings = getSettings();
    const args = ["--json", "--lang", "en", "run", "--mode", mode, "--prompt", prompt];
    if (settings.defaultGrokDir) args.splice(2, 0, "--grok-dir", settings.defaultGrokDir);
    if (settings.grokBin) args.push("--grok-bin", settings.grokBin);
    if (contract) args.push("--contract-path", contract);
    if (model) args.push("--model", model);
    if (effort) args.push("--reasoning-effort", effort);
    if (cwd) args.push("--cwd", cwd);
    try {
      const result = await cliRunStream(args, 180_000);
      setRunId(result.run_id || "");
      if (result.stdout) {
        try {
          const envelope = parseEnvelope(result.stdout);
          setOutput(envelope.result?.stdout || result.stdout);
          if (!envelope.ok) setError((envelope.diagnostics || []).join("\n"));
        } catch {
          setOutput((prev) => prev || result.stdout);
        }
      }
      if (result.stderr) setError(result.stderr);
    } catch (err) {
      if (isTauriMissing(err)) return;
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (runId) await cliCancel(runId);
  }

  async function copyOut() {
    await navigator.clipboard.writeText(output);
    toast.success("ok");
  }

  async function saveOut() {
    const path = await save({ defaultPath: "grok-output.txt" });
    if (!path) return;
    await invoke("write_text_file", { path, contents: output });
    toast.success(path);
  }

  return (
    <div>
      <FadeIn><h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("run.title")}</h1></FadeIn>
      <div className="card-glass p-5">
        <label className="text-sm">{t("run.prompt")}</label>
        <textarea
          className="mt-2 h-36 w-full rounded-[10px] border border-border bg-background p-3 font-mono text-sm"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <select
            className="h-9 rounded-[10px] border border-border bg-background px-3 text-sm"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            aria-label={t("run.mode")}
          >
            <option value="default">{t("run.default")}</option>
            <option value="override">{t("run.override")}</option>
          </select>
          <Input placeholder="contract" value={contract} onChange={(e) => setContract(e.target.value)} />
          <Input placeholder="model" value={model} onChange={(e) => setModel(e.target.value)} />
          <Input placeholder="effort" value={effort} onChange={(e) => setEffort(e.target.value)} />
          <Input className="col-span-2" placeholder="cwd" value={cwd} onChange={(e) => setCwd(e.target.value)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={start} disabled={busy}>{t("run.start")}</Button>
          <Button variant="outline" onClick={cancel} disabled={!busy && !runId}>{t("run.cancel")}</Button>
          <Button variant="ghost" onClick={copyOut} disabled={!output}>{t("common.copy")}</Button>
          <Button variant="ghost" onClick={saveOut} disabled={!output}>{t("run.save")}</Button>
        </div>
      </div>
      {error ? <pre className="log-block mt-4">{error}</pre> : null}
      <pre className="log-block mt-4 min-h-40">{output}</pre>
    </div>
  );
}
