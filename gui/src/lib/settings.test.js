import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "grok-keysmith-gui:settings";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    value: (key) => values.get(key),
  };
}

beforeEach(() => {
  vi.resetModules();
});

describe("settings", () => {
  it("normalizes CLI path", async () => {
    const storage = createStorage({
      [KEY]: JSON.stringify({ cliPath: "  /tmp/grok-keysmith.py  " }),
    });
    vi.stubGlobal("localStorage", storage);
    const { getSettings } = await import("./settings.js");
    expect(getSettings().cliPath).toBe("/tmp/grok-keysmith.py");
  });

  it("defaults grok paths", async () => {
    const storage = createStorage({ [KEY]: "null" });
    vi.stubGlobal("localStorage", storage);
    const { getSettings } = await import("./settings.js");
    expect(getSettings()).toMatchObject({
      cliPath: "",
      grokBin: "",
      defaultGrokDir: "",
      lang: "zh-CN",
      theme: "system",
    });
  });
});
