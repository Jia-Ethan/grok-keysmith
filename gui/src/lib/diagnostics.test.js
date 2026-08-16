// 页面级回归：诊断导出内容完整且敏感字段脱敏。
import { describe, expect, it } from "vitest";
import { buildDiagnosticsPayload, redactSetting } from "./diagnostics.js";

describe("诊断负载", () => {
  it("手动 CLI/Grok 路径脱敏为 [set]，其余诊断字段完整保留", () => {
    const payload = buildDiagnosticsPayload({
      buildInfo: { desktopVersion: "0.1.0", channel: "development", sourceCommit: null },
      cliInfo: { path: "/usr/local/bin/grok-keysmith", version: "0.4.0-dev", runtime: "python" },
      settings: {
        cliPath: "/home/someone/tools/grok-keysmith.py",
        grokBin: "/home/someone/bin/grok",
        defaultGrokDir: "/home/someone/.grok",
        lang: "zh-CN",
        theme: "dark",
        showAdvancedTools: true,
      },
      status: {
        target: { grok_dir: "/home/someone/.grok" },
        result: {
          state: "drift",
          manifest: { prompt_sha256: "abc", deployment_id: "dep-9" },
          nodes: { rule: { fingerprint: { sha256: "abc" } } },
          compat: { present: true },
          hooks: { active: [], disabled: ["x"] },
          drift: ["config content does not match managed after-state"],
          conflicts: [],
          residue: [],
          backups: ["backup-1.tar.gz"],
        },
      },
      inspect: { grokVersion: "1.2.3" },
      manifest: { deployment_id: "dep-9" },
    });

    expect(payload.settings.cliPath).toBe("[set]");
    expect(payload.settings.grokBin).toBe("[set]");
    expect(JSON.stringify(payload)).not.toContain("/home/someone/tools");
    expect(JSON.stringify(payload)).not.toContain("/home/someone/bin/grok");
    // 诊断内容完整：drift、hooks、inspect、manifest、备份详情都在
    expect(payload.status.state).toBe("drift");
    expect(payload.status.drift).toHaveLength(1);
    expect(payload.status.backups).toEqual(["backup-1.tar.gz"]);
    expect(payload.inspect.grokVersion).toBe("1.2.3");
    expect(payload.manifest.deployment_id).toBe("dep-9");
    expect(payload.status.manifest.prompt_sha256).toBe("abc");
  });

  it("空设置不标记 [set]", () => {
    expect(redactSetting("")).toBe("");
    expect(redactSetting(null)).toBe("");
    expect(redactSetting("/x")).toBe("[set]");
  });

  it("无 status 时 payload.status 为 null", () => {
    const payload = buildDiagnosticsPayload({ buildInfo: {}, settings: {} });
    expect(payload.status).toBeNull();
  });
});
