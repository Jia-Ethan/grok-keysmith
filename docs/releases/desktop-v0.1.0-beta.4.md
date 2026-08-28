# Desktop v0.1.0-beta.4

Release candidate for the planned GitHub pre-release `desktop-v0.1.0-beta.4`. The current public Desktop remains [`desktop-v0.1.0-beta.3`](https://github.com/Jia-Ethan/grok-keysmith/releases/tag/desktop-v0.1.0-beta.3); no beta.4 tag, Release, or public assets exist until the final release workflow is explicitly authorized and completed.

- Product: `grok-keysmith`
- Package: `grok-keysmith-gui`
- Identifier: `com.jia-ethan.grok-keysmith-gui`
- Sidecar: `grok-keysmith-cli`
- Desktop version: `0.1.0-beta.4`
- CLI version bundled: `0.5.0`
- macOS: planned Apple Silicon DMG with an ad-hoc app signature; no Apple Developer ID or notarization
- Windows: planned x64 current-user NSIS installer without Authenticode

## User-visible changes

- Reworked the interface around a calmer clay canvas, tech-blue actions, glass surfaces, and a responsive icon-first sidebar.
- Preserved the existing Status, Deploy, Manage, Settings, and opt-in Advanced tools workflows while improving navigation clarity across wide and narrow windows.
- Restored accessible default-button contrast in both themes.
- Extended reduced-motion handling to CSS transitions, hover treatments, sidebar springs, and the active-navigation indicator.

## Candidate assets

The final tag build is expected to produce:

| Host | Artifact |
| --- | --- |
| macOS Apple Silicon | `grok-keysmith_0.1.0-beta.4_aarch64.dmg` |
| Windows x64 | `grok-keysmith_0.1.0-beta.4_x64-setup.exe` |

Candidate workflow artifacts are temporary validation inputs, not published release assets. Before publication, rebuild from the exact final tag target, verify the sidecar reports CLI `0.5.0`, validate platform architecture and installer behavior, and generate `SHA256SUMS` from the final files.

## Safety

All writes continue to go through the bundled CLI. Automated tests use isolated directories and a fake Grok executable; candidate builds do not call a real model or read the operator's `~/.grok`.
