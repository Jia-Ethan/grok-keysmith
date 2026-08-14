import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve({ stdout: "{}", stderr: "", exit_code: 0 })),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./settings.js", () => ({
  getSettings: () => ({
    cliPath: "",
    grokBin: "/opt/grok",
    defaultGrokDir: "/tmp/config.grok",
  }),
  normalizeCliPath: (value) => String(value || "").trim(),
}));

import {
  buildBreaktestArgs,
  buildRunArgs,
  defaultBreaktestRunDir,
  grokInspect,
  parseCliOutput,
} from "./api.js";

describe("buildRunArgs", () => {
  it("keeps global options before the run subcommand", () => {
    expect(buildRunArgs({
      prompt: "--starts-with-dashes",
      mode: "override",
      model: "grok-model",
      settings: {
        defaultGrokDir: "/tmp/config.grok",
        grokBin: "/opt/grok",
      },
    })).toEqual([
      "--json",
      "--lang",
      "en",
      "--grok-dir",
      "/tmp/config.grok",
      "run",
      "--mode",
      "override",
      "--prompt=--starts-with-dashes",
      "--grok-bin",
      "/opt/grok",
      "--model",
      "grok-model",
      "--timeout",
      "180",
    ]);
  });

  it("builds breaktest global and subcommand options in parser order", () => {
    expect(buildBreaktestArgs({
      bank: "prompts.txt",
      mode: "ab",
      repetitions: 2,
      timeout: 30,
      interval: 1,
      concurrency: 4,
      model: "grok-model",
      outputDir: "/tmp/run",
      settings: {
        defaultGrokDir: "/tmp/config.grok",
        grokBin: "/opt/grok",
      },
      extra: ["--resume"],
    })).toEqual([
      "--json", "--lang", "en", "--grok-dir", "/tmp/config.grok",
      "breaktest", "--bank", "prompts.txt", "--mode", "ab",
      "--repetitions", "2", "--timeout", "30", "--interval", "1",
      "--concurrency", "4", "--model", "grok-model",
      "--output-dir", "/tmp/run", "--grok-bin", "/opt/grok", "--resume",
    ]);
  });
});

describe("grokInspect", () => {
  beforeEach(() => invoke.mockClear());

  it("does not reuse the Grok config directory as a project cwd", async () => {
    await grokInspect();
    expect(invoke).toHaveBeenCalledWith("grok_inspect", {
      grokBin: "/opt/grok",
      cwd: null,
    });
  });
});

describe("defaultBreaktestRunDir", () => {
  beforeEach(() => invoke.mockClear());

  it("uses the tracked native default path command", async () => {
    await defaultBreaktestRunDir();
    expect(invoke).toHaveBeenCalledWith("default_breaktest_run_dir", undefined);
  });
});

describe("parseCliOutput", () => {
  const envelope = {
    schema: "grok-keysmith.envelope.v1",
    operation: "status",
    exit_code: 0,
  };

  it("requires the process and envelope exit codes to agree", () => {
    expect(parseCliOutput({
      stdout: JSON.stringify(envelope),
      stderr: "",
      exit_code: 0,
      timed_out: false,
    }).operation).toBe("status");
    expect(() => parseCliOutput({
      stdout: JSON.stringify(envelope),
      stderr: "",
      exit_code: 2,
      timed_out: false,
    })).toThrow(/exit code/);
  });
});
