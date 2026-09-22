# Desktop v0.1.0-beta.5

Unsigned desktop candidate wrapping CLI `0.6.1`. Tag `desktop-v0.1.0-beta.5` is created only when the Desktop Candidate workflow is dispatched from `main` with `publish_desktop_prerelease=true`. The beta remains a pre-release; the repository Latest release stays the stable CLI `v0.6.1`.

- Product: `grok-keysmith`
- Package: `grok-keysmith-gui`
- Identifier: `com.jia-ethan.grok-keysmith-gui`
- Sidecar: `grok-keysmith-cli`
- Desktop version: `0.1.0-beta.5`
- CLI version bundled: `0.6.1`
- macOS: Apple Silicon DMG with an ad-hoc app signature; no Apple Developer ID or notarization
- Windows: x64 current-user NSIS installer without Authenticode

## User-visible changes

- Sidecar follows CLI `0.6.1` (routing-aware contract, receipt-v2, JSON envelope `grok-keysmith.envelope.v1`).
- Desktop Candidate CI now builds a real PyInstaller sidecar, pins Rust `1.88.0`, stages `SHA256SUMS`, and smokes Windows close-while-sidecar plus single-instance.
- Status, Deploy, Manage, Settings, and opt-in Advanced tools (Run/Test) are unchanged. Reconcile still binds `--expected-preview-token`. Live stream, cancel, and 16 MiB stdout stay on the Grok runner.

## Published assets

When the tag is published, the Release provides these installers:

| Host | Artifact |
| --- | --- |
| macOS Apple Silicon | `grok-keysmith_0.1.0-beta.5_aarch64.dmg` |
| Windows x64 | `grok-keysmith_0.1.0-beta.5_x64-setup.exe` |

The Release also publishes `SHA256SUMS`. Verify downloaded installers against that manifest before opening them.

## Safety

All writes continue to go through the bundled CLI. Automated tests use isolated directories and a fake Grok executable; release builds do not call a real model or read the operator's `~/.grok`.
