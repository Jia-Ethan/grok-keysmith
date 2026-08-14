# grok-keysmith desktop

Version `0.1.0-beta.1`. Candidate targets are an ad-hoc-signed macOS `.app/.dmg` and an unsigned Windows current-user NSIS installer.

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
