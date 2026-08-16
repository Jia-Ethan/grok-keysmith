import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const guiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(guiDir, "..", "work", "gui-screenshots");
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

const preview = spawn(process.execPath, [viteEntry, "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], {
  cwd: guiDir,
  stdio: "inherit",
});

const views = ["dashboard", "deploy", "manage", "settings", "advanced"];
const themes = ["light", "dark"];
const sizes = [
  { name: "default", width: 1200, height: 800 },
  { name: "min", width: 900, height: 600 },
  { name: "narrow", width: 640, height: 800 },
];
const failures = [];
let browser;

async function waitForPreview() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) {
      throw new Error(`Vite preview exited with code ${preview.exitCode}`);
    }
    try {
      const response = await fetch("http://127.0.0.1:4173/");
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
    if (response.status() >= 400) {
      failures.push(`${label}: HTTP ${response.status()}: ${response.url()}`);
    }
  });
}

async function auditLayout(page, { view, size, showAdvanced }) {
  const layout = await page.evaluate(async ({ currentView, currentSize, advancedOn }) => {
    await document.fonts.ready;
    const main = document.querySelector("main");
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    );
    const result = {
      documentOverflow: documentWidth - window.innerWidth,
      mainBottomGap: null,
      testControls: null,
      navKeys: [...document.querySelectorAll("nav button[data-view]")].map((b) => b.dataset.view),
      dashboardSurface: null,
    };

    if (currentSize === "min" && currentView === "advanced" && main) {
      main.scrollTop = main.scrollHeight;
      await new Promise((resolveWait) => requestAnimationFrame(() => resolveWait()));
      result.mainBottomGap = main.scrollHeight - main.clientHeight - main.scrollTop;
      main.scrollTop = 0;
      await new Promise((resolveWait) => requestAnimationFrame(() => resolveWait()));
    }

    if (currentView === "advanced") {
      // 高级工具默认进入运行标签，切到测试标签验证控件。
      const testTab = document.querySelector('button[data-tab="test"]');
      if (testTab) {
        testTab.click();
        // 等待测试标签内容真正挂载
        await new Promise((resolveWait) => {
          const started = Date.now();
          const poll = () => {
            if (document.querySelector("#test-output-dir") || Date.now() - started > 3000) {
              resolveWait();
            } else {
              setTimeout(poll, 50);
            }
          };
          poll();
        });
      }
      const buttonState = (label) => {
        const button = [...document.querySelectorAll("button")]
          .find((candidate) => candidate.textContent.trim() === label);
        return button ? button.disabled : null;
      };
      result.testControls = {
        outputDir: document.querySelector("#test-output-dir")?.value || "",
        startDisabled: buttonState("开始"),
        cancelDisabled: buttonState("取消"),
        retryDisabled: buttonState("重试失败"),
        resumeDisabled: buttonState("恢复"),
        reportDisabled: buttonState("打开报告"),
      };
    }

    if (currentView === "dashboard") {
      // 首页首层只渲染状态/健康项/路径；SHA、备份文件名等不得出现在
      // 默认折叠区域之外。collapsible 未展开时内容不挂载（radix 默认行为），
      // 因此可见文本不应包含这些诊断值。
      const visibleText = main?.innerText || "";
      result.dashboardSurface = {
        hasSha: /[0-9a-f]{64}/.test(visibleText),
        hasBackupFile: /grok-backup-202608\d{2}/.test(visibleText),
        hasDeploymentId: visibleText.includes("fixture-deployment"),
        lineCount: visibleText.split("\n").filter(Boolean).length,
      };
    }

    if (!advancedOn && result.navKeys.some((key) => ["advanced", "run", "test"].includes(key))) {
      result.navViolation = result.navKeys;
    }
    return result;
  }, { currentView: view, currentSize: size.name, advancedOn: showAdvanced });

  if (layout.documentOverflow > 1) {
    failures.push(`${size.name}/${view}: horizontal overflow ${layout.documentOverflow}px`);
  }
  if (layout.mainBottomGap !== null && layout.mainBottomGap > 1) {
    failures.push(`${size.name}/${view}: main content cannot scroll to bottom (${layout.mainBottomGap}px)`);
  }
  if (layout.navViolation) {
    failures.push(`${size.name}/${view}: advanced nav visible while disabled: ${layout.navViolation.join(",")}`);
  }
  if (layout.dashboardSurface) {
    const surface = layout.dashboardSurface;
    if (surface.hasSha) failures.push(`${size.name}/${view}: dashboard shows a raw SHA`);
    if (surface.hasBackupFile) failures.push(`${size.name}/${view}: dashboard shows backup file names`);
    if (surface.hasDeploymentId) failures.push(`${size.name}/${view}: dashboard shows deployment ID`);
    if (size.name !== "narrow" && surface.lineCount > 40) {
      failures.push(`${size.name}/${view}: dashboard renders ${surface.lineCount} lines, expected a short overview`);
    }
  }
  if (layout.testControls) {
    const expected = {
      outputDir: "fixture-breaktest-run",
      startDisabled: false,
      cancelDisabled: true,
      retryDisabled: true,
      resumeDisabled: true,
      reportDisabled: true,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (layout.testControls[key] !== value) {
        failures.push(`${size.name}/${view}: ${key}=${JSON.stringify(layout.testControls[key])}, expected ${JSON.stringify(value)}`);
      }
    }
  }
}

try {
  await waitForPreview();
  browser = await puppeteer.launch({
    executablePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });
  for (const theme of themes) {
    for (const size of sizes) {
      for (const view of views) {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        const label = `${theme}/${size.name}/${view}`;
        recordPageErrors(page, label);
        await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
        // 高级工具页需要先在设置中开启开关，默认隐藏的导航门禁本身
        // 由 dashboard/deploy/manage/settings 场景的 navViolation 断言覆盖。
        const needsAdvanced = view === "advanced";
        if (needsAdvanced) {
          await page.goto(`http://127.0.0.1:4173/?fixture=1&theme=${theme}`, { waitUntil: "networkidle0", timeout: 30000 });
          await page.evaluate(() => {
            localStorage.setItem(
              "grok-keysmith-gui:settings",
              JSON.stringify({ ...JSON.parse(localStorage.getItem("grok-keysmith-gui:settings") || "{}"), showAdvancedTools: true }),
            );
          });
        }
        const url = `http://127.0.0.1:4173/?fixture=1&theme=${theme}&view=${view}`;
        await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
        await page.waitForSelector("h1", { timeout: 10000 });
        await auditLayout(page, { view, size, showAdvanced: needsAdvanced });
        const dest = `${outDir}/${theme}-${size.name}-${view}${needsAdvanced ? "-advanced-on" : ""}.png`;
        await page.screenshot({ path: dest, fullPage: false });
        await context.close();
        console.log(dest);
      }
      // 开启高级工具后的导航截图（默认窗口）
      if (size.name === "default") {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        const label = `${theme}/${size.name}/dashboard/advanced-on`;
        recordPageErrors(page, label);
        await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
        await page.goto(`http://127.0.0.1:4173/?fixture=1&theme=${theme}`, { waitUntil: "networkidle0", timeout: 30000 });
        await page.evaluate(() => {
          localStorage.setItem(
            "grok-keysmith-gui:settings",
            JSON.stringify({ ...JSON.parse(localStorage.getItem("grok-keysmith-gui:settings") || "{}"), showAdvancedTools: true }),
          );
        });
        await page.goto(`http://127.0.0.1:4173/?fixture=1&theme=${theme}&view=dashboard`, { waitUntil: "networkidle0", timeout: 30000 });
        await page.waitForSelector("h1", { timeout: 10000 });
        const nav = await page.evaluate(
          () => [...document.querySelectorAll("nav button[data-view]")].map((b) => b.dataset.view),
        );
        const expectedNav = ["dashboard", "deploy", "manage", "advanced", "settings"];
        if (JSON.stringify(nav) !== JSON.stringify(expectedNav)) {
          failures.push(`${label}: nav=${nav.join(",")}, expected ${expectedNav.join(",")}`);
        }
        const dest = `${outDir}/${theme}-${size.name}-dashboard-advanced-on.png`;
        await page.screenshot({ path: dest, fullPage: false });
        await context.close();
        console.log(dest);
      }
    }
  }
  if (failures.length) {
    throw new Error(`GUI audit failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
} finally {
  if (browser) await browser.close();
  if (preview.exitCode === null) preview.kill("SIGTERM");
}
