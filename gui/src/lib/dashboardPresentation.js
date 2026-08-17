// Dashboard 首层呈现模型：把 status envelope 映射为“状态 + 说明 + 关键健康项 + 唯一行动”。
// SHA、deployment ID、完整备份文件名、inspect/manifest JSON 只进入 technical（默认折叠）。
import { translateRawList } from "./statusText.js";

export function presentDashboard({ state, grokDir = "", result = {} }, t) {
  const drift = result.drift || [];
  const conflicts = result.conflicts || [];
  const residue = result.residue || [];
  const backups = result.backups || [];
  const hooks = result.hooks || {};
  const activeHooks = hooks.active?.length || 0;
  const disabledHooks = hooks.disabled?.length || 0;
  const nodes = result.nodes || {};
  const ruleKind = nodes.rule?.kind || "missing";
  const ruleOk = ruleKind === "regular";
  const configKind = nodes.config?.kind || "missing";
  const configNodeOk = ["regular", "missing"].includes(configKind);
  const compat = result.compat || {};
  const issues = [...drift, ...conflicts];
  const ruleIssues = issues.filter((item) => /\brule\b/i.test(String(item)));
  const hookIssues = issues.filter((item) => /hook/i.test(String(item)));
  const configIssues = issues.filter((item) => (
    !ruleIssues.includes(item) && !hookIssues.includes(item)
  ));

  const primaryAction = (() => {
    if (state === "recovery-required") return { key: "recover", view: "manage" };
    if (state === "drift" || state === "conflict") return { key: "issues", view: "manage" };
    if (state === "not-installed") return { key: "deploy", view: "deploy" };
    return null;
  })();

  const health = state === "not-installed" ? [] : [
    {
      key: "rule",
      ok: ruleOk && ruleIssues.length === 0,
      detail: ruleIssues.length > 0
        ? translateRawList(ruleIssues, t).join("；")
        : (ruleOk ? "" : t("dash.nodeIssue")),
    },
    {
      key: "config",
      ok: configNodeOk && configIssues.length === 0
        && compat.present === true && compat.matches_expected === true,
      detail: configIssues.length > 0
        ? translateRawList(configIssues, t).join("；")
        : (!configNodeOk || compat.present !== true || compat.matches_expected !== true
          ? t("dash.configInactive")
          : ""),
    },
    {
      key: "hooks",
      ok: activeHooks === 0 && hookIssues.length === 0,
      detail: hookIssues.length > 0
        ? translateRawList(hookIssues, t).join("；")
        : (activeHooks + disabledHooks > 0
        ? t("dash.hooksDetail", { active: activeHooks, disabled: disabledHooks })
        : ""),
    },
    {
      key: "recovery",
      ok: residue.length === 0,
      detail: residue.length > 0 ? t("dash.recoveryNeeded") : "",
    },
  ];

  return {
    state,
    grokDir,
    primaryAction,
    health,
    // 首层只显示数量；最近文件名属于完整记录，留在默认折叠的技术详情。
    backupsSummary: backups.length > 0
      ? t("dash.backupsCount", { count: backups.length })
      : "",
    technical: {
      manifest: result.manifest || null,
      rule: result.nodes?.rule?.fingerprint || null,
      compat: result.compat || null,
      drift,
      conflicts,
      residue,
      backups,
    },
  };
}
