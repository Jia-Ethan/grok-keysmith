import { describe, expect, it } from "vitest";
import {
  ENVELOPE_SCHEMA,
  calculateBreaktestTimeoutMs,
  calculateRunTimeoutMs,
  comparePreviewBindings,
  createPreviewBinding,
  estimateBreaktestCaseCount,
  gatePreview,
  mergeBreaktestItem,
  normalizeBreaktestEvent,
  parseBreaktestEnvelope,
  parseEnvelope,
  parseRunEnvelope,
  shouldCreateFreshBreaktestRunDir,
  stableStringify,
  summarizeBreaktest,
  verifyGrokInspect,
} from "./contract.js";

const sample = {
  schema: ENVELOPE_SCHEMA,
  tool: "grok-keysmith",
  version: "0.4.0",
  operation: "deploy",
  preview: true,
  apply: false,
  ok: true,
  target: { grok_dir: "/tmp/fake.grok" },
  plan: { blockers: [] },
  result: null,
  diagnostics: [],
  exit_code: 0,
};

describe("parseEnvelope", () => {
  it("accepts versioned JSON only", () => {
    expect(parseEnvelope(JSON.stringify(sample)).operation).toBe("deploy");
    expect(() => parseEnvelope("not json")).toThrow();
    expect(() => parseEnvelope(JSON.stringify({ ...sample, schema: "nope" }))).toThrow();
  });

  it("validates run-specific envelope fields", () => {
    const run = {
      ...sample,
      operation: "run",
      preview: false,
      apply: true,
      result: { stdout: "ok", stderr: "" },
    };
    expect(parseRunEnvelope(JSON.stringify(run)).result.stdout).toBe("ok");
    expect(() => parseRunEnvelope("")).toThrow();
    expect(() => parseRunEnvelope(JSON.stringify({ ...run, operation: "breaktest" }))).toThrow();
    expect(() => parseRunEnvelope(JSON.stringify({ ...run, result: null }))).toThrow();

    const breaktest = { ...run, operation: "breaktest", result: { run_dir: "/tmp/run" } };
    expect(parseBreaktestEnvelope(JSON.stringify(breaktest)).result.run_dir).toBe("/tmp/run");
    expect(() => parseBreaktestEnvelope(JSON.stringify({ ...breaktest, operation: "run" }))).toThrow();
  });
});

describe("grok inspect verification", () => {
  const inspect = {
    projectInstructions: [{
      path: "/tmp/config.grok/rules/99-keysmith.md",
      scope: "global",
      fileType: "rules",
    }],
    externalCompat: {
      cells: [
        ...["cursor", "claude"].flatMap((vendor) => (
          ["skills", "rules", "agents", "mcps", "hooks", "sessions"]
            .map((surface) => ({ vendor, surface, enabled: false }))
        )),
        { vendor: "codex", surface: "sessions", enabled: false },
      ],
    },
    hooks: [],
  };

  function output(payload = inspect) {
    return { stdout: JSON.stringify(payload), stderr: "", exit_code: 0, timed_out: false };
  }

  it("requires the global rule, disabled compat surfaces, and no active hooks", () => {
    expect(verifyGrokInspect(output(), "/tmp/config.grok")).toEqual(inspect);
    expect(() => verifyGrokInspect(output({ ...inspect, projectInstructions: [] }), "/tmp/config.grok"))
      .toThrow(/projectInstructions/);
    expect(() => verifyGrokInspect(output({
      ...inspect,
      externalCompat: {
        cells: inspect.externalCompat.cells.map((cell, index) => (
          index === 0 ? { ...cell, enabled: true } : cell
        )),
      },
    }), "/tmp/config.grok")).toThrow(/remain enabled/);
    expect(() => verifyGrokInspect(output({ ...inspect, hooks: [{ name: "active" }] }), "/tmp/config.grok"))
      .toThrow(/active hooks/);
  });

  it("rejects transport and JSON failures", () => {
    expect(() => verifyGrokInspect({ stdout: "{}", stderr: "boom", exit_code: 2, timed_out: false }))
      .toThrow(/boom/);
    expect(() => verifyGrokInspect({ stdout: "not json", stderr: "", exit_code: 0, timed_out: false }))
      .toThrow(/invalid JSON/);
  });
});

describe("breaktest total timeout", () => {
  it("uses bank size, mode, repetitions, concurrency, and per-case timeout", () => {
    expect(estimateBreaktestCaseCount("prompts.txt")).toBe(24);
    expect(estimateBreaktestCaseCount("prompts-46.txt")).toBe(20);
    expect(estimateBreaktestCaseCount("C:\\bank\\prompts-46.txt")).toBeNull();
    expect(estimateBreaktestCaseCount("/tmp/prompts.txt")).toBeNull();
    expect(estimateBreaktestCaseCount("/tmp/custom.txt")).toBeNull();
    expect(calculateBreaktestTimeoutMs({
      caseCount: null,
      timeout: 180,
    })).toBe(86_400_000);
    expect(calculateBreaktestTimeoutMs({
      caseCount: 24,
      mode: "default",
      repetitions: 1,
      concurrency: 1,
      timeout: 180,
      interval: 0,
    })).toBe(4_428_000);
    expect(calculateBreaktestTimeoutMs({
      caseCount: 24,
      mode: "ab",
      repetitions: 2,
      concurrency: 4,
      timeout: 30,
      interval: 10,
    })).toBe(972_000);
  });

  it("applies minimum and maximum bounds", () => {
    expect(calculateBreaktestTimeoutMs({ caseCount: 1, timeout: 0.1 })).toBe(120_000);
    expect(calculateBreaktestTimeoutMs({ caseCount: 10_000, timeout: 3_600 })).toBe(86_400_000);
  });
});

describe("prompt runner timeout", () => {
  it("leaves shutdown grace beyond the per-prompt timeout", () => {
    expect(calculateRunTimeoutMs(180)).toBe(210_000);
    expect(calculateRunTimeoutMs(86_400)).toBe(86_430_000);
    expect(calculateRunTimeoutMs(100_000)).toBe(86_430_000);
  });
});

describe("breaktest output directory reuse", () => {
  it("refreshes only a consumed directory for a new run", () => {
    expect(shouldCreateFreshBreaktestRunDir({
      outputDir: "/tmp/run-1",
      lastRunDir: "/tmp/run-1",
    })).toBe(true);
    expect(shouldCreateFreshBreaktestRunDir({
      outputDir: "/tmp/run-2",
      lastRunDir: "/tmp/run-1",
    })).toBe(false);
    expect(shouldCreateFreshBreaktestRunDir({
      outputDir: "/tmp/run-1",
      lastRunDir: "/tmp/run-1",
      extra: ["--resume"],
    })).toBe(false);
  });
});

describe("gatePreview", () => {
  it("rejects apply payloads and blockers", () => {
    expect(gatePreview(sample).ok).toBe(true);
    expect(gatePreview({ ...sample, apply: true, preview: false }).ok).toBe(false);
    expect(gatePreview({ ...sample, plan: { blockers: ["lock"] } }).ok).toBe(false);
  });
});

describe("preview binding", () => {
  it("is stable across object key order and detects changed fields", async () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
    const settings = { cliPath: "/cli", grokBin: "/grok", defaultGrokDir: "/tmp/fake.grok" };
    const expected = await createPreviewBinding({
      envelope: sample,
      intent: { source: "bundled" },
      settings,
    });
    const same = await createPreviewBinding({
      envelope: { ...sample, target: { grok_dir: "/tmp/fake.grok" } },
      intent: { source: "bundled" },
      settings,
    });
    const changed = await createPreviewBinding({
      envelope: { ...sample, plan: { blockers: [], prompt_sha256: "changed" } },
      intent: { source: "bundled" },
      settings,
    });

    expect(comparePreviewBindings(expected, same)).toEqual({ ok: true, changed: [] });
    expect(comparePreviewBindings(expected, changed)).toEqual({ ok: false, changed: ["plan"] });
  });
});

describe("breaktest events", () => {
  it("normalizes progress payloads and merges item updates", () => {
    const running = normalizeBreaktestEvent({
      runId: "run-1",
      total: 4,
      completed: 1,
      item: { num: "01", mode: "default", repetition: 1, title: "one" },
    });
    const completed = normalizeBreaktestEvent({
      run_id: "run-1",
      done: 2,
      record: { num: "01", mode: "default", repetition: 1, verdict: "comply" },
    });
    const items = mergeBreaktestItem(mergeBreaktestItem([], running.item), completed.item);

    expect(running).toMatchObject({ runId: "run-1", total: 4, completed: 1 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "01:default:1", status: "completed", verdict: "comply" });
    expect(summarizeBreaktest({ total: 4 }, items, { total: 4, completed: 2, failed: 0 })).toEqual({
      total: 4,
      completed: 2,
      failed: 0,
      verdicts: { comply: 1 },
    });
  });

  it("consumes the flattened CLI stream protocol", () => {
    expect(normalizeBreaktestEvent({
      schema: "grok-keysmith.stream.v1",
      type: "case-complete",
      runId: "run-2",
      num: "02",
      dim: "policy",
      title: "case two",
      mode: "override",
      repetition: 2,
      completed: 3,
      total: 5,
      verdict: "cancelled",
      cancelled: true,
    })).toMatchObject({
      runId: "run-2",
      total: 5,
      completed: 3,
      item: {
        id: "02:override:2",
        title: "case two",
        status: "cancelled",
        verdict: "cancelled",
      },
    });
  });
});
