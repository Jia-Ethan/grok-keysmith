# Desktop v0.1.0-beta.1

Published on 2026-08-14 as the GitHub pre-release [`desktop-v0.1.0-beta.1`](https://github.com/Jia-Ethan/grok-keysmith/releases/tag/desktop-v0.1.0-beta.1), targeting merge commit `8b5f312b2a94a1cb62202145f687cf8a36a315e1`. macOS uses an ad-hoc signature with Hardened Runtime disabled for the frozen Python sidecar; there is no Apple Developer ID, notarization, or Authenticode.

The packages came from candidate run [`31811737321`](https://github.com/Jia-Ethan/grok-keysmith/actions/runs/31811737321) at pull-request merge ref `f77571c900dae95a0bf048911e60bdd084bbf693`. Its tree `bf4566e5c2934f6299df2bdbecebc48147c59465` exactly matches the Release tag target, but the build-info source commit displayed in the app is the pull-request merge ref rather than the tag commit.

- Product: `grok-keysmith`
- Package: `grok-keysmith-gui`
- Identifier: `com.jia-ethan.grok-keysmith-gui`
- Sidecar: `grok-keysmith-cli`
- CLI development version bundled: `0.4.0-dev`

## Published assets

| Host | Artifact | SHA-256 |
| --- | --- | --- |
| macOS Apple Silicon | [`grok-keysmith_0.1.0-beta.1_aarch64.dmg`](https://github.com/Jia-Ethan/grok-keysmith/releases/download/desktop-v0.1.0-beta.1/grok-keysmith_0.1.0-beta.1_aarch64.dmg) | `ce845d7f20c34e3806cf1a35d6d36115818d01c5ffc7c755c1e886a56a59d28f` |
| Windows x64 | [`grok-keysmith_0.1.0-beta.1_x64-setup.exe`](https://github.com/Jia-Ethan/grok-keysmith/releases/download/desktop-v0.1.0-beta.1/grok-keysmith_0.1.0-beta.1_x64-setup.exe) | `8abf505933ee2ad96b8c40c48ef432f6e1505273a4592d9022acd85d128386f0` |

The Release also publishes [`SHA256SUMS`](https://github.com/Jia-Ethan/grok-keysmith/releases/download/desktop-v0.1.0-beta.1/SHA256SUMS). The macOS candidate is an `.app` inside the DMG; the Windows package is a current-user NSIS installer with the WebView2 bootstrapper.

## Pages

Status, Deploy, Run, Test, Manage, Settings.

## Safety

All writes go through the CLI. Tests use isolated `HOME` and a fake Grok executable. The workflow does not call a real model or read the operator's `~/.grok`.
