# Repository Agent Guide

## Scope

These rules apply to the complete `grok-keysmith` repository. The project is a
zero-runtime-dependency Python CLI that manages global Grok Build instruction,
compatibility, hook, manifest, and recovery state under `~/.grok`.

## Release and External State

- Public repository history starts at `v0.1.1`; do not import refs, commit IDs,
  tags, or metadata from the earlier private-only predecessor.
- Keep existing public version tags unchanged: do not move, recreate, or
  overwrite them.
- Verify repository visibility, tags, Releases, assets, and settings live
  before documenting external state; a Git tag is not a GitHub Release.
- Creating a Release, workflow, repository setting, or other external
  publication action requires task-specific user approval.

## Change Boundaries

- Preserve preview-first behavior. Deploy, uninstall, restore, and recovery
  writes require explicit `--yes`; `--status` remains read-only.
- Do not test write paths against the real `~/.grok`. Use an isolated temporary
  `HOME` and retain failure evidence until the test completes.
- Preserve fail-closed ownership checks for manifests, backups, hooks, config
  markers, journals, and immutable intent data.
- Do not patch Grok binaries, intercept network traffic, manage credentials, or
  alter running Grok processes.
- Treat `examples/grok-unrestricted.md`, `BUNDLED_PROMPT_B64`, and
  `BUNDLED_PROMPT_SHA256` as one versioned unit. Any prompt change must update
  all three byte-for-byte and update README, CHANGELOG, and SECURITY hashes.
- Keep Python 3.8 compatibility and standard-library-only runtime behavior
  unless a versioned compatibility change is explicitly approved.

## Documentation Rules

- Keep the verified distribution boundary accurate. Do not describe a Git tag
  as a GitHub Release or claim downloadable assets without live evidence.
- README is bilingual: Simplified Chinese is the complete primary guide and
  English is the concise equivalent. Keep commands, hashes, limitations, and
  file paths aligned across both sections.
- `CHANGELOG.md` records versioned user-visible changes. `SECURITY.md` owns
  coordinated vulnerability reporting, rollback, prompt integrity, and
  sensitive-data guidance.
- Do not put credentials, tokens, cookies, private configuration, or complete
  local user paths in tracked files or examples.

## Verification

Before committing implementation or prompt changes:

1. Parse `grok-keysmith.py` with Python 3.8-compatible syntax.
2. Confirm `VERSION`, `VERSION` in Python, and documented version agree.
3. Decode `BUNDLED_PROMPT_B64` and compare it byte-for-byte with
   `examples/grok-unrestricted.md`.
4. Confirm the decoded prompt SHA-256 equals `BUNDLED_PROMPT_SHA256` and the
   hashes documented in README and SECURITY.
5. Run `--version`, then exercise `--status` and `--dry-run` under an isolated
   temporary `HOME`.
6. Run `git diff --check` and inspect the complete intended diff.

Automated tests live under `tests/` and must use an isolated `HOME` plus
`--grok-dir`. Do not call a real Grok model or read the operator `~/.grok`.

Do not claim a Windows candidate, signed package, or GitHub Release unless the
repository actually contains that evidence.
