import React from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  buildBreaktestArgs,
  cliCancel,
  cliRunStream,
  defaultBreaktestRunDir,
  isTauriMissing,
  openPath,
  parseCliOutput,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FadeIn } from "@/components/FadeIn";
import { useAppState } from "@/hooks/useAppState";
import { beginExclusiveOperation, endOperation } from "@/lib/store";
import { getSettings } from "@/lib/settings";
import {
  calculateBreaktestTimeoutMs,
  estimateBreaktestCaseCount,
  mergeBreaktestItem,
  normalizeBreaktestEvent,
  parseBreaktestEnvelope,
  shouldCreateFreshBreaktestRunDir,
  summarizeBreaktest,
} from "@/lib/contract";

const EMPTY_PROGRESS = { total: null, completed: 0, failed: 0 };
const FIXTURE_RUN_DIR = "fixture-breaktest-run";

export function TestView() {
  const { t } = useTranslation();
  const { cliInfo } = useAppState();
  const fixtureMode = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("fixture") === "1";
  const [bank, setBank] = React.useState("prompts.txt");
  const [mode, setMode] = React.useState("default");
  const [reps, setReps] = React.useState("1");
  const [timeoutSec, setTimeoutSec] = React.useState("180");
  const [interval, setInterval] = React.useState("0");
  const [concurrency, setConcurrency] = React.useState("1");
  const [model, setModel] = React.useState("");
  const [outputDir, setOutputDir] = React.useState(() => (fixtureMode ? FIXTURE_RUN_DIR : ""));
  const [resumeEligible, setResumeEligible] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [items, setItems] = React.useState([]);
  const [progress, setProgress] = React.useState(EMPTY_PROGRESS);
  const [streamVerdicts, setStreamVerdicts] = React.useState({});
  const [stderr, setStderr] = React.useState("");
  const [error, setError] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState({});
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
  const lastRunDirRef = React.useRef("");
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

      if (!payload.type || payload.type === "output") {
        if (payload.channel === "stderr" && payload.text) {
          setStderr((current) => current + payload.text);
        }
        return;
      }

      if (["case-start", "case-complete", "summary"].includes(payload.type)) {
        const update = normalizeBreaktestEvent(payload);
        if (update.item) {
          const failed = ["failed", "cancelled"].includes(update.item.status)
            || ["error", "timeout", "cancelled"].includes(update.item.verdict);
          const item = payload.type === "case-complete"
            ? {
                ...update.item,
                status: update.item.status === "cancelled"
                  ? "cancelled"
                  : (failed ? "failed" : "completed"),
              }
            : update.item;
          setItems((current) => mergeBreaktestItem(current, item));
        }
        setProgress((current) => {
          const completedDelta = payload.type === "case-complete" ? 1 : 0;
          const failedDelta = payload.type === "case-complete"
            && (["failed", "cancelled"].includes(update.item?.status)
              || ["error", "timeout", "cancelled"].includes(update.item?.verdict))
            ? 1
            : 0;
          return {
            total: update.total ?? current.total,
            completed: update.completed ?? (current.completed + completedDelta),
            failed: update.failed ?? (current.failed + failedDelta),
          };
        });
        if (payload.type === "summary") {
          setStreamVerdicts(payload.verdicts || payload.counts || {});
        }
      }
    });

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  React.useEffect(() => {
    if (outsideTauri || outputDir) return;
    let disposed = false;
    defaultBreaktestRunDir().then(
      (path) => {
        if (!disposed && typeof path === "string") {
          setOutputDir(path);
          setResumeEligible(false);
        }
      },
      (err) => {
        if (!disposed && !isTauriMissing(err)) setError(String(err.message || err));
      },
    );
    return () => {
      disposed = true;
    };
  }, [outsideTauri, outputDir]);

  async function chooseBank() {
    setError("");
    try {
      const selected = await open({ multiple: false, filters: [{ name: "Text", extensions: ["txt"] }] });
      if (typeof selected === "string") setBank(selected);
    } catch (err) {
      if (!isTauriMissing(err)) setError(String(err.message || err));
    }
  }

  async function chooseOut() {
    setError("");
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setOutputDir(selected);
        setResumeEligible(true);
      }
    } catch (err) {
      if (!isTauriMissing(err)) setError(String(err.message || err));
    }
  }

  function validatedValues(extra) {
    const errors = {};
    const repetitions = Number(reps);
    const timeout = Number(timeoutSec);
    const intervalSeconds = Number(interval);
    const concurrencyValue = Number(concurrency);
    if (!bank.trim()) errors.bank = t("test.validation.bank");
    if (!Number.isInteger(repetitions) || repetitions < 1) errors.reps = t("test.validation.repetitions");
    if (!Number.isFinite(timeout) || timeout <= 0) errors.timeout = t("test.validation.timeout");
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) errors.interval = t("test.validation.interval");
    if (!Number.isInteger(concurrencyValue) || concurrencyValue < 1 || concurrencyValue > 4) {
      errors.concurrency = t("test.validation.concurrency");
    }
    if (!outputDir.trim()) errors.outputDir = t("test.validation.outputDir");
    setFieldErrors(errors);
    if (Object.keys(errors).length) return null;
    return { repetitions, timeout, intervalSeconds, concurrencyValue };
  }

  async function start(extra = []) {
    if (!cliReady) {
      setError(cliInfo.error || t("common.cliUnavailable"));
      return;
    }
    const values = validatedValues(extra);
    if (!values) return;
    const lease = beginExclusiveOperation();
    if (!lease) return;
    let runOutputDir = outputDir.trim();
    if (shouldCreateFreshBreaktestRunDir({
      outputDir: runOutputDir,
      lastRunDir: lastRunDirRef.current,
      extra,
    })) {
      try {
        runOutputDir = outsideTauri
          ? `${FIXTURE_RUN_DIR}-${Date.now()}`
          : await defaultBreaktestRunDir();
        setOutputDir(runOutputDir);
        setResumeEligible(false);
      } catch (err) {
        endOperation(lease);
        if (!isTauriMissing(err)) setError(String(err.message || err));
        return;
      }
    }
    const settings = getSettings();
    const args = buildBreaktestArgs({
      bank: bank.trim(),
      mode,
      repetitions: values.repetitions,
      timeout: values.timeout,
      interval: values.intervalSeconds,
      concurrency: values.concurrencyValue,
      model: model.trim(),
      outputDir: runOutputDir,
      settings,
      extra,
    });
    const totalTimeoutMs = calculateBreaktestTimeoutMs({
      caseCount: estimateBreaktestCaseCount(bank),
      mode,
      repetitions: values.repetitions,
      timeout: values.timeout,
      interval: values.intervalSeconds,
      concurrency: values.concurrencyValue,
    });
    lastRunDirRef.current = runOutputDir;
    setResumeEligible(true);
    busyRef.current = true;
    cancelAcceptedRef.current = false;
    cancelPromiseRef.current = null;
    activeRunIdRef.current = "";
    setBusy(true);
    setRunId("");
    setRunState("starting");
    setResult(null);
    setItems([]);
    setProgress(EMPTY_PROGRESS);
    setStreamVerdicts({});
    setStderr("");
    setError("");
    try {
      const output = await cliRunStream(args, totalTimeoutMs);
      if (cancelPromiseRef.current) await cancelPromiseRef.current;
      if (output.stderr) setStderr(output.stderr);
      const envelope = parseCliOutput(output, parseBreaktestEnvelope);
      if (cancelAcceptedRef.current || envelope.result?.cancelled) {
        setResult(envelope.result);
        setProgress({
          total: Number(envelope.result.total) || null,
          completed: Number(envelope.result.completed) || 0,
          failed: Number(envelope.result.failed) || 0,
        });
        setStreamVerdicts(envelope.result.verdicts || {});
        setRunState("cancelled");
        return;
      }
      if (!envelope.ok) {
        setRunState("failed");
        setError((envelope.diagnostics || []).join("\n") || t("test.failed"));
        return;
      }
      setResult(envelope.result || {});
      setProgress((current) => ({
        total: Number(envelope.result?.total) || current.total,
        completed: Number(envelope.result?.completed ?? envelope.result?.total) || current.completed,
        failed: Number(envelope.result?.failed) || current.failed,
      }));
      setStreamVerdicts(envelope.result?.verdicts || {});
      setRunState("succeeded");
      toast.success(envelope.result?.run_dir || t("test.complete"));
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
      endOperation(lease);
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

  async function openReport() {
    if (!result?.report) return;
    setError("");
    try {
      await openPath(result.report);
    } catch (err) {
      if (isTauriMissing(err)) return;
      setError(`${t("test.openReportFailed")}\n${String(err.message || err)}`);
    }
  }

  const summary = React.useMemo(
    () => summarizeBreaktest(result || {}, items, progress),
    [items, progress, result],
  );
  const verdicts = { ...summary.verdicts, ...streamVerdicts };
  const progressMax = Math.max(summary.total || 0, 1);
  const progressValue = Math.min(summary.completed || 0, progressMax);

  return (
    <div>
      <FadeIn><h2 className="mb-6 text-xl font-semibold tracking-tight">{t("test.title")}</h2></FadeIn>
      <div className="card-glass p-5" aria-busy={busy}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm" htmlFor="test-bank">{t("test.bank")}</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="test-bank"
                value={bank}
                aria-invalid={Boolean(fieldErrors.bank)}
                onChange={(event) => setBank(event.target.value)}
              />
              <Button variant="outline" type="button" onClick={chooseBank}>{t("test.chooseBank")}</Button>
            </div>
            <FieldError message={fieldErrors.bank} />
          </div>
          <label className="text-sm" htmlFor="test-mode">
            <span className="mb-1 block">{t("test.mode")}</span>
            <select
              id="test-mode"
              className="h-9 w-full rounded-[10px] border border-border bg-background px-3 text-sm"
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              <option value="default">default</option>
              <option value="override">override</option>
              <option value="ab">A/B</option>
            </select>
          </label>
          <NumberField id="test-repetitions" label={t("test.repetitions")} value={reps} onChange={setReps} error={fieldErrors.reps} min="1" step="1" />
          <NumberField id="test-timeout" label={t("test.timeout")} value={timeoutSec} onChange={setTimeoutSec} error={fieldErrors.timeout} min="0.1" step="0.1" />
          <NumberField id="test-interval" label={t("test.interval")} value={interval} onChange={setInterval} error={fieldErrors.interval} min="0" step="0.1" />
          <NumberField id="test-concurrency" label={t("test.concurrency")} value={concurrency} onChange={setConcurrency} error={fieldErrors.concurrency} min="1" max="4" step="1" />
          <label className="text-sm" htmlFor="test-model">
            <span className="mb-1 block">{t("test.model")}</span>
            <Input id="test-model" value={model} onChange={(event) => setModel(event.target.value)} />
          </label>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm" htmlFor="test-output-dir">{t("test.outputDir")}</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="test-output-dir"
                value={outputDir}
                aria-invalid={Boolean(fieldErrors.outputDir)}
                onChange={(event) => {
                  setOutputDir(event.target.value);
                  setResumeEligible(Boolean(event.target.value.trim()));
                }}
              />
              <Button variant="outline" type="button" onClick={chooseOut}>{t("test.chooseDir")}</Button>
            </div>
            <FieldError message={fieldErrors.outputDir} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => start()} disabled={busy || !eventsReady || !cliReady || !outputDir.trim()}>{t("test.start")}</Button>
          <Button variant="outline" onClick={cancel} disabled={!busy || !runId || runState === "cancelling"}>{t("test.cancel")}</Button>
          <Button variant="outline" onClick={() => start(["--retry-failed"])} disabled={busy || !eventsReady || !cliReady || !resumeEligible}>{t("test.retry")}</Button>
          <Button variant="outline" onClick={() => start(["--resume"])} disabled={busy || !eventsReady || !cliReady || !resumeEligible}>{t("test.resume")}</Button>
          <Button variant="ghost" disabled={!result?.report} onClick={openReport}>
            {t("test.openReport")}
          </Button>
          <span className="text-xs text-muted-foreground" aria-live="polite">{t(`test.status.${runState}`)}</span>
        </div>
      </div>

      {cliUnavailable ? (
        <pre className="log-block mt-4" role="alert">{cliInfo.error || t("common.cliUnavailable")}</pre>
      ) : null}
      {error ? <pre className="log-block mt-4" role="alert">{error}</pre> : null}

      {(busy || result || items.length > 0) && (
        <section className="card-glass mt-4 p-5" aria-labelledby="test-progress-title">
          <h2 id="test-progress-title" className="text-sm font-semibold">{t("test.progress")}</h2>
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <Metric label={t("test.total")} value={summary.total || "—"} />
            <Metric label={t("test.completed")} value={summary.completed} />
            <Metric label={t("test.failedCount")} value={summary.failed} />
          </dl>
          <div
            className="mt-4 h-2 overflow-hidden rounded-full bg-elevated"
            role="progressbar"
            aria-label={t("test.progress")}
            aria-valuemin={0}
            aria-valuemax={progressMax}
            aria-valuenow={progressValue}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${(progressValue / progressMax) * 100}%` }}
            />
          </div>
          {Object.keys(verdicts).length > 0 && (
            <dl className="mt-4 flex flex-wrap gap-2 text-xs">
              {Object.entries(verdicts).sort().map(([verdict, count]) => (
                <div key={verdict} className="rounded-[8px] border border-border bg-background px-2.5 py-1.5">
                  <dt className="inline text-muted-foreground">{verdict} </dt>
                  <dd className="inline font-mono">{count}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}

      {items.length > 0 && (
        <section className="card-glass mt-4 p-5" aria-labelledby="test-items-title">
          <h2 id="test-items-title" className="text-sm font-semibold">{t("test.items")}</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-3 font-medium">#</th>
                  <th className="pb-2 pr-3 font-medium">{t("test.itemTitle")}</th>
                  <th className="pb-2 pr-3 font-medium">{t("test.mode")}</th>
                  <th className="pb-2 pr-3 font-medium">{t("test.repetition")}</th>
                  <th className="pb-2 font-medium">{t("test.itemStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="py-2 pr-3 font-mono">{item.num || "—"}</td>
                    <td className="py-2 pr-3">{item.title || "—"}</td>
                    <td className="py-2 pr-3 font-mono">{item.mode || "—"}</td>
                    <td className="py-2 pr-3 font-mono">{item.repetition || "—"}</td>
                    <td className="py-2 font-mono">{item.verdict || t(`test.itemState.${item.status || "running"}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {result && (
        <section className="card-glass mt-4 p-5" aria-labelledby="test-result-title">
          <h2 id="test-result-title" className="text-sm font-semibold">{t("test.result")}</h2>
          <dl className="mt-3 grid gap-2 text-sm">
            <ResultRow label={t("test.runDir")} value={result.run_dir} />
            <ResultRow label={t("test.classifier")} value={result.classifier} />
            <ResultRow label={t("test.summaryFile")} value={result.summary} />
            <ResultRow label={t("test.reportFile")} value={result.report} />
          </dl>
        </section>
      )}

      {stderr ? (
        <section className="mt-4" aria-labelledby="test-stderr-title">
          <h2 id="test-stderr-title" className="mb-2 text-sm font-semibold">{t("run.stderr")}</h2>
          <pre className="log-block" role="status">{stderr}</pre>
        </section>
      ) : null}
    </div>
  );
}

function NumberField({ id, label, value, onChange, error, ...props }) {
  return (
    <label className="text-sm" htmlFor={id}>
      <span className="mb-1 block">{label}</span>
      <Input
        id={id}
        type="number"
        value={value}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
      <FieldError message={error} />
    </label>
  );
}

function FieldError({ message }) {
  return message ? <span className="mt-1 block text-xs text-danger" role="alert">{message}</span> : null;
}

function Metric({ label, value }) {
  return (
    <div className="rounded-[10px] border border-border bg-background p-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-lg">{value}</dd>
    </div>
  );
}

function ResultRow({ label, value }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[120px_1fr] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-xs">{value || "—"}</dd>
    </div>
  );
}
