# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and release versions
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

No unreleased user-visible changes are recorded yet.

## [0.1.1] - 2026-07-25

`v0.1.1` is the first public release. The public Git history starts at this
version and does not include the earlier private-only predecessor.

### Added

- Versioned CLI identity through `VERSION`, `grok-keysmith.py --version`, and
  the bundled prompt SHA-256 `cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b`.
- Deploys bundled or custom Markdown instructions to global
  `~/.grok/AGENTS.md` project rules discovered by Grok Build.
- Marked `[compat.claude]`, `[compat.cursor]`, and `[compat.codex]` isolation in
  `~/.grok/config.toml`.
- Hook isolation through `.json.disabled` renames with timestamped conflict
  archiving.
- Manifest-owned layered uninstall, hooks-only restore, preview-first writes,
  read-only status, durable interruption journals, and explicit recovery.
- Python 3.8+ standard-library-only runtime with no third-party dependencies.

### Fixed

- Strip every pre-existing managed `[compat.*]` section before injecting the
  marked isolation block. TOML duplicate table headers are parse errors, not
  last-wins overrides; the original configuration remains in its timestamped
  backup.
- Use the canonical MIT grant text. An earlier private-only snapshot contained
  a transcription error and is not part of this public repository history.

### Changed

- Publish through an annotated `v0.1.1` tag and matching GitHub Release.
- Use GitHub Private Vulnerability Reporting for coordinated disclosures.
- Document the measured grok-4.5 behavior boundary from the 24-question A/B
  run and keep the bundled prompt bytes and SHA-256 unchanged from the audited
  predecessor snapshot.
- Standardize the Same series block across all four keysmith repositories and
  describe `zcode-keysmith` as a managed true system-role entrypoint.

### Compatibility

- Python 3.8+; Python 3.10+ recommended.
- Verified with Grok Build CLI `0.2.103` and model `grok-4.5`.
- macOS and Linux are the primary support targets. Windows is untested.

### Known limitations

- `~/.grok/AGENTS.md` is global to all Grok sessions; there is no per-project
  isolation for the deployed instruction.
- Deployment removes pre-existing managed compat sections before injecting its
  own block. Uninstall removes only the keysmith block; manually recover prior
  compat content from the timestamped backup when needed.
- Hooks are isolated as a complete directory rename; individual hooks cannot
  be selectively retained.
- Model behavior may change across Grok CLI and model versions.
- Journal and manifest evidence protects against accidental drift and ordinary
  races, not coordinated same-user tampering.

[Unreleased]: https://github.com/Jia-Ethan/grok-keysmith/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Jia-Ethan/grok-keysmith/releases/tag/v0.1.1
