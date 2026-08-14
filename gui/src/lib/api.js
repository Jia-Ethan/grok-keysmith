import { invoke } from "@tauri-apps/api/core";
import { getSettings, normalizeCliPath } from "./settings.js";
import { gatePreview, parseEnvelope } from "./contract.js";
import { beginOperation, endOperation } from "./store.js";

function invokeTrackedOperation(command, payload) {
  const operationLease = beginOperation();
  if (!operationLease) {
    return Promise.reject(
      new Error("Application exit is pending; refusing to start another backend operation."),
    );
  }
  try {
    return Promise.resolve(invoke(command, payload)).finally(() => {
      endOperation(operationLease);
    });
  } catch (error) {
    endOperation(operationLease);
    throw error;
  }
}

export function cliRun(args, timeoutMs = 30_000) {
  const { cliPath } = getSettings();
  return invokeTrackedOperation("cli_run", {
    cliPath: cliPath || null,
    args,
    timeoutMs,
  });
}

export function cliRunStream(args, timeoutMs = 180_000) {
  const { cliPath } = getSettings();
  return invokeTrackedOperation("cli_run_stream", {
    cliPath: cliPath || null,
    args,
    timeoutMs,
  });
}

export function cliCancel(runId) {
  return invoke("cli_cancel", { runId });
}

export function readManifest(grokDir) {
  return invokeTrackedOperation("read_manifest", { grokDir });
}

export function detectCli() {
  return invokeTrackedOperation("detect_cli");
}

export function cliVersion(cliPath) {
  return invokeTrackedOperation("cli_version", { cliPath: cliPath || null });
}

export function cliRuntime(cliPath) {
  return invokeTrackedOperation("cli_runtime", { cliPath: cliPath || null });
}

export function detectGrok(grokBin) {
  return invokeTrackedOperation("detect_grok", { grokBin: grokBin || null });
}

export function grokInspect() {
  const { grokBin, defaultGrokDir } = getSettings();
  return invokeTrackedOperation("grok_inspect", {
    grokBin: grokBin || null,
    cwd: defaultGrokDir || null,
  });
}

export function openPath(path) {
  return invoke("open_path", { path });
}

function targetArgs() {
  const { defaultGrokDir } = getSettings();
  const args = ["--json", "--lang", "en"];
  if (defaultGrokDir) args.push("--grok-dir", defaultGrokDir);
  return args;
}

export async function resolveCli(
  cliPath,
  {
    detect = detectCli,
    getRuntime = cliRuntime,
    getVersion = cliVersion,
  } = {},
) {
  const manualPath = normalizeCliPath(cliPath);
  if (manualPath) {
    const version = await getVersion(manualPath);
    const runtime = await getRuntime(manualPath);
    return { path: manualPath, version, runtime };
  }
  const detected = await detect();
  const path = detected?.path || null;
  return {
    path,
    version: path ? await getVersion(path) : "",
    runtime: detected?.runtime || "",
  };
}

export async function fetchEnvelope(extraArgs, timeoutMs = 30_000) {
  const output = await cliRun([...targetArgs(), ...extraArgs], timeoutMs);
  if (output.timed_out) throw new CliError(output);
  try {
    const envelope = parseEnvelope(output.stdout);
    envelope._raw = output;
    return envelope;
  } catch (error) {
    throw new CliError(output, error.message);
  }
}

export function fetchStatus() {
  return fetchEnvelope(["--status"]);
}

export async function fetchPreview(extraArgs) {
  const envelope = await fetchEnvelope(extraArgs);
  envelope.gate = gatePreview(envelope);
  return envelope;
}

export function cliExecute(extraArgs, timeoutMs = 120_000) {
  return fetchEnvelope(extraArgs, timeoutMs);
}

export function isTauriMissing(err) {
  return (
    !window.__TAURI_INTERNALS__
    || (err && typeof err.message === "string" && err.message.includes("__TAURI"))
  );
}

export class CliError extends Error {
  constructor(output = {}, extra = "") {
    const stdout = String(output.stdout ?? "");
    const stderr = String(output.stderr ?? "");
    const details = [extra, stderr.trim(), stdout.trim()].filter(Boolean);
    super(details.join("\n\n") || `exit ${output.exit_code ?? "unknown"}`);
    this.name = "CliError";
    this.output = output;
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = output.exit_code ?? null;
    this.timedOut = Boolean(output.timed_out);
  }
}
