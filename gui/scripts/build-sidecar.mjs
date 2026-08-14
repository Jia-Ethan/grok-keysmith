import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const guiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(guiDir, "..");
const sourcePath = join(repoDir, "grok-keysmith.py");
const expectedCliVersion = readFileSync(join(repoDir, "VERSION"), "utf8").trim();

const TARGETS = {
  "aarch64-apple-darwin": { platform: "darwin", arch: "arm64", extension: "" },
  "x86_64-pc-windows-msvc": { platform: "win32", arch: "x64", extension: ".exe" },
};

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function hostTarget() {
  if (process.platform === "darwin" && process.arch === "arm64") return "aarch64-apple-darwin";
  if (process.platform === "win32" && process.arch === "x64") return "x86_64-pc-windows-msvc";
  throw new Error(`Unsupported native build host: ${process.platform}/${process.arch}`);
}

const target = argument("--target") || process.env.TAURI_ENV_TARGET_TRIPLE || hostTarget();
const targetConfig = TARGETS[target];
if (!targetConfig) throw new Error(`Unsupported target: ${target}`);
if (process.platform !== targetConfig.platform || process.arch !== targetConfig.arch) {
  throw new Error(`PyInstaller sidecars must be built natively: ${target} requires ${targetConfig.platform}/${targetConfig.arch}`);
}
if (!existsSync(sourcePath)) throw new Error(`CLI source not found: ${sourcePath}`);

const buildRoot = join(guiDir, "src-tauri", "target", "sidecar-build", target);
const distDir = join(buildRoot, "dist");
const workDir = join(buildRoot, "work");
const specDir = join(buildRoot, "spec");
mkdirSync(buildRoot, { recursive: true });
rmSync(distDir, { recursive: true, force: true });
rmSync(workDir, { recursive: true, force: true });
rmSync(specDir, { recursive: true, force: true });

const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const dataSeparator = process.platform === "win32" ? ";" : ":";
const pythonEnv = { ...process.env, PYTHONNOUSERSITE: "1" };
delete pythonEnv.PYTHONHOME;
delete pythonEnv.PYTHONPATH;
delete pythonEnv.PYTHONUSERBASE;

const result = spawnSync(
  python,
  [
    "-m",
    "PyInstaller",
    "--clean",
    "--noconfirm",
    "--onefile",
    "--name",
    "grok-keysmith-cli",
    "--distpath",
    distDir,
    "--workpath",
    workDir,
    "--specpath",
    specDir,
    "--add-data",
    `${join(repoDir, "breaktest", "prompts.txt")}${dataSeparator}breaktest`,
    "--add-data",
    `${join(repoDir, "breaktest", "prompts-46.txt")}${dataSeparator}breaktest`,
    "--hidden-import",
    "grok_keysmith_runner",
    "--hidden-import",
    "grok_keysmith_breaktest",
    sourcePath,
  ],
  { cwd: guiDir, encoding: "utf8", stdio: "inherit", env: pythonEnv },
);
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`PyInstaller failed with exit code ${result.status}. Install gui/requirements-build.txt in the active Python environment.`);
}

const builtPath = join(distDir, `grok-keysmith-cli${targetConfig.extension}`);
if (!existsSync(builtPath)) throw new Error(`PyInstaller output missing: ${builtPath}`);

const binariesDir = join(guiDir, "src-tauri", "binaries");
const destination = join(binariesDir, `grok-keysmith-cli-${target}${targetConfig.extension}`);
const temporary = `${destination}.tmp-${process.pid}`;
mkdirSync(binariesDir, { recursive: true });
copyFileSync(builtPath, temporary);
if (process.platform !== "win32") chmodSync(temporary, 0o755);
renameSync(temporary, destination);

const smoke = spawnSync(destination, ["--version"], { encoding: "utf8" });
if (smoke.error) throw smoke.error;
if (smoke.status !== 0 || !String(smoke.stdout).includes(expectedCliVersion)) {
  throw new Error(`Frozen sidecar version smoke failed: ${smoke.stderr || smoke.stdout}`);
}

for (const bank of ["prompts.txt", "prompts-46.txt"]) {
  const bankSmoke = spawnSync(
    destination,
    ["--json", "--lang", "en", "breaktest", "--bank", bank, "--concurrency", "99"],
    { encoding: "utf8" },
  );
  if (bankSmoke.error) throw bankSmoke.error;
  let envelope;
  try {
    envelope = JSON.parse(String(bankSmoke.stdout));
  } catch {
    throw new Error(`Frozen sidecar ${bank} smoke returned invalid JSON: ${bankSmoke.stderr || bankSmoke.stdout}`);
  }
  const diagnostics = Array.isArray(envelope.diagnostics) ? envelope.diagnostics.join(" ") : "";
  if (bankSmoke.status !== 2 || envelope.ok !== false || !diagnostics.includes("concurrency")) {
    throw new Error(`Frozen sidecar ${bank} data smoke failed: ${bankSmoke.stderr || bankSmoke.stdout}`);
  }
}

console.log(`Built ${destination}`);
