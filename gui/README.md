# grok-keysmith desktop

Version `0.1.0-beta.4` is published as the public GitHub pre-release [`desktop-v0.1.0-beta.4`](https://github.com/Jia-Ethan/grok-keysmith/releases/tag/desktop-v0.1.0-beta.4) with the stable CLI `0.5.0` sidecar. The beta remains marked as a pre-release rather than the stable Latest release.

- Published macOS asset: [`grok-keysmith_0.1.0-beta.4_aarch64.dmg`](https://github.com/Jia-Ethan/grok-keysmith/releases/download/desktop-v0.1.0-beta.4/grok-keysmith_0.1.0-beta.4_aarch64.dmg)
- Published Windows asset: [`grok-keysmith_0.1.0-beta.4_x64-setup.exe`](https://github.com/Jia-Ethan/grok-keysmith/releases/download/desktop-v0.1.0-beta.4/grok-keysmith_0.1.0-beta.4_x64-setup.exe)

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

The sidecar is `grok-keysmith-cli`. Do not point the app at a live `~/.grok` during automated tests.
