# Desktop v0.1.0-beta.3

Published on 2026-08-18 as the GitHub pre-release [`desktop-v0.1.0-beta.3`](https://github.com/Jia-Ethan/grok-keysmith/releases/tag/desktop-v0.1.0-beta.3). Both packages are built from the exact release tag target and bundle CLI `0.4.1`.

- Product: `grok-keysmith`
- Package: `grok-keysmith-gui`
- Identifier: `com.jia-ethan.grok-keysmith-gui`
- Sidecar: `grok-keysmith-cli`
- CLI version bundled: `0.4.1`
- macOS: Apple Silicon DMG with an ad-hoc app signature; no Apple Developer ID or notarization
- Windows: x64 current-user NSIS installer without Authenticode

## Published assets

| Host | Artifact |
| --- | --- |
| macOS Apple Silicon | [`grok-keysmith_0.1.0-beta.3_aarch64.dmg`](https://github.com/Jia-Ethan/grok-keysmith/releases/download/desktop-v0.1.0-beta.3/grok-keysmith_0.1.0-beta.3_aarch64.dmg) |
| Windows x64 | [`grok-keysmith_0.1.0-beta.3_x64-setup.exe`](https://github.com/Jia-Ethan/grok-keysmith/releases/download/desktop-v0.1.0-beta.3/grok-keysmith_0.1.0-beta.3_x64-setup.exe) |

The Release also publishes [`SHA256SUMS`](https://github.com/Jia-Ethan/grok-keysmith/releases/download/desktop-v0.1.0-beta.3/SHA256SUMS). Verify downloaded assets against that file before opening them.

## Product boundary

Top-level navigation contains Status, Deploy, Manage, and Settings. Run and Test remain available through opt-in Advanced tools, and legacy deep links continue to resolve. Primary status, preview, error, and diagnostics surfaces use user-facing summaries with technical details on demand.

Write actions stay fail closed around managed ownership, hook ownership, drift or conflict, and interrupted transactions. Repairable marker or serialization drift exposes only the preview-confirm reconcile path. Preview binding, exclusive operation leases, post-write verification, and recursive local-path redaction remain part of the desktop boundary.

## Safety

All writes go through the bundled CLI. Automated tests use isolated directories and a fake Grok executable; candidate builds do not call a real model or read the operator's `~/.grok`.
