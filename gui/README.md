# grok-keysmith desktop

Version `0.1.0-beta.1` is published as [`desktop-v0.1.0-beta.1`](https://github.com/Jia-Ethan/grok-keysmith/releases/tag/desktop-v0.1.0-beta.1). The Release provides an ad-hoc-signed macOS Apple Silicon DMG, an unsigned Windows x64 current-user NSIS installer, and `SHA256SUMS`.

The source on `main` is ahead of that published beta: top-level navigation is limited to Status, Deploy, Manage, and Settings; Run/Test are available through an opt-in Advanced tools view; user summaries replace raw technical data on primary surfaces. These post-beta.1 changes are not released until a new version and tag are built from the final version commit.

- macOS: `grok-keysmith_0.1.0-beta.1_aarch64.dmg`
- Windows: `grok-keysmith_0.1.0-beta.1_x64-setup.exe`

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
