// 页面级回归：Dashboard 首层信息架构。
// 首层只回答“当前是否正常、有什么问题、现在该做什么”，
// SHA、source commit、备份文件名、inspect/manifest JSON 与空诊断字段一律不出现。
import { describe, expect, it } from "vitest";
import { presentDashboard } from "./dashboardPresentation.js";

const SHA = "d693411fd79f57c5e805e7bcbb27b42bacdd11e6a6af8858ab998017196dc898";

function makeResult(overrides = {}) {
  return {
    state: "active-aligned",
    nodes: {
      rule: { kind: "regular", fingerprint: { sha256: SHA, size: 8391 } },
      config: { kind: "regular" },
      manifest: { kind: "regular" },
    },
    compat: { present: true, matches_expected: true },
    hooks: { active: [], disabled: [], owned_disabled: [], external_disabled: [] },
    manifest: { deployment_id: "dep-1", prompt_sha256: SHA },
    backups: [],
    residue: [],
    drift: [],
    conflicts: [],
    ...overrides,
  };
}

const t = (key, params) => {
  const table = {
    "raw.configChanged": "Grok 配置已发生变化",
    "dash.hooksDetail": `active ${params?.active} / disabled ${params?.disabled}`,
    "dash.recoveryNeeded": "检测到事务残留",
    "dash.backupsCount": `备份 ${params?.count} 份`,
    "dash.nodeIssue": "节点异常",
    "dash.configInactive": "配置未生效",
  };
  return table[key] || key;
};

// 只展开首层渲染字段；technical 属于默认折叠的技术详情，不在首层断言范围。
function flatten(model) {
  const { technical, ...firstLayer } = model;
  return JSON.stringify(firstLayer);
}

describe("Dashboard 首层呈现", () => {
  it("正常状态不出现 SHA、备份文件名、inspect/manifest JSON 与空诊断字段", () => {
    const model = presentDashboard({
      state: "active-aligned",
      grokDir: "/tmp/x/.grok",
      result: makeResult({
        backups: ["backup-a.tar.gz", "backup-b.tar.gz"],
      }),
    }, t);
    const text = flatten(model);
    expect(text).not.toContain(SHA);
    expect(text).not.toContain("sha256");
    expect(text).not.toContain("backup-a");
    expect(text).not.toContain("deployment_id");
    expect(text).not.toContain("dep-1");
    expect(text).not.toContain("sourceCommit");
    expect(text).not.toContain("absent");
    expect(text).not.toContain("active 0 / disabled 0");
    expect(model.health.every((row) => row.ok)).toBe(true);
    expect(model.primaryAction).toBeNull();
    // 正常状态不渲染空的 drift/conflict/residue 细节
    expect(model.health.find((row) => row.key === "config").detail).toBe("");
    expect(model.health.find((row) => row.key === "recovery").detail).toBe("");
  });

  it("drift 状态翻译已知原始错误并提供查看问题操作", () => {
    const model = presentDashboard({
      state: "drift",
      grokDir: "/tmp/x/.grok",
      result: makeResult({
        state: "drift",
        drift: ["config content does not match managed after-state"],
      }),
    }, t);
    expect(model.state).toBe("drift");
    expect(model.primaryAction).toEqual({ key: "issues", view: "manage" });
    const config = model.health.find((row) => row.key === "config");
    expect(config.ok).toBe(false);
    expect(config.detail).toContain("Grok 配置已发生变化");
    expect(config.detail).not.toContain("after-state");
  });

  it("conflict 状态提供查看问题操作", () => {
    const model = presentDashboard({
      state: "conflict",
      grokDir: "/tmp/x/.grok",
      result: makeResult({ state: "conflict", conflicts: ["unexpected managed content"] }),
    }, t);
    expect(model.primaryAction?.view).toBe("manage");
    expect(model.health.find((row) => row.key === "config").ok).toBe(false);
  });

  it("配置漂移不会误报正常规则节点", () => {
    const model = presentDashboard({
      state: "drift",
      result: makeResult({ drift: ["config content does not match managed after-state"] }),
    }, t);
    expect(model.health.find((row) => row.key === "rule").ok).toBe(true);
    expect(model.health.find((row) => row.key === "config").ok).toBe(false);
  });

  it("规则异常只标记规则健康项", () => {
    const model = presentDashboard({
      state: "conflict",
      result: makeResult({ conflicts: ["managed rule node is directory"] }),
    }, t);
    expect(model.health.find((row) => row.key === "rule").ok).toBe(false);
    expect(model.health.find((row) => row.key === "config").ok).toBe(true);
  });

  it("recovery-required 突出恢复中断操作", () => {
    const model = presentDashboard({
      state: "recovery-required",
      grokDir: "/tmp/x/.grok",
      result: makeResult({ state: "recovery-required", residue: ["journal-1"] }),
    }, t);
    expect(model.primaryAction).toEqual({ key: "recover", view: "manage" });
    const recovery = model.health.find((row) => row.key === "recovery");
    expect(recovery.ok).toBe(false);
    expect(recovery.detail).toContain("事务残留");
  });

  it("未部署提供开始部署操作", () => {
    const model = presentDashboard({
      state: "not-installed",
      grokDir: "/tmp/x/.grok",
      result: makeResult({ state: "not-installed" }),
    }, t);
    expect(model.primaryAction).toEqual({ key: "deploy", view: "deploy" });
    expect(model.health).toEqual([]);
  });

  it("hooks 仅在非零时渲染数量", () => {
    const model = presentDashboard({
      state: "active-aligned",
      grokDir: "/tmp/x/.grok",
      result: makeResult({ hooks: { active: ["a"], disabled: ["b"], owned_disabled: [], external_disabled: [] } }),
    }, t);
    const hooks = model.health.find((row) => row.key === "hooks");
    expect(hooks.ok).toBe(false);
    expect(hooks.detail).toBe("active 1 / disabled 1");
  });

  it("备份首层只显示数量，完整文件名留在技术详情", () => {
    const backups = Array.from({ length: 36 }, (_, i) => `backup-${i}.tar.gz`);
    const model = presentDashboard({
      state: "active-aligned",
      grokDir: "/tmp/x/.grok",
      result: makeResult({ backups }),
    }, t);
    expect(model.backupsSummary).toBe("备份 36 份");
    expect(model.backupsSummary).not.toContain("backup-35.tar.gz");
    expect(model.backupsSummary).not.toContain("backup-0.tar.gz");
    expect(model.technical.backups).toHaveLength(36);
    expect(model.technical.backups[35]).toBe("backup-35.tar.gz");
  });
});
