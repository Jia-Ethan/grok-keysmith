// 部署/管理预览与确认的用户语言呈现。
// token、完整 SHA、原始诊断等只在内部 binding 与默认折叠的技术详情中使用。

function rawValues(...values) {
  const flattened = values.flat(Infinity)
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return [...new Set(flattened)];
}

function issueKey(value) {
  const text = String(value ?? "").toLowerCase();
  if (/interrupted|journal|residu|recover/.test(text)) return "recovery";
  if (/lock|busy|already in use|another operation/.test(text)) return "busy";
  if (/hook/.test(text)) return "hooks";
  if (/drift|does not match|changed|stale|rebound/.test(text)) return "changed";
  if (/conflict|unexpected|symlink|not a directory|node is|invalid/.test(text)) return "conflict";
  return "generic";
}

function userIssueLines(values, t) {
  return [...new Set(rawValues(values).map((value) => t(`common.issue.${issueKey(value)}`)))];
}

export function operationIssuePresentation({ values = [], fallbackKey }, t) {
  const details = rawValues(values);
  const issueLines = userIssueLines(details, t);
  return {
    summary: issueLines[0] || t(fallbackKey),
    details: details.join("\n"),
  };
}

export function previewGatePresentation(envelope, fallbackKey, t) {
  return operationIssuePresentation({
    values: [
      envelope?.plan?.blockers || [],
      envelope?.gate?.reason || "",
      envelope?.diagnostics || [],
    ],
    fallbackKey,
  }, t);
}

export function deployPreviewSummary(plan, sourceLabel, t) {
  const hooksToIsolate = plan?.hooks_to_isolate || [];
  const strippedCompat = plan?.config?.stripped_external_compat || [];
  const blockers = plan?.blockers || [];
  return {
    lines: [
      t("deploy.sourceSummary", { source: sourceLabel }),
      t("deploy.willModify"),
      hooksToIsolate.length > 0
        ? t("deploy.isolateHooks", { count: hooksToIsolate.length })
        : t("deploy.noHooksIsolated"),
      ...(strippedCompat.length > 0 ? [t("deploy.stripCompat")] : []),
    ],
    blocked: blockers.length > 0,
    issueLines: userIssueLines(blockers, t),
  };
}

export function deployConfirmBody({ grokDir, sourceLabel }, t) {
  return t("deploy.confirmBody", { dir: grokDir || "—", source: sourceLabel });
}

// 管理页：将原始 plan 转为用户可读的操作清单；token、SHA 不进入确认弹窗。
export function managePlanSummary(plan, kind, t) {
  const lines = [];
  const journals = Array.isArray(plan?.journals) ? plan.journals.length : 0;
  if (kind === "recover") {
    lines.push(journals > 0
      ? t("manage.planCleanResidue", { count: journals })
      : t("manage.planGeneric"));
  } else if (kind === "restore") {
    lines.push(t("manage.planRestoreHooks"));
  } else if (kind === "reconcile") {
    lines.push(t("manage.planReconcile"));
  } else {
    lines.push(t("manage.planUninstall"));
  }
  if (Array.isArray(plan?.blockers) && plan.blockers.length) {
    lines.push(t("deploy.blocked"));
    lines.push(...userIssueLines(plan.blockers, t));
  }
  return lines;
}

export function manageStatusPresentation(result, t) {
  const state = result?.state || "not-installed";
  const hooks = result?.hooks || {};
  const ownedDisabled = Array.isArray(hooks.owned_disabled) ? hooks.owned_disabled : [];
  const residue = Array.isArray(result?.residue) ? result.residue : [];
  const drift = Array.isArray(result?.drift) ? result.drift : [];
  const conflicts = Array.isArray(result?.conflicts) ? result.conflicts : [];
  const installed = state !== "not-installed" && (
    Boolean(result?.manifest)
    || result?.nodes?.rule?.kind === "regular"
    || result?.compat?.present === true
  );
  const repairable = result?.compat?.repairable === true && residue.length === 0;
  const issueLines = [];
  if (repairable) issueLines.push(t("dash.summary.repairable"));
  else if (drift.length) issueLines.push(t("dash.summary.drift"));
  if (conflicts.length) issueLines.push(t("dash.summary.conflict"));
  if (residue.length) issueLines.push(t("dash.summary.recovery-required"));
  return {
    installed,
    canReconcile: repairable,
    canUninstall: installed && residue.length === 0 && !repairable,
    canRestore: ownedDisabled.length > 0 && residue.length === 0 && !repairable,
    canRecover: residue.length > 0,
    issueLines,
    technicalDetails: rawValues(drift, conflicts, residue).join("\n"),
  };
}
