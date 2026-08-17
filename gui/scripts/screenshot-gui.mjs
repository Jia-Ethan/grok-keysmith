import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const guiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(guiDir, "..");
const outDir = resolve(repoDir, "work", "gui-screenshots");
const generatedAt = new Date().toISOString();
const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoDir,
  encoding: "utf8",
}).trim();
const worktreeDirty = Boolean(execFileSync("git", ["status", "--porcelain"], {
  cwd: repoDir,
  encoding: "utf8",
}).trim());

// Screenshots are evidence for exactly this run. Never mix them with an older audit.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const chromeCandidates = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];
const executablePath = chromeCandidates.filter(Boolean).find(existsSync);
if (!executablePath) {
  console.error("No Chrome/Chromium for screenshots");
  process.exit(2);
}

const viteEntry = resolve(guiDir, "node_modules", "vite", "bin", "vite.js");
if (!existsSync(viteEntry)) {
  console.error("Vite is not installed; run npm ci first");
  process.exit(2);
}

const build = spawnSync(process.execPath, [viteEntry, "build"], {
  cwd: guiDir,
  env: { ...process.env, GROK_KEYSMITH_SOURCE_COMMIT: headSha },
  encoding: "utf8",
});
if (build.status !== 0) {
  process.stderr.write(build.stdout || "");
  process.stderr.write(build.stderr || "");
  throw new Error(`Vite build failed with code ${build.status}`);
}

const preview = spawn(
  process.execPath,
  [viteEntry, "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
  { cwd: guiDir, stdio: "inherit" },
);

const BASE_URL = "http://127.0.0.1:4173/";
const SHA = "d693411fd79f57c5e805e7bcbb27b42bacdd11e6a6af8858ab998017196dc898";
const LONG_CLI_VERSION = `grok-keysmith 0.4.0 bundled prompt SHA-256: ${SHA}`;
const LONG_GROK_DIR = "/tmp/fixture/users/someone-with-a-very-long-home-directory-name/Library/Application Support/Grok/.grok";
const failures = [];
const evidence = [];
let browser;

function statusEnvelope({
  state = "active-aligned",
  residue = [],
  drift = [],
  conflicts = [],
  backups = ["grok-backup-20260817-1200.tar.gz"],
  ownedDisabled = ["managed-hook"],
} = {}) {
  const installed = state !== "not-installed";
  return {
    schema: "grok-keysmith.envelope.v1",
    operation: "status",
    preview: false,
    apply: false,
    ok: true,
    exit_code: 0,
    diagnostics: [],
    target: { grok_dir: LONG_GROK_DIR },
    result: {
      state,
      nodes: {
        rule: installed
          ? { kind: "regular", fingerprint: { sha256: SHA, size: 8391 } }
          : { kind: "missing", fingerprint: null },
        config: { kind: installed ? "regular" : "missing" },
        manifest: { kind: installed ? "regular" : "missing" },
      },
      compat: { present: installed, matches_expected: installed },
      hooks: {
        active: [],
        disabled: ownedDisabled,
        owned_disabled: ownedDisabled,
        external_disabled: [],
      },
      manifest: installed
        ? { deployment_id: "fixture-deployment-0001", prompt_sha256: SHA }
        : null,
      backups,
      residue,
      drift,
      conflicts,
    },
  };
}

function mockConfig({
  status = statusEnvelope(),
  cli = "ready",
  cliVersion = LONG_CLI_VERSION,
} = {}) {
  return { status, cli, cliVersion };
}

async function installTauriMock(page, config) {
  await page.evaluateOnNewDocument((mock) => {
    const callbacks = new Map();
    let callbackId = 0;
    let eventId = 0;
    const calls = [];
    window.__fixtureCalls = calls;

    const response = (envelope) => ({
      stdout: JSON.stringify(envelope),
      stderr: "",
      exit_code: envelope.exit_code ?? 0,
      timed_out: false,
    });
    const preview = (kind) => ({
      schema: "grok-keysmith.envelope.v1",
      operation: kind,
      preview: true,
      apply: false,
      ok: true,
      exit_code: 0,
      diagnostics: [],
      target: { grok_dir: mock.status.target.grok_dir },
      plan: {
        blockers: [],
        confirmation_token: `${kind}-fixture-confirmation-token`,
        hooks_to_isolate: ["managed-hook"],
        journals: kind === "recover" ? ["fixture-journal"] : [],
        config: { stripped_external_compat: ["cursor"] },
      },
    });

    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback(callback) {
        const id = ++callbackId;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      async invoke(command, payload = {}) {
        calls.push({ command, payload });
        if (command === "plugin:event|listen") return ++eventId;
        if (command.startsWith("plugin:event|") || command.startsWith("plugin:window|")) return null;
        if (command === "detect_cli") {
          if (mock.cli === "failure") throw new Error("fixture CLI probe failed at /private/path/cli");
          if (mock.cli === "missing") return { path: null, runtime: "" };
          return { path: "/tmp/fixture/grok-keysmith-cli", runtime: "bundled" };
        }
        if (command === "cli_version") return mock.cliVersion;
        if (command === "cli_runtime") return "bundled";
        if (command === "detect_grok") return { path: "/tmp/fixture/grok", version: "1.0.4" };
        if (command === "grok_inspect") {
          return {
            stdout: JSON.stringify({ grokVersion: "1.0.4", projectInstructions: [], externalCompat: { cells: [] }, hooks: [] }),
            stderr: "",
            exit_code: 0,
            timed_out: false,
          };
        }
        if (command === "read_manifest") {
          return { deployment_id: "fixture-deployment-0001", prompt_sha256: mock.status.result.manifest?.prompt_sha256 || "" };
        }
        if (command === "cli_run") {
          const args = payload.args || [];
          if (args.includes("--status")) return response(mock.status);
          const kind = args.includes("--uninstall")
            ? "uninstall"
            : args.includes("--restore-hooks")
              ? "restore"
              : args.includes("--recover")
                ? "recover"
                : "deploy";
          const isApply = args.includes("--yes") || args.includes("--expected-preview-token");
          if (!isApply) return response(preview(kind));
          return response({
            ...preview(kind),
            preview: false,
            apply: true,
            result: { deployment_id: "fixture-deployment-0002" },
          });
        }
        if (command === "default_breaktest_run_dir") return "fixture-breaktest-run";
        if (command === "open_path" || command === "write_text_file" || command === "cli_cancel") return null;
        throw new Error(`Unhandled fixture invoke: ${command}`);
      },
    };
  }, config);
}

async function setInitialSettings(page, patch = {}) {
  await page.evaluateOnNewDocument((settingsPatch) => {
    localStorage.setItem("grok-keysmith-gui:settings", JSON.stringify({
      lang: "zh-CN",
      theme: "system",
      cliPath: "",
      grokBin: "",
      defaultGrokDir: "",
      showAdvancedTools: false,
      ...settingsPatch,
    }));
  }, patch);
}

async function waitForPreview() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) throw new Error(`Vite preview exited with code ${preview.exitCode}`);
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error("Timed out waiting for Vite preview");
}

function recordPageErrors(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`${label}: console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`${label}: pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    failures.push(`${label}: request failed: ${request.url()} (${request.failure()?.errorText || "unknown"})`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${label}: HTTP ${response.status()}: ${response.url()}`);
  });
}

async function openPage({
  id,
  query = "",
  width = 1200,
  height = 800,
  settings = {},
  tauri = null,
}) {
  const context = await browser.createBrowserContext();
  const pages = await context.pages();
  const page = pages[0] || await context.newPage();
  recordPageErrors(page, id);
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await setInitialSettings(page, settings);
  if (tauri) await installTauriMock(page, tauri);
  const url = `${BASE_URL}?${query}`;
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
  await page.waitForSelector("h1", { timeout: 10_000 });
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
  return { context, page, url };
}

async function screenshot(page, { id, url, assertions = [] }) {
  await page.evaluate(() => document.fonts.ready);
  const file = `${id}.png`;
  await page.screenshot({ path: resolve(outDir, file), fullPage: false });
  evidence.push({ id, file, url, assertions });
  console.log(resolve(outDir, file));
}

function failUnless(condition, message) {
  if (!condition) failures.push(message);
}

async function auditCommonLayout(page, id) {
  const layout = await page.evaluate(() => ({
    overflow: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0) - window.innerWidth,
    title: document.querySelector("h1")?.textContent?.trim() || "",
  }));
  failUnless(layout.overflow <= 1, `${id}: horizontal overflow ${layout.overflow}px`);
  failUnless(Boolean(layout.title), `${id}: missing page heading`);
}

async function auditDashboard(page, id, expectedState) {
  await page.waitForFunction(
    (state) => document.body.innerText.includes(state),
    { timeout: 10_000 },
    expectedState,
  );
  const surface = await page.evaluate(() => {
    const visibleText = document.querySelector("main")?.innerText || "";
    return {
      hasSha: /[0-9a-f]{64}/.test(visibleText),
      hasBackupFile: /grok-backup-202608\d{2}/.test(visibleText),
      hasDeploymentId: visibleText.includes("fixture-deployment"),
      lineCount: visibleText.split("\n").filter(Boolean).length,
    };
  });
  failUnless(!surface.hasSha, `${id}: dashboard shows a raw SHA`);
  failUnless(!surface.hasBackupFile, `${id}: dashboard shows backup file names`);
  failUnless(!surface.hasDeploymentId, `${id}: dashboard shows deployment ID`);
  failUnless(surface.lineCount <= 40, `${id}: dashboard renders ${surface.lineCount} lines`);
}

async function runBaseMatrix() {
  const views = ["dashboard", "deploy", "manage", "settings", "advanced"];
  const themes = ["light", "dark"];
  const sizes = [
    { name: "default", width: 1200, height: 800 },
    { name: "min", width: 900, height: 600 },
    { name: "narrow", width: 640, height: 800 },
  ];
  for (const theme of themes) {
    for (const size of sizes) {
      for (const view of views) {
        const advanced = view === "advanced";
        const id = `base-${theme}-${size.name}-${view}${advanced ? "-advanced-on" : ""}`;
        const { context, page, url } = await openPage({
          id,
          query: `fixture=1&theme=${theme}&view=${view}`,
          width: size.width,
          height: size.height,
          settings: { showAdvancedTools: advanced },
        });
        await auditCommonLayout(page, id);
        const nav = await page.evaluate(() => [...document.querySelectorAll("nav button[data-view]")].map((button) => button.dataset.view));
        const expectedNav = advanced
          ? ["dashboard", "deploy", "manage", "advanced", "settings"]
          : ["dashboard", "deploy", "manage", "settings"];
        failUnless(JSON.stringify(nav) === JSON.stringify(expectedNav), `${id}: unexpected nav ${nav.join(",")}`);
        await screenshot(page, { id, url, assertions: ["no horizontal overflow", "navigation gate"] });
        await context.close();
      }
    }
  }
}

async function runDashboardStates() {
  const states = [
    { key: "active-aligned", label: "已对齐" },
    { key: "drift", label: "漂移", drift: ["config content does not match managed after-state"] },
    { key: "conflict", label: "冲突", conflicts: ["managed rule node is directory"] },
    { key: "recovery-required", label: "需恢复", residue: [".grok-keysmith-transaction-fixture"] },
    { key: "not-installed", label: "未安装", ownedDisabled: [], backups: [] },
  ];
  for (const state of states) {
    const id = `dashboard-state-${state.key}`;
    const { context, page, url } = await openPage({
      id,
      query: "theme=light&view=dashboard",
      tauri: mockConfig({ status: statusEnvelope({ state: state.key, ...state }) }),
    });
    await auditCommonLayout(page, id);
    await auditDashboard(page, id, state.label);
    await screenshot(page, {
      id,
      url,
      assertions: [`state=${state.key}`, "technical identifiers hidden by default"],
    });
    await context.close();
  }
}

async function runCliFailures() {
  for (const scenario of [
    { key: "missing", label: "未找到 Keysmith CLI", cli: "missing" },
    { key: "failure", label: "CLI 校验失败", cli: "failure" },
  ]) {
    const id = `dashboard-cli-${scenario.key}`;
    const { context, page, url } = await openPage({
      id,
      query: "theme=light&view=dashboard",
      tauri: mockConfig({ cli: scenario.cli }),
    });
    await page.waitForFunction((label) => document.body.innerText.includes(label), {}, scenario.label);
    if (scenario.key === "failure") {
      const rawVisible = await page.evaluate(() => document.querySelector("main")?.innerText.includes("fixture CLI probe failed"));
      failUnless(!rawVisible, `${id}: raw CLI error is visible before technical details expand`);
    }
    await screenshot(page, { id, url, assertions: [scenario.label, "raw CLI detail collapsed"] });
    await context.close();
  }
}

async function runLongCliScenario() {
  const id = "settings-long-cli-sha";
  const { context, page, url } = await openPage({
    id,
    query: "theme=light&view=settings",
    tauri: mockConfig({ cliVersion: LONG_CLI_VERSION }),
  });
  await page.waitForFunction((sha) => document.body.innerText.includes(sha), {}, SHA);
  await auditCommonLayout(page, id);
  await screenshot(page, { id, url, assertions: ["long CLI version and SHA render without overflow"] });
  await context.close();
}

async function runDeployConfirmation() {
  const id = "deploy-confirmation-dialog";
  const { context, page, url } = await openPage({
    id,
    query: "theme=light&view=deploy",
    tauri: mockConfig(),
  });
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "生成预览")?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes("来源：内置 Markdown"));
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "确认部署")?.click();
  });
  await page.waitForSelector('[role="alertdialog"]');
  const dialog = await page.$eval('[role="alertdialog"]', (node) => ({
    text: node.innerText,
    hasToken: node.innerText.includes("fixture-confirmation-token"),
    hasSha: /[0-9a-f]{64}/.test(node.innerText),
  }));
  failUnless(dialog.text.includes("目标目录"), `${id}: confirmation has no target summary`);
  failUnless(!dialog.hasToken && !dialog.hasSha, `${id}: confirmation leaks technical token or SHA`);
  await screenshot(page, { id, url, assertions: ["preview -> confirmation interaction", "token and SHA hidden"] });
  await context.close();
}

async function runManageScenarios() {
  {
    const id = "manage-operation-gates-not-installed";
    const status = statusEnvelope({ state: "not-installed", residue: [], ownedDisabled: [], backups: [] });
    const { context, page, url } = await openPage({
      id,
      query: "theme=light&view=manage",
      tauri: mockConfig({ status }),
    });
    await page.waitForFunction(() => window.__fixtureCalls.some((call) => call.command === "cli_run"));
    const gates = await page.evaluate(() => Object.fromEntries(
      [...document.querySelectorAll("[data-operation]")].map((card) => [
        card.dataset.operation,
        card.querySelector("button")?.disabled,
      ]),
    ));
    failUnless(gates.uninstall === true, `${id}: uninstall should be disabled while not installed`);
    failUnless(gates.restore === true, `${id}: restore should be disabled without owned disabled hooks`);
    failUnless(gates.recover === true, `${id}: recover should be disabled without residue`);
    await screenshot(page, { id, url, assertions: ["uninstall, restore, and recover gates disabled"] });
    await context.close();
  }
  {
    const id = "manage-uninstall-confirmation-dialog";
    const { context, page, url } = await openPage({
      id,
      query: "theme=light&view=manage",
      tauri: mockConfig(),
    });
    await page.waitForFunction(() => !document.querySelector('[data-operation="uninstall"] button')?.disabled);
    const clickState = await page.evaluate(() => {
      const button = document.querySelector('[data-operation="uninstall"] button');
      button?.click();
      return { found: Boolean(button), disabled: button?.disabled ?? null };
    });
    failUnless(clickState.found && clickState.disabled === false, `${id}: uninstall preview button was not actionable`);
    await page.waitForFunction(() => window.__fixtureCalls.some((call) => (
      call.command === "cli_run" && call.payload?.args?.includes("--uninstall")
    )));
    try {
      await page.waitForSelector('[role="alertdialog"]', { timeout: 5_000 });
    } catch (error) {
      const debug = await page.evaluate(() => ({
        text: document.querySelector("main")?.innerText || "",
        calls: window.__fixtureCalls,
      }));
      throw new Error(`${id}: confirmation did not open: ${JSON.stringify(debug)}`, { cause: error });
    }
    const dialogText = await page.$eval('[role="alertdialog"]', (node) => node.innerText);
    failUnless(dialogText.includes("分层卸载"), `${id}: wrong confirmation title`);
    failUnless(!dialogText.includes("fixture-confirmation-token"), `${id}: confirmation leaks token`);
    await screenshot(page, { id, url, assertions: ["manage preview -> confirmation interaction", "token hidden"] });
    await context.close();
  }
}

async function runDiagnosticsOnDemand() {
  const id = "settings-diagnostics-on-demand";
  const { context, page, url } = await openPage({
    id,
    query: "theme=light&view=settings",
    tauri: mockConfig(),
  });
  const before = await page.evaluate(() => window.__fixtureCalls.map((call) => call.command));
  for (const command of ["cli_run", "grok_inspect", "read_manifest", "detect_grok"]) {
    failUnless(!before.includes(command), `${id}: ${command} ran before the user requested diagnostics`);
  }
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "加载诊断数据")?.click();
  });
  await page.waitForFunction(() => {
    const calls = window.__fixtureCalls.map((call) => call.command);
    return calls.includes("cli_run") && calls.includes("grok_inspect") && calls.includes("read_manifest") && calls.includes("detect_grok");
  });
  const expanded = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "技术详情");
    button?.click();
    return Boolean(button);
  });
  failUnless(expanded, `${id}: diagnostic technical details were not rendered`);
  await screenshot(page, { id, url, assertions: ["diagnostics absent before click", "status, inspect, manifest loaded after click"] });
  await context.close();
}

async function runLegacyTestDeepLink() {
  const id = "advanced-legacy-test-deep-link";
  const { context, page, url } = await openPage({
    id,
    query: "fixture=1&theme=light&view=test",
    settings: { showAdvancedTools: true },
  });
  await page.waitForSelector("#test-output-dir");
  const state = await page.evaluate(() => ({
    selected: document.querySelector('button[data-tab="test"]')?.getAttribute("aria-selected"),
    outputDir: document.querySelector("#test-output-dir")?.value,
    runPromptVisible: Boolean(document.querySelector("#run-prompt")),
  }));
  failUnless(state.selected === "true", `${id}: test tab is not selected`);
  failUnless(state.outputDir === "fixture-breaktest-run", `${id}: test page did not mount`);
  failUnless(!state.runPromptVisible, `${id}: run page mounted instead of test page`);
  await screenshot(page, { id, url, assertions: ["view=test selects Advanced/Test", "TestView mounted"] });
  await context.close();
}

try {
  await waitForPreview();
  browser = await puppeteer.launch({
    executablePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });
  await runBaseMatrix();
  await runDashboardStates();
  await runCliFailures();
  await runLongCliScenario();
  await runDeployConfirmation();
  await runManageScenarios();
  await runDiagnosticsOnDemand();
  await runLegacyTestDeepLink();

  const manifest = {
    schema: "grok-keysmith.gui-audit.v1",
    generatedAt,
    headSha,
    worktreeDirty,
    executablePath,
    scenarios: evidence,
    failures,
  };
  writeFileSync(resolve(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (failures.length) {
    throw new Error(`GUI audit failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
  console.log(`GUI audit passed: ${evidence.length} screenshots; manifest ${resolve(outDir, "manifest.json")}`);
} finally {
  if (browser) await browser.close();
  if (preview.exitCode === null) preview.kill("SIGTERM");
}
