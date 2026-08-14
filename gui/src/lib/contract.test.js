import { describe, expect, it } from "vitest";
import { ENVELOPE_SCHEMA, gatePreview, parseEnvelope } from "./contract.js";

const sample = {
  schema: ENVELOPE_SCHEMA,
  tool: "grok-keysmith",
  version: "0.4.0-dev",
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
});

describe("gatePreview", () => {
  it("rejects apply payloads and blockers", () => {
    expect(gatePreview(sample).ok).toBe(true);
    expect(gatePreview({ ...sample, apply: true, preview: false }).ok).toBe(false);
    expect(gatePreview({ ...sample, plan: { blockers: ["lock"] } }).ok).toBe(false);
  });
});
