export const ENVELOPE_SCHEMA = "grok-keysmith.envelope.v1";

const REQUIRED_COMPAT_SURFACES = [
  ["cursor", "skills"],
  ["cursor", "rules"],
  ["cursor", "agents"],
  ["cursor", "mcps"],
  ["cursor", "hooks"],
  ["cursor", "sessions"],
  ["claude", "skills"],
  ["claude", "rules"],
  ["claude", "agents"],
  ["claude", "mcps"],
  ["claude", "hooks"],
  ["claude", "sessions"],
  ["codex", "sessions"],
];

const KNOWN_BREAKTEST_BANK_CASES = {
  "prompts.txt": 24,
  "prompts-46.txt": 20,
};

const MIN_BREAKTEST_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_BREAKTEST_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const RUN_TIMEOUT_GRACE_MS = 30 * 1000;
const MAX_RUN_TIMEOUT_MS = MAX_BREAKTEST_TIMEOUT_MS + RUN_TIMEOUT_GRACE_MS;

export function parseEnvelope(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) throw new Error("empty CLI stdout");
  const data = JSON.parse(text);
  if (data?.schema !== ENVELOPE_SCHEMA) {
    throw new Error("unsupported CLI envelope schema");
  }
  return data;
}

function parseAppliedEnvelope(stdout, operation) {
  const envelope = parseEnvelope(stdout);
  const resultIsObject = envelope.result && typeof envelope.result === "object" && !Array.isArray(envelope.result);
  if (
    envelope.operation !== operation
    || envelope.preview !== false
    || envelope.apply !== true
    || typeof envelope.ok !== "boolean"
    || !Array.isArray(envelope.diagnostics)
    || (envelope.ok && !resultIsObject)
    || (envelope.result !== null && envelope.result !== undefined && !resultIsObject)
  ) {
    throw new Error(`invalid ${operation} envelope`);
  }
  return envelope;
}

export function parseRunEnvelope(stdout) {
  return parseAppliedEnvelope(stdout, "run");
}

export function parseBreaktestEnvelope(stdout) {
  return parseAppliedEnvelope(stdout, "breaktest");
}

function normalizedPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/\/+$/, "");
}

export function verifyGrokInspect(output = {}, expectedGrokDir = "") {
  if (output.timed_out) throw new Error("grok inspect timed out");
  if (output.exit_code !== 0) {
    throw new Error(String(output.stderr || "").trim() || `grok inspect exited with ${output.exit_code}`);
  }

  const stdout = String(output.stdout || "").trim();
  if (!stdout) throw new Error("grok inspect returned empty stdout");

  let inspect;
  try {
    inspect = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`grok inspect returned invalid JSON: ${error.message}`);
  }
  if (!inspect || typeof inspect !== "object" || Array.isArray(inspect)) {
    throw new Error("grok inspect JSON must be an object");
  }

  if (!Array.isArray(inspect.projectInstructions)) {
    throw new Error("projectInstructions is missing or invalid");
  }
  const expectedRule = expectedGrokDir
    ? `${normalizedPath(expectedGrokDir)}/rules/99-keysmith.md`
    : "/rules/99-keysmith.md";
  const instruction = inspect.projectInstructions.find((item) => {
    const path = normalizedPath(item?.path);
    return expectedGrokDir ? path === expectedRule : path.endsWith(expectedRule);
  });
  if (!instruction) throw new Error(`projectInstructions did not load ${expectedRule}`);
  const compatibilityStatus = String(instruction.compatibilityStatus || "enabled").toLowerCase();
  if (
    instruction.disabled === true
    || compatibilityStatus !== "enabled"
    || instruction.scope !== "global"
    || (instruction.fileType && instruction.fileType !== "rules")
  ) {
    throw new Error("99-keysmith.md is not an enabled global rule");
  }

  const cells = inspect.externalCompat?.cells;
  if (!Array.isArray(cells)) throw new Error("externalCompat.cells is missing or invalid");
  const cellsBySurface = new Map(cells.map((cell) => [
    `${String(cell?.vendor || "").toLowerCase()}:${String(cell?.surface || "").toLowerCase()}`,
    cell,
  ]));
  const missing = [];
  const enabled = [];
  for (const [vendor, surface] of REQUIRED_COMPAT_SURFACES) {
    const key = `${vendor}:${surface}`;
    const cell = cellsBySurface.get(key);
    if (!cell) missing.push(key);
    else if (cell.enabled !== false) enabled.push(key);
  }
  if (missing.length) throw new Error(`externalCompat missing disabled surfaces: ${missing.join(", ")}`);
  if (enabled.length) throw new Error(`externalCompat surfaces remain enabled: ${enabled.join(", ")}`);

  if (!Array.isArray(inspect.hooks)) throw new Error("hooks is missing or invalid");
  if (inspect.hooks.length) throw new Error(`active hooks remain: ${inspect.hooks.length}`);
  return inspect;
}

export function estimateBreaktestCaseCount(bank) {
  const bankName = String(bank || "").trim();
  if (!bankName || bankName.includes("/") || bankName.includes("\\")) return null;
  return KNOWN_BREAKTEST_BANK_CASES[bankName] ?? null;
}

export function shouldCreateFreshBreaktestRunDir({ outputDir, lastRunDir, extra = [] }) {
  return extra.length === 0
    && Boolean(String(outputDir || "").trim())
    && String(outputDir || "").trim() === String(lastRunDir || "").trim();
}

export function calculateBreaktestTimeoutMs({
  caseCount,
  mode = "default",
  repetitions = 1,
  concurrency = 1,
  timeout = 180,
  interval = 0,
}) {
  // Custom banks are not readable from the webview. Use the bounded maximum
  // instead of guessing a case count and terminating a valid long run early.
  if (caseCount === null || caseCount === undefined) return MAX_BREAKTEST_TIMEOUT_MS;
  const cases = Math.max(1, Math.floor(numberOr(caseCount, 1)));
  const reps = Math.max(1, Math.floor(numberOr(repetitions, 1)));
  const workers = Math.max(1, Math.floor(numberOr(concurrency, 1)));
  const perCaseSeconds = Math.max(0.1, numberOr(timeout, 180));
  const intervalSeconds = Math.max(0, numberOr(interval, 0));
  const modeCount = mode === "ab" ? 2 : 1;
  const totalJobs = cases * modeCount * reps;
  const waves = Math.ceil(totalJobs / workers);
  const executionSeconds = waves * perCaseSeconds;
  const serialIntervalSeconds = workers === 1 ? Math.max(0, totalJobs - 1) * intervalSeconds : 0;
  const startupAndReportSeconds = 60 + Math.min(totalJobs * 2, 300);
  const calculated = Math.ceil((executionSeconds + serialIntervalSeconds + startupAndReportSeconds) * 1000);
  return Math.min(MAX_BREAKTEST_TIMEOUT_MS, Math.max(MIN_BREAKTEST_TIMEOUT_MS, calculated));
}

export function calculateRunTimeoutMs(timeoutSeconds) {
  const seconds = numberOr(timeoutSeconds, 180);
  return Math.min(
    MAX_RUN_TIMEOUT_MS,
    Math.max(RUN_TIMEOUT_GRACE_MS + 100, Math.ceil(seconds * 1000) + RUN_TIMEOUT_GRACE_MS),
  );
}

export function gatePreview(envelope) {
  const blockers = envelope?.plan?.blockers || [];
  const diagnostics = envelope?.diagnostics || [];
  const ok =
    Boolean(envelope?.ok)
    && envelope?.preview === true
    && envelope?.apply === false
    && blockers.length === 0;
  return {
    ok,
    blockers,
    diagnostics,
    reason: ok ? "" : (blockers[0] || diagnostics[0] || "preview failed"),
  };
}

export function fingerprintShort(fp) {
  if (!fp?.sha256) return "";
  return `${fp.sha256.slice(0, 12)}…`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

async function sha256Text(value) {
  if (!globalThis.crypto?.subtle) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function previewSettings(settings = {}) {
  return {
    cliPath: settings.cliPath || "",
    grokBin: settings.grokBin || "",
    defaultGrokDir: settings.defaultGrokDir || "",
  };
}

export async function createPreviewBinding({ envelope, intent, settings }) {
  const fields = {
    operation: envelope?.operation || "",
    target: envelope?.target || null,
    plan: envelope?.plan || null,
    intent: intent || null,
    settings: previewSettings(settings),
  };
  const snapshot = stableStringify(fields);
  return {
    fields,
    snapshot,
    token: await sha256Text(snapshot),
  };
}

export function comparePreviewBindings(expected, actual) {
  const keys = ["operation", "target", "plan", "intent", "settings"];
  const changed = keys.filter(
    (key) => stableStringify(expected?.fields?.[key]) !== stableStringify(actual?.fields?.[key]),
  );
  return {
    ok: Boolean(expected && actual)
      && changed.length === 0
      && expected.snapshot === actual.snapshot
      && expected.token === actual.token,
    changed,
  };
}

function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeBreaktestEvent(payload = {}) {
  const data = payload?.detail || payload;
  const rawItem = data.item
    || data.record
    || (["case-start", "case-complete"].includes(data.type) ? data : null);
  let item = null;
  if (rawItem && typeof rawItem === "object") {
    const repetition = numberOr(rawItem.repetition, 1);
    const id = rawItem.id
      || [rawItem.num || "item", rawItem.mode || "default", repetition].join(":");
    item = {
      ...rawItem,
      id,
      repetition,
      status: rawItem.status
        || (data.type === "case-start" ? "running" : null)
        || (rawItem.cancelled ? "cancelled" : null)
        || (["error", "timeout"].includes(rawItem.verdict) ? "failed" : null)
        || (rawItem.verdict ? "completed" : "running"),
    };
  }
  return {
    runId: data.runId || data.run_id || "",
    total: optionalNumber(data.total),
    completed: optionalNumber(data.completed ?? data.done),
    failed: optionalNumber(data.failed ?? data.errors),
    item,
  };
}

export function mergeBreaktestItem(items, item) {
  if (!item) return items;
  const index = items.findIndex((entry) => entry.id === item.id);
  if (index < 0) return [...items, item];
  return items.map((entry, current) => (current === index ? { ...entry, ...item } : entry));
}

export function summarizeBreaktest(result = {}, items = [], progress = {}) {
  const verdicts = {};
  for (const item of items) {
    if (item.verdict) verdicts[item.verdict] = (verdicts[item.verdict] || 0) + 1;
  }
  const completedItems = items.filter((item) => ["completed", "failed", "cancelled"].includes(item.status)).length;
  const failedItems = items.filter(
    (item) => ["failed", "cancelled"].includes(item.status)
      || ["error", "timeout", "cancelled"].includes(item.verdict),
  ).length;
  return {
    total: numberOr(progress.total ?? result.total, items.length),
    completed: numberOr(progress.completed ?? completedItems, completedItems),
    failed: numberOr(progress.failed ?? failedItems, failedItems),
    verdicts,
  };
}
