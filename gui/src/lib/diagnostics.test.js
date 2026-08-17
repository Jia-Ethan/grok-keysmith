// 页面级回归：诊断导出内容完整且敏感字段脱敏。
import { describe, expect, it } from "vitest";
import {
  buildDiagnosticsPayload,
  redactDiagnosticPaths,
  redactSetting,
} from "./diagnostics.js";

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
      manifest: {
        deployment_id: "dep-9",
        previous_manifest_backup: "/home/someone/.grok/manifest.json.backup",
      },
      detectedCli: { path: "/Users/someone/bin/grok-keysmith", runtime: "executable" },
      detectedGrok: { path: "C:\\Users\\someone\\bin\\grok.exe", runtime: "executable" },
    });

    expect(payload.settings.cliPath).toBe("[set]");
    expect(payload.settings.grokBin).toBe("[set]");
    expect(payload.settings.defaultGrokDir).toBe("[path]");
    expect(payload.cli.path).toBe("[path]");
    expect(payload.status.target.grok_dir).toBe("[path]");
    expect(payload.manifest.previous_manifest_backup).toBe("[path]");
    expect(payload.detectedCli.path).toBe("[path]");
    expect(payload.detectedGrok.path).toBe("[path]");
    expect(JSON.stringify(payload)).not.toMatch(/someone|\/home\/|\/Users\/|C:\\\\Users/);
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

  it("递归处理数组、嵌套路径字段和错误文本中的绝对路径", () => {
    const redacted = redactDiagnosticPaths({
      nested: {
        projectInstructions: [
          { path: "/Users/alice/.grok/Agents.md", scope: "global" },
          { filePath: "C:\\Users\\alice\\rules\\rule.md" },
        ],
      },
      errors: [
        "failed to read /private/tmp/grok-keysmith/state.json: denied",
        "source file:///Users/alice/.grok/config.toml is invalid",
        "普通诊断文本保持不变",
      ],
    });

    expect(redacted.nested.projectInstructions[0]).toEqual({
      path: "[path]",
      scope: "global",
    });
    expect(redacted.nested.projectInstructions[1].filePath).toBe("[path]");
    expect(redacted.errors[0]).toBe("[path]");
    expect(redacted.errors[1]).toBe("[path]");
    expect(redacted.errors[2]).toBe("普通诊断文本保持不变");
  });

  it("包含空格的 POSIX/Windows 私人路径不会残留部分目录", () => {
    const redacted = redactDiagnosticPaths([
      "failed /Users/alice/My Folder/a.txt: denied",
      "failed C:\\Users\\alice\\My Folder\\a.txt: denied",
    ]);
    expect(redacted).toEqual(["[path]", "[path]"]);
  });
});
