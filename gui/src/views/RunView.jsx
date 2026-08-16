import React from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import {
  buildRunArgs,
  cliCancel,
  cliRunStream,
  isTauriMissing,
  parseCliOutput,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FadeIn } from "@/components/FadeIn";
import { useAppState } from "@/hooks/useAppState";
import { getSettings } from "@/lib/settings";
import { calculateRunTimeoutMs, parseRunEnvelope } from "@/lib/contract";

export function RunView() {
  const { t } = useTranslation();
  const { cliInfo } = useAppState();
  const [prompt, setPrompt] = React.useState("");
  const [mode, setMode] = React.useState("default");
  const [model, setModel] = React.useState("");
  const [effort, setEffort] = React.useState("");
  const [cwd, setCwd] = React.useState("");
  const [contract, setContract] = React.useState("");
  const [timeoutSec, setTimeoutSec] = React.useState("180");
  const [timeoutError, setTimeoutError] = React.useState("");
  const [stdout, setStdout] = React.useState("");
  const [stderr, setStderr] = React.useState("");
  const [error, setError] = React.useState("");
  const [runId, setRunId] = React.useState("");
  const [runState, setRunState] = React.useState("idle");
  const [busy, setBusy] = React.useState(false);
  const [eventsReady, setEventsReady] = React.useState(
    () => typeof window !== "undefined" && !window.__TAURI_INTERNALS__,
  );
  const activeRunIdRef = React.useRef("");
  const busyRef = React.useRef(false);
  const cancelAcceptedRef = React.useRef(false);
  const cancelPromiseRef = React.useRef(null);
  const outsideTauri = typeof window !== "undefined" && !window.__TAURI_INTERNALS__;
  const cliReady = outsideTauri || (cliInfo.checked && Boolean(cliInfo.path));
  const cliUnavailable = !outsideTauri && cliInfo.checked && !cliInfo.path;

  React.useEffect(() => {
    let disposed = false;
    let registered = 0;
    const unlisteners = [];
    const register = (name, handler) => {
      listen(name, handler).then((unlisten) => {
        if (disposed) unlisten();
        else {
          unlisteners.push(unlisten);
          registered += 1;
          if (registered === 2) setEventsReady(true);
        }
      }).catch((err) => {
        if (!disposed && !isTauriMissing(err)) setError(String(err.message || err));
      });
    };

    register("cli-run-started", (event) => {
      if (!busyRef.current) return;
      const nextRunId = event.payload?.runId || event.payload?.run_id || "";
      if (!nextRunId) return;
      activeRunIdRef.current = nextRunId;
      setRunId(nextRunId);
      setRunState((current) => (current === "cancelling" ? current : "running"));
    });

    register("cli-stream", (event) => {
      if (!busyRef.current) return;
      const payload = event.payload || {};
      const eventRunId = payload.runId || payload.run_id || "";
      if (!eventRunId) return;
      if (!activeRunIdRef.current) {
        activeRunIdRef.current = eventRunId;
        setRunId(eventRunId);
      }
      if (eventRunId !== activeRunIdRef.current) return;
      if (payload.type && payload.type !== "output") return;
      const text = typeof payload.text === "string" ? payload.text : "";
      if (!text) return;
      if (payload.channel === "stderr") setStderr((current) => current + text);
      else setStdout((current) => current + text);
    });

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  async function start() {
    setError("");
    if (!cliReady) {
      setError(cliInfo.error || t("common.cliUnavailable"));
      return;
    }
    if (!prompt.trim()) {
      setError(t("run.promptRequired"));
      return;
    }
    const timeout = Number(timeoutSec);
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 86_400) {
      setTimeoutError(t("run.timeoutInvalid"));
      return;
    }
    setTimeoutError("");
    const settings = getSettings();
    const args = buildRunArgs({ prompt, mode, contract, model, effort, cwd, timeout, settings });
    busyRef.current = true;
    cancelAcceptedRef.current = false;
    cancelPromiseRef.current = null;
    activeRunIdRef.current = "";
    setBusy(true);
    setRunId("");
    setRunState("starting");
    setStdout("");
    setStderr("");
    setError("");
    try {
      const result = await cliRunStream(args, calculateRunTimeoutMs(timeout));
      if (cancelPromiseRef.current) await cancelPromiseRef.current;
      const wasCancelled = cancelAcceptedRef.current;
      if (result.timed_out && !wasCancelled) {
        setRunState("failed");
        setError(t("run.timedOut"));
        return;
      }
      if (result.stderr) setStderr(result.stderr);
      try {
        const envelope = parseCliOutput(result, parseRunEnvelope);
        setStdout(envelope.result?.stdout || "");
        setStderr(envelope.result?.stderr || result.stderr || "");
        if (wasCancelled || envelope.result?.cancelled) {
          setRunState("cancelled");
        } else if (envelope.ok && result.exit_code === 0) {
          setRunState("succeeded");
        } else {
          setRunState("failed");
          setError((envelope.diagnostics || []).join("\n") || result.stderr || t("run.failed"));
        }
      } catch (parseError) {
        setStdout(result.stdout);
        if (wasCancelled) setRunState("cancelled");
        else {
          setRunState("failed");
          setError([
            t("run.invalidEnvelope"),
            result.stderr,
            String(parseError.message || parseError),
          ].filter(Boolean).join("\n"));
        }
      }
    } catch (err) {
      if (isTauriMissing(err)) return;
      if (cancelPromiseRef.current) await cancelPromiseRef.current;
      if (cancelAcceptedRef.current) setRunState("cancelled");
      else {
        setRunState("failed");
        setError(String(err.message || err));
      }
    } finally {
      busyRef.current = false;
      activeRunIdRef.current = "";
      setBusy(false);
      setRunId("");
    }
  }

  async function cancel() {
    const currentRunId = activeRunIdRef.current;
    if (!currentRunId) return;
    setRunState("cancelling");
    const cancellation = cliCancel(currentRunId).then(
      () => {
        cancelAcceptedRef.current = true;
        return true;
      },
      (err) => {
        if (busyRef.current) {
          setRunState("running");
          setError(String(err.message || err));
        }
        return false;
      },
    );
    cancelPromiseRef.current = cancellation;
    await cancellation;
  }

  async function copyOut() {
    try {
      await navigator.clipboard.writeText(stdout);
      toast.success(t("common.copied"));
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  async function saveOut() {
    try {
      const path = await save({ defaultPath: "grok-output.txt" });
      if (!path) return;
      await invoke("write_text_file", { path, contents: stdout });
      toast.success(path);
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  async function chooseCwd() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") setCwd(selected);
    } catch (err) {
      if (!isTauriMissing(err)) setError(String(err.message || err));
    }
  }

  return (
    <div>
      <FadeIn><h2 className="mb-6 text-xl font-semibold tracking-tight">{t("run.title")}</h2></FadeIn>
      <div className="card-glass p-5" aria-busy={busy}>
        <label className="text-sm" htmlFor="run-prompt">{t("run.prompt")}</label>
        <textarea
          id="run-prompt"
          className="mt-2 h-36 w-full rounded-[10px] border border-border bg-background p-3 font-mono text-sm"
          value={prompt}
          aria-invalid={Boolean(error && !prompt.trim())}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm" htmlFor="run-mode">
            <span className="mb-1 block">{t("run.mode")}</span>
            <select
              id="run-mode"
              className="h-9 w-full rounded-[10px] border border-border bg-background px-3 text-sm"
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              <option value="default">{t("run.default")}</option>
              <option value="override">{t("run.override")}</option>
            </select>
          </label>
          <label className="text-sm" htmlFor="run-timeout">
            <span className="mb-1 block">{t("run.timeout")}</span>
            <Input
              id="run-timeout"
              type="number"
              min="0.1"
              max="86400"
              step="0.1"
              value={timeoutSec}
              aria-invalid={Boolean(timeoutError)}
              onChange={(event) => setTimeoutSec(event.target.value)}
            />
            {timeoutError ? <span className="mt-1 block text-xs text-danger" role="alert">{timeoutError}</span> : null}
          </label>
          <Field id="run-contract" label={t("run.contract")} value={contract} onChange={setContract} />
          <Field id="run-model" label={t("run.model")} value={model} onChange={setModel} />
          <Field id="run-effort" label={t("run.effort")} value={effort} onChange={setEffort} />
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm" htmlFor="run-cwd">{t("run.cwd")}</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="run-cwd" value={cwd} onChange={(event) => setCwd(event.target.value)} />
              <Button variant="outline" type="button" onClick={chooseCwd}>{t("run.chooseCwd")}</Button>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={start} disabled={busy || !eventsReady || !cliReady}>{t("run.start")}</Button>
          <Button variant="outline" onClick={cancel} disabled={!busy || !runId || runState === "cancelling"}>
            {t("run.cancel")}
          </Button>
          <Button variant="ghost" onClick={copyOut} disabled={!stdout}>{t("common.copy")}</Button>
          <Button variant="ghost" onClick={saveOut} disabled={!stdout}>{t("run.save")}</Button>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {t(`run.status.${runState}`)}
          </span>
        </div>
      </div>
      {cliUnavailable ? (
        <pre className="log-block mt-4" role="alert">{cliInfo.error || t("common.cliUnavailable")}</pre>
      ) : null}
      {error ? <pre className="log-block mt-4" role="alert">{error}</pre> : null}
      <section className="mt-4" aria-labelledby="run-stdout-title">
        <h2 id="run-stdout-title" className="mb-2 text-sm font-semibold">{t("run.stdout")}</h2>
        <pre className="log-block min-h-40" aria-live="polite">{stdout}</pre>
      </section>
      {stderr ? (
        <section className="mt-4" aria-labelledby="run-stderr-title">
          <h2 id="run-stderr-title" className="mb-2 text-sm font-semibold">{t("run.stderr")}</h2>
          <pre className="log-block" role="status">{stderr}</pre>
        </section>
      ) : null}
    </div>
  );
}

function Field({ id, label, value, onChange, className = "" }) {
  return (
    <label className={`text-sm ${className}`} htmlFor={id}>
      <span className="mb-1 block">{label}</span>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
