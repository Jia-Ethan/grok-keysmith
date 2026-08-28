# Desktop v0.1.0-beta.4

Published on 2026-08-29 as the public GitHub pre-release [`desktop-v0.1.0-beta.4`](https://github.com/Jia-Ethan/grok-keysmith/releases/tag/desktop-v0.1.0-beta.4). The release is non-draft and intentionally remains marked as a pre-release because the Desktop version is `0.1.0-beta.4`; the stable CLI `v0.5.0` remains the repository's Latest release.

- Product: `grok-keysmith`
- Package: `grok-keysmith-gui`
- Identifier: `com.jia-ethan.grok-keysmith-gui`
- Sidecar: `grok-keysmith-cli`
- Desktop version: `0.1.0-beta.4`
- CLI version bundled: `0.5.0`
- macOS: Apple Silicon DMG with an ad-hoc app signature; no Apple Developer ID or notarization
- Windows: x64 current-user NSIS installer without Authenticode

## User-visible changes

- Reworked the interface around a calmer clay canvas, tech-blue actions, glass surfaces, and a responsive icon-first sidebar.
- Preserved the existing Status, Deploy, Manage, Settings, and opt-in Advanced tools workflows while improving navigation clarity across wide and narrow windows.
- Restored accessible default-button contrast in both themes.
- Extended reduced-motion handling to CSS transitions, hover treatments, sidebar springs, and the active-navigation indicator.

## Published assets

The public Release provides these installers from the immutable `desktop-v0.1.0-beta.4` tag:

| Host | Artifact |
| --- | --- |
| macOS Apple Silicon | [`grok-keysmith_0.1.0-beta.4_aarch64.dmg`](https://github.com/Jia-Ethan/grok-keysmith/releases/download/desktop-v0.1.0-beta.4/grok-keysmith_0.1.0-beta.4_aarch64.dmg) |
| Windows x64 | [`grok-keysmith_0.1.0-beta.4_x64-setup.exe`](https://github.com/Jia-Ethan/grok-keysmith/releases/download/desktop-v0.1.0-beta.4/grok-keysmith_0.1.0-beta.4_x64-setup.exe) |

The Release also publishes [`SHA256SUMS`](https://github.com/Jia-Ethan/grok-keysmith/releases/download/desktop-v0.1.0-beta.4/SHA256SUMS). Verify downloaded installers against that manifest before opening them. The packages were rebuilt from the exact immutable release tag and independently checked for the bundled CLI version, platform architecture, and installer behavior.

## Safety

All writes continue to go through the bundled CLI. Automated tests use isolated directories and a fake Grok executable; release builds do not call a real model or read the operator's `~/.grok`.
