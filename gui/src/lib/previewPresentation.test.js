// 页面级回归：部署确认界面不显示 token/SHA，管理页确认不显示原始 plan/token。
import { describe, expect, it } from "vitest";
import {
  deployConfirmBody,
  deployPreviewSummary,
  manageStatusPresentation,
  managePlanSummary,
  operationIssuePresentation,
  previewGatePresentation,
} from "./previewPresentation.js";

const SHA = "d693411fd79f57c5e805e7bcbb27b42bacdd11e6a6af8858ab998017196dc898";
const TOKEN = "7faa73ca803ce4b7608c75172cb29a6d28ca0155fb43decb09f582d526a1112c";

const t = (key, params) => {
  const table = {
    "deploy.sourceSummary": `来源：${params?.source}`,
    "deploy.willModify": "将写入规则并更新 Grok 配置",
    "deploy.isolateHooks": `将隔离 ${params?.count} 个 hooks`,
    "deploy.noHooksIsolated": "不需要隔离 hooks",
    "deploy.stripCompat": "将移除外部 compat 配置",
    "deploy.blocked": "存在阻塞，无法部署",
    "deploy.confirmBody": `目标目录：${params?.dir}\n来源：${params?.source}\n将修改 Grok 规则与配置，CLI 会自动备份。`,
    "manage.planReconcile": "将重新写入兼容隔离标记，并保留其他配置",
    "manage.planUninstall": "将移除受管规则与配置，恢复部署前状态",
    "manage.planRestoreHooks": "将重新启用本工具禁用的 hooks",
    "manage.planCleanResidue": `将清理 ${params?.count} 项中断事务残留`,
    "manage.planGeneric": "将执行选中的维护操作",
    "common.issue.recovery": "存在中断操作，请先完成恢复",
    "common.issue.busy": "其他操作正在进行，请稍后重试",
    "common.issue.hooks": "hooks 状态需要处理",
    "common.issue.changed": "目标状态已变化，请刷新后重试",
    "common.issue.conflict": "检测到冲突，需要先处理",
    "common.issue.generic": "操作暂时无法继续，请查看技术详情",
    "dash.summary.repairable": "兼容隔离取值仍对齐，只需重新写入标记。",
    "dash.summary.drift": "Grok 配置已发生变化，与预期状态不一致。",
    "dash.summary.conflict": "检测到冲突内容，需要先处理后再继续。",
    "dash.summary.recovery-required": "存在中断的操作，建议立即恢复。",
    fallback: "操作失败",
  };
  return table[key] || key;
};

describe("部署预览与确认呈现", () => {
  const plan = {
    prompt_source: "bundled",
    prompt_sha256: SHA,
    confirmation_token: TOKEN,
    hooks_to_isolate: ["a.js"],
    config: { stripped_external_compat: ["[compat.cursor]"], will_write_markers: true },
    blockers: [],
  };

  it("预览用户文案不含 token 与完整 SHA", () => {
    const summary = deployPreviewSummary(plan, "内置 Markdown", t);
    const text = summary.lines.join("\n");
    expect(text).not.toContain(SHA);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("confirmation_token");
    expect(text).toContain("内置 Markdown");
    expect(text).toContain("将隔离 1 个 hooks");
    expect(summary.blocked).toBe(false);
  });

  it("确认弹窗只显示目标目录、来源和操作影响", () => {
    const body = deployConfirmBody({ grokDir: "/Users/x/.grok", sourceLabel: "内置 Markdown" }, t);
    expect(body).toContain("/Users/x/.grok");
    expect(body).toContain("内置 Markdown");
    expect(body).toContain("自动备份");
    expect(body).not.toContain(SHA);
    expect(body).not.toContain(TOKEN);
  });

  it("阻塞状态正确上报", () => {
    const summary = deployPreviewSummary({
      ...plan,
      blockers: ["interrupted transaction present; run --recover first"],
    }, "s", t);
    expect(summary.blocked).toBe(true);
    expect(summary.issueLines).toEqual(["存在中断操作，请先完成恢复"]);
    expect(summary.lines.join("\n")).not.toContain("interrupted transaction");
  });

  it("gate 原因只以用户摘要进入正文，原始内容留在详情", () => {
    const envelope = {
      gate: { reason: "active hook has an existing disabled peer: session.json" },
      plan: { blockers: ["active hook has an existing disabled peer: session.json"] },
      diagnostics: ["absolute /Users/x/.grok/hooks/session.json"],
    };
    const issue = previewGatePresentation(envelope, "fallback", t);
    expect(issue.summary).toBe("hooks 状态需要处理");
    expect(issue.summary).not.toContain("session.json");
    expect(issue.details).toContain("session.json");
    expect(issue.details).toContain("/Users/x/.grok");
  });
});

describe("管理页确认呈现", () => {
  it("recover 摘要只描述残留数量，不带原始 plan", () => {
    const lines = managePlanSummary({ journals: ["j1", "j2"], confirmation_token: TOKEN }, "recover", t);
    expect(lines.join("\n")).toContain("2 项中断事务残留");
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain("j1");
  });

  it("restore/uninstall 使用用户语言", () => {
    expect(managePlanSummary({}, "restore", t)[0]).toContain("hooks");
    expect(managePlanSummary({}, "uninstall", t)[0]).toContain("部署前状态");
    expect(managePlanSummary({}, "reconcile", t)[0]).toContain("兼容隔离标记");
  });

  it("plan 为 null 时退回通用描述", () => {
    expect(managePlanSummary(null, "recover", t)[0]).toBe("将执行选中的维护操作");
  });

  it("阻塞原因使用用户语言，原始原因不进入确认摘要", () => {
    const lines = managePlanSummary({ blockers: ["config content does not match managed after-state"] }, "uninstall", t);
    expect(lines).toContain("目标状态已变化，请刷新后重试");
    expect(lines.join("\n")).not.toContain("managed after-state");
  });
});

describe("管理状态门禁", () => {
  it("未安装时禁用全部不适用操作", () => {
    expect(manageStatusPresentation({
      state: "not-installed",
      manifest: null,
      hooks: { owned_disabled: [] },
      residue: [],
    }, t)).toMatchObject({
      canReconcile: false,
      canUninstall: false,
      canRestore: false,
      canRecover: false,
    });
  });

  it("只为真实存在的受管状态开放对应操作", () => {
    expect(manageStatusPresentation({
      state: "active-aligned",
      manifest: { deployment_id: "d1" },
      hooks: { owned_disabled: ["owned.json.disabled"], external_disabled: ["other.json.disabled"] },
      residue: ["journal-1"],
    }, t)).toMatchObject({
      canUninstall: false,
      canRestore: false,
      canRecover: true,
    });
  });

  it("可修复 drift 只开放 reconcile", () => {
    expect(manageStatusPresentation({
      state: "drift",
      manifest: { deployment_id: "d1" },
      hooks: { owned_disabled: [] },
      residue: [],
      drift: ["config fingerprint drifted; compat values aligned"],
      compat: { present: false, matches_expected: false, values_aligned: true, repairable: true },
    }, t)).toMatchObject({
      canReconcile: true,
      canUninstall: true,
      canRestore: false,
      canRecover: false,
      issueLines: ["兼容隔离取值仍对齐，只需重新写入标记。"],
    });
  });

  it("manifest 异常但受管规则仍存在时保留卸载入口", () => {
    expect(manageStatusPresentation({
      state: "conflict",
      manifest: null,
      nodes: { rule: { kind: "regular" } },
      compat: { present: true },
      hooks: { owned_disabled: [] },
      residue: [],
    }, t).canUninstall).toBe(true);
  });

  it("drift/conflict 仅在正文呈现用户摘要，原始内容保留在详情", () => {
    const model = manageStatusPresentation({
      state: "drift",
      manifest: { deployment_id: "d1" },
      hooks: { owned_disabled: [] },
      drift: ["config content does not match managed after-state"],
      conflicts: ["rule node is symlink"],
      residue: [],
    }, t);
    expect(model.issueLines).toEqual([
      "Grok 配置已发生变化，与预期状态不一致。",
      "检测到冲突内容，需要先处理后再继续。",
    ]);
    expect(model.issueLines.join("\n")).not.toContain("managed after-state");
    expect(model.technicalDetails).toContain("managed after-state");
    expect(model.technicalDetails).toContain("symlink");
  });
});

describe("操作错误呈现", () => {
  it("未知原始错误不会直接进入用户摘要", () => {
    const issue = operationIssuePresentation({
      values: ["private path /Users/x/.grok exploded"],
      fallbackKey: "fallback",
    }, t);
    expect(issue.summary).toBe("操作暂时无法继续，请查看技术详情");
    expect(issue.summary).not.toContain("/Users/x");
    expect(issue.details).toContain("/Users/x");
  });
});
