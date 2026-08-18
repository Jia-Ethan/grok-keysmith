# grok-keysmith GUI

Desktop `0.1.0-beta.2` is the published release. This source tree is the unreleased `0.1.0-beta.3` prerelease and wraps the Python CLI. The UI never writes `~/.grok` itself.

Stack: Tauri 2 + React 19 + Tailwind 4 + Radix + Motion + PyInstaller sidecar `grok-keysmith-cli`.

Pages: Status, Deploy, Manage, Settings. Run and Test live under Advanced tools, a single sidebar entry gated by the persisted Settings toggle "Show advanced tools" (default off); legacy `run`/`test` deep links map to its tabs.

All lifecycle calls use `--json`. The envelope schema is `grok-keysmith.envelope.v1`. Lifecycle operations are status, deploy, uninstall, restore-hooks, recover, and reconcile.

When status reports repairable compat marker or serialization drift, Desktop exposes only reconcile. It obtains a preview, confirms the user-visible plan, obtains a fresh preview, applies with that preview's `--expected-preview-token`, and verifies status returns to `active-aligned`. Reconcile is not interrupted-operation recovery; residue continues to gate it behind `--recover`.

Rust invokes argument arrays only. Output is capped at 2 MiB. Timeouts kill the process group. The app is single-instance and holds a write mutex plus lifecycle leases.

Identifier: `com.jia-ethan.grok-keysmith-gui`. Product: `grok-keysmith`. Package: `grok-keysmith-gui`.
