# grok-keysmith desktop

## 桌面停更

這個獨立桌面不再發新的安裝包。已發出的版本保持原樣，不撤回，也不改成 Latest。之後的桌面只維護 [Keysmith Switch](https://github.com/Jia-Ethan/keysmith-switch)。範圍與進度見 [keysmith-switch#6](https://github.com/Jia-Ethan/keysmith-switch/issues/6)。

Version `0.1.0-beta.5` wraps CLI `0.6.1`. The public GitHub pre-release remains [`desktop-v0.1.0-beta.4`](https://github.com/Jia-Ethan/grok-keysmith/releases/tag/desktop-v0.1.0-beta.4) until this line is tagged; the beta stays marked as a pre-release rather than the stable Latest release.

- Prepared macOS asset name: `grok-keysmith_0.1.0-beta.5_aarch64.dmg`
- Prepared Windows asset name: `grok-keysmith_0.1.0-beta.5_x64-setup.exe`

Top-level navigation focuses on Status, Deploy, Manage, and Settings. Run and Test live under opt-in Advanced tools; primary surfaces show user summaries with technical details on demand. Write actions remain gated by managed ownership, drift/conflict, interrupted-transaction state, fresh preview binding, and post-write verification. Repairable marker/serialization drift exposes only the dedicated Manage action (`--reconcile`), not uninstall, hook restore, or interrupted-operation recovery. Reconcile always runs a fresh preview before applying with `--expected-preview-token`; it is separate from `--recover` and never consumes transaction residue.

On Windows, select the native `grok.exe` for Prompt Runner and Breaktest override modes; `.cmd` / `.bat` shims cannot carry the full contract.

```bash
cd gui
npm ci
npm test
npm run build
```

Native bundle on macOS Apple Silicon:

```bash
python3 -m pip install -r requirements-build.txt
npm run build:sidecar
npx tauri build
```

Native bundle on Windows x64 PowerShell:

```powershell
python -m pip install -r requirements-build.txt
$env:PYTHON = (Get-Command python).Source
npm run build:sidecar
npx tauri build
```

The sidecar is `grok-keysmith-cli`. Do not point the app at a live `~/.grok` during automated tests. Desktop Candidate CI pins Rust `1.88.0`, builds a real PyInstaller sidecar before Tauri, stages `SHA256SUMS`, and on Windows smokes close-while-sidecar plus single-instance. Publish remains a manual `workflow_dispatch` switch defaulted off.
