# grok-keysmith desktop

Version `0.1.0-beta.1`. Ad-hoc-signed macOS `.app/.dmg` and unsigned Windows current-user NSIS candidates.

```bash
cd gui
npm ci
npm test
npm run build
```

Native bundle (Apple Silicon or Windows x64 host):

```bash
python3 -m pip install -r requirements-build.txt
npm run build:sidecar
npx tauri build
```

The sidecar is `grok-keysmith-cli`. Do not point the app at a live `~/.grok` during automated tests.
