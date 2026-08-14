<!-- markdownlint-disable MD013 MD033 MD041 -->

<h1 align="center">grok-keysmith</h1>

<p align="center">
  Versioned Grok Build instruction deployment with preview, compat isolation, hook isolation, and layered uninstall.
</p>

<p align="center">
  <a href="README.md">简体中文</a> ·
  <a href="#english">English</a> ·
  <a href="docs/reference.md">Reference</a> ·
  <a href="docs/agent-install.md">Agent install</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="LICENSE">License</a>
</p>

## English

### What this is

`grok-keysmith` is a zero-dependency, single-file Python script that deploys an instruction Markdown file as `~/.grok/rules/99-keysmith.md`, auto-loaded by every new Grok session. It previews by default and only writes on explicit confirmation; every deployment can be undone. `v0.1.1` is the first public release; `v0.3.0` reworks the deployment surface and the bundled instruction for the Grok 4.6 alignment layer; the earlier private-only `0.1.0` is not part of this repository's history and must not be used.

**This changes Grok's global behavior, not a per-project setting**: deployment writes `~/.grok/rules/99-keysmith.md` (home rules, always scanned by every session) and injects a compat isolation block into `~/.grok/config.toml` — disabling every Claude/Cursor compatibility surface and separately disabling Codex session import. **`~/.grok/AGENTS.md` is no longer touched by this tool**: a persona card, agent profile, or any global instruction can keep living there, fully decoupled from the keysmith deployment. The bundled instruction is a delivery contract covering reverse engineering and penetration testing workflows (local-fixture/placeholder framing) and measurably reduces refusal framing for sensitive requests. **This is a broad behavior change, not a safety boundary** — read [`examples/grok-unrestricted.md`](examples/grok-unrestricted.md) before using it, or supply your own file with `--file`.

The covered boundary is model-version-dependent and shifts with model updates; Grok 4.6 alignment lives at the model-weight level, so the contract raises compliance on covered domains but does not change weight-level hard refusals outside those scopes. This project does not publish a targeted testing methodology or specific bypass cases in its public documentation.

### Quick start (macOS / Linux)

```bash
git clone --branch v0.3.0 --depth 1 https://github.com/Jia-Ethan/grok-keysmith.git
cd grok-keysmith
test "$(git describe --tags --exact-match)" = "v0.3.0"
test "$(shasum -a 256 examples/grok-unrestricted.md | awk '{print $1}')" = "d693411fd79f57c5e805e7bcbb27b42bacdd11e6a6af8858ab998017196dc898"

python3 grok-keysmith.py --version
python3 grok-keysmith.py --status --json
python3 grok-keysmith.py --dry-run --json

# After confirming the target directory, prompt source, and compat/hooks plan:
python3 grok-keysmith.py --yes --json
```

Never install a formal release from a floating `main`. Verify with a new Grok session outside the repository directory:

```bash
cd ~
grok inspect --json | python3 -c "import sys,json; d=json.load(sys.stdin); [print('instruction',p['path'],'scope='+p['scope'],'status='+p.get('compatibilityStatus','enabled')) for p in d['projectInstructions']]; [print('compat',c['vendor'],c['surface'],'ON' if c['enabled'] else 'OFF','source='+c['source']) for c in d['externalCompat']['cells']]"
```

Should show `~/.grok/rules/99-keysmith.md` as enabled; every Claude/Cursor compatibility surface as `OFF`; and Codex `sessions` as `OFF`. `~/.grok/AGENTS.md` is not affected.

### Files it changes

| Path | What happens |
| --- | --- |
| `~/.grok/rules/99-keysmith.md` | Create, or back up and replace |
| `~/.grok/config.toml` | Marked `[compat.*]` isolation block injected (backed up first) |
| `~/.grok/hooks/*.json` | Isolated to `.json.disabled` (backed up first) |
| `~/.grok/.grok-keysmith-manifest.json` | Records what this deployment changed, for later uninstall |

`~/.grok/AGENTS.md` is not touched: persona cards and agent profiles stay fully decoupled from the keysmith deployment. During uninstall, a file whose content no longer matches the deployment record (e.g. AGENTS.md later replaced by a persona card) is preserved.

Full field list and edge cases: [`docs/reference.md`](docs/reference.md). Desktop notes: [`gui/README.md`](gui/README.md) and [`docs/releases/desktop-v0.1.0-beta.1.md`](docs/releases/desktop-v0.1.0-beta.1.md). `--json` emits `grok-keysmith.envelope.v1`. `--grok-dir` must be absolute. `run` / `breaktest` never log in or read tokens.

### Undo

```bash
# Only restore hooks:
python3 grok-keysmith.py --restore-hooks --yes

# Fully undo this deployment:
python3 grok-keysmith.py --uninstall          # preview first
python3 grok-keysmith.py --uninstall --yes    # confirm
```

### If something goes wrong

| Symptom | What to do |
| --- | --- |
| Deployment interrupted by SIGKILL | `--status` reports a non-terminal journal and blocks further deployment; preview `--recover`, then confirm with `--recover --yes` |
| You want to clean up old backups | The tool never auto-deletes `*.keysmith-backup-*` or `.uninstalled-*`; clean up manually after verifying |

### Compatibility and limits

- Python 3.8+; bundled instruction rewritten for Grok Build model `grok-4.6`.
- macOS / Linux are the primary support range; Windows is untested.
- `~/.grok/rules/` is global home rules with no per-project isolation; hooks are isolated as a whole-directory rename.
- v0.1.x deployments (written to `~/.grok/AGENTS.md`) remain uninstallable by v0.3.0; uninstall verifies content ownership first.
- Full limits list, compat isolation details, and maintainer verification: [`docs/reference.md`](docs/reference.md).

### Community

This project accepts monitoring and feedback from the LINUX DO community: [LINUX DO](https://linux.do)

Same series:

- [codex-keysmith](https://github.com/Jia-Ethan/codex-keysmith) - Versioned instruction deployment for local Codex CLI configuration with preview, hook isolation, interruption recovery, and layered uninstall.
- [claude-keysmith](https://github.com/Jia-Ethan/claude-keysmith) - Managed Claude Code `CLAUDE.md` import-block installer for local Markdown instruction files.
- [zcode-keysmith](https://github.com/Jia-Ethan/zcode-keysmith) - Managed true system-role entrypoint for ZCode App.
- [grok-keysmith](https://github.com/Jia-Ethan/grok-keysmith) - Home-rules instruction deployment for Grok Build (`~/.grok/rules/99-keysmith.md`), decoupled from AGENTS.md persona cards, with compat/hook isolation, interruption recovery, and layered uninstall.

---

简体中文版: [`README.md`](README.md)。Agent install prompt: [`docs/agent-install.md`](docs/agent-install.md).
