import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const tauriConfig = JSON.parse(
  readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);

function htmlCsp() {
  const match = indexHtml.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/>/,
  );
  return match?.[1] ?? null;
}

describe("content security policy", () => {
  it("keeps the HTML and Tauri policies aligned", () => {
    expect(htmlCsp()).toBe(tauriConfig.app.security.csp);
  });

  it("allows bundled data URL fonts", () => {
    expect(htmlCsp()).toMatch(/(?:^|;)\s*font-src\s+'self'\s+data:\s*(?:;|$)/);
  });
});
