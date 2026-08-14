import { mkdirSync } from "node:fs";
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
];
const executablePath = chromeCandidates.find(Boolean);
if (!executablePath) {
  console.error("No Chrome/Chromium for screenshots");
  process.exit(2);
}

const preview = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], {
  cwd: guiDir,
  stdio: "inherit",
});

await new Promise((resolveWait) => setTimeout(resolveWait, 1500));

const browser = await puppeteer.launch({
  executablePath,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});

const views = ["dashboard", "deploy", "run", "test", "manage", "settings"];
const themes = ["light", "dark"];
const sizes = [
  { name: "default", width: 1200, height: 800 },
  { name: "min", width: 900, height: 600 },
];

try {
  for (const theme of themes) {
    for (const size of sizes) {
      for (const view of views) {
        const page = await browser.newPage();
        await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
        const url = `http://127.0.0.1:4173/?fixture=1&theme=${theme}&view=${view}`;
        await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
        await page.waitForSelector("h1", { timeout: 10000 });
        const dest = `${outDir}/${theme}-${size.name}-${view}.png`;
        await page.screenshot({ path: dest, fullPage: false });
        await page.close();
        console.log(dest);
      }
    }
  }
} finally {
  await browser.close();
  preview.kill("SIGTERM");
}
