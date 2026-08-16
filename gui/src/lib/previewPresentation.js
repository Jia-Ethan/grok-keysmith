// 部署/管理预览与确认的用户语言呈现。
// token、完整 SHA、compat markers、stripped config 等只在内部 binding 与
// 默认折叠的技术详情中使用，不进入普通界面正文与确认弹窗。

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
  } else {
    lines.push(t("manage.planUninstall"));
  }
  if (Array.isArray(plan?.blockers) && plan.blockers.length) {
    lines.push(t("deploy.blocked"));
  }
  return lines;
}
