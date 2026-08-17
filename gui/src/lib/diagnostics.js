// 诊断负载构造：导出与默认折叠展示共用同一 payload。
// 路径会在整个对象树上统一脱敏，避免后端新增字段时意外导出本机信息。

const PATH_KEY = /(?:^|_)(?:path|dir|directory|cwd|file)(?:$|_)/i;
const CAMEL_PATH_KEY = /(?:Path|Dir|Directory|Cwd|File)$/;
const EMBEDDED_ABSOLUTE_PATH = /file:\/\/\/|(^|[\s("'=\[])(?:\/[^\s/]|[A-Za-z]:[\\/]|\\\\)/;

export function redactSetting(value) {
  return value ? "[set]" : "";
}

function isPathKey(key) {
  return PATH_KEY.test(key) || CAMEL_PATH_KEY.test(key);
}

function isAbsolutePath(value) {
  return value.startsWith("/")
    || /^[A-Za-z]:[\\/]/.test(value)
    || value.startsWith("\\\\")
    || value.startsWith("file:///");
}

function redactPathsInText(value) {
  // Free-form process errors cannot reliably delimit paths containing spaces.
  // Redact the complete diagnostic rather than risk leaking a partial path.
  if (isAbsolutePath(value) || EMBEDDED_ABSOLUTE_PATH.test(value)) return "[path]";
  return value;
}

export function redactDiagnosticPaths(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticPaths(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactDiagnosticPaths(childValue, childKey),
      ]),
    );
  }
  if (typeof value !== "string" || !value) return value;
  if (value === "[set]" || value === "[path]") return value;
  if (isPathKey(key)) return "[path]";
  return redactPathsInText(value);
}

export function buildDiagnosticsPayload({
  buildInfo,
  cliInfo = {},
  settings = {},
  status = null,
  inspect = null,
  manifest = null,
  detectedCli = null,
  detectedGrok = null,
}) {
  const payload = {
    desktop: buildInfo,
    cli: {
      path: cliInfo.path || null,
      version: cliInfo.version || "",
      runtime: cliInfo.runtime || "",
    },
    settings: {
      ...settings,
      cliPath: redactSetting(settings.cliPath),
      grokBin: redactSetting(settings.grokBin),
    },
    detectedCli,
    detectedGrok,
    status: status
      ? {
          state: status.result?.state,
          manifest: status.result?.manifest || null,
          rule: status.result?.nodes?.rule?.fingerprint || null,
          compat: status.result?.compat || null,
          hooks: status.result?.hooks || null,
          drift: status.result?.drift || [],
          conflicts: status.result?.conflicts || [],
          residue: status.result?.residue || [],
          backups: status.result?.backups || [],
          target: status.target || null,
        }
      : null,
    inspect,
    manifest,
  };
  return redactDiagnosticPaths(payload);
}
