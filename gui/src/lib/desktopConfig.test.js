import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const KEYSMITH_ICON_HASHES = {
  "source.png": "d7f5d09142b9bab6cd326fc18869e51d7adcba6d4f0929c703677186b7f3b347",
  "icon.png": "e906f51981ca48f71e4c8b3791fec4d96281c321592ee98f275e15d157fc2b6b",
  "icon.ico": "4a5e4661618c79802fc52dba4a55bf095ef0893a66538ba2c4bdad242d86be5d",
  "icon.icns": "66461832594db0b4d224d6186f8e72fe1ce0996c54bbec5ca372f5966d131658",
  "128x128@2x.png": "5828c9dfd0438351c4ceb924a8951e5999c2fdb82a353dfc3deb42c738afd789",
  "Square310x310Logo.png": "c98d2904fc199f160cce066b194fea8417d0fa054ad0e2436faa8bdb7cec9809",
  "ios/AppIcon-512@2x.png": "dc36f32af41e0e45c8087e365e5deba04cb4584d55b28c8d02c089d5814c7111",
  "android/mipmap-xxxhdpi/ic_launcher.png": "afb7d87f1c6de0f0140ef9bca3fae1bbaa6a325ec4b5e420d7050e59d8cc2d61",
  "android/mipmap-xxxhdpi/ic_launcher_foreground.png": "341e45e68359d4e3d4a71565f11186aa14d9ea5200cdf3b0b2cdfef732ea26db",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readConfig(name) {
  return JSON.parse(
    readFileSync(new URL(`../../src-tauri/${name}`, import.meta.url), "utf8"),
  );
}

describe("desktop bundle configuration", () => {
  it("uses the canonical Keysmith series icon on every platform", () => {
    for (const [name, expected] of Object.entries(KEYSMITH_ICON_HASHES)) {
      const icon = readFileSync(new URL(`../../src-tauri/icons/${name}`, import.meta.url));
      expect(sha256(icon), name).toBe(expected);
    }

    const favicon = readFileSync(new URL("../../public/favicon.ico", import.meta.url));
    const windowsIcon = readFileSync(
      new URL("../../src-tauri/icons/icon.ico", import.meta.url),
    );
    expect(favicon.equals(windowsIcon)).toBe(true);
  });

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
