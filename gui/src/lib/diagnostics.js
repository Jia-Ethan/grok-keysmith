// 诊断负载构造：导出与默认折叠展示共用同一 payload。
// 凭证类字段（手动 CLI 路径、Grok binary 路径）只保留是否已设置，不导出原值。

export function redactSetting(value) {
  return value ? "[set]" : "";
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
  return {
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
}
