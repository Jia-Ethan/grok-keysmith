# Desktop v0.1.0-beta.1

Local candidates only. macOS uses an ad-hoc signature with Hardened Runtime disabled for the frozen Python sidecar; there is no Apple Developer ID, notarization, Authenticode, or GitHub Release.

- Product: `grok-keysmith`
- Package: `grok-keysmith-gui`
- Identifier: `com.jia-ethan.grok-keysmith-gui`
- Sidecar: `grok-keysmith-cli`
- CLI development version bundled: `0.4.0-dev`

## Platforms

| Host | Artifact | Status |
| --- | --- | --- |
| macOS Apple Silicon | ad-hoc-signed `.app` / `.dmg` | built locally when the host is available |
| Windows x64 | current-user NSIS + WebView2 bootstrapper | native gate only on a Windows x64 host |

## Pages

Status, Deploy, Run, Test, Manage, Settings.

## Safety

All writes go through the CLI. Tests use isolated `HOME` and a fake Grok executable. The workflow does not call a real model or read the operator's `~/.grok`.
