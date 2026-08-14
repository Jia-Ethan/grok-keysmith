import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readConfig(name) {
  return JSON.parse(
    readFileSync(new URL(`../../src-tauri/${name}`, import.meta.url), "utf8"),
  );
}

describe("desktop bundle configuration", () => {
  it("builds a verifiable ad-hoc-signed Apple Silicon candidate", () => {
    const config = readConfig("tauri.macos.conf.json");
    expect(config.bundle.targets).toEqual(["app", "dmg"]);
    expect(config.bundle.externalBin).toEqual(["binaries/grok-keysmith-cli"]);
    expect(config.bundle.macOS.signingIdentity).toBe("-");
    expect(config.bundle.macOS.hardenedRuntime).toBe(false);
  });

  it("keeps the Windows candidate current-user and sidecar-backed", () => {
    const config = readConfig("tauri.windows.conf.json");
    expect(config.bundle.targets).toEqual(["nsis"]);
    expect(config.bundle.externalBin).toEqual(["binaries/grok-keysmith-cli"]);
    expect(config.bundle.windows.nsis.installMode).toBe("currentUser");
  });
});
