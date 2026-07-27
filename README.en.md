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

`grok-keysmith` is a zero-dependency, single-file Python script that deploys an instruction Markdown file as `~/.grok/AGENTS.md`, auto-loaded by every new Grok session. It previews by default and only writes on explicit confirmation; every deployment can be undone. `v0.1.1` is the first public release; the earlier private-only `0.1.0` is not part of this repository's history and must not be used.

**This changes Grok's global behavior, not a per-project setting**: deployment writes `~/.grok/AGENTS.md` (global rules auto-discovered by all sessions) and injects a compat isolation block into `~/.grok/config.toml` — disabling every Claude/Cursor compatibility surface and separately disabling Codex session import. The bundled example prompt directs the model to drop refusal framing and treats reverse-shell/bypass-style requests as local fixtures or literary templates, and covers adult content. **This is a broad behavior change, not a safety boundary** — read [`examples/grok-unrestricted.md`](examples/grok-unrestricted.md) before using it, or supply your own file with `--file`.

The bundled instruction does measurably reduce the model's refusal rate for sensitive requests; the exact boundary is model-version-dependent and shifts with model updates. This project does not publish a targeted testing methodology or specific bypass cases in its public documentation.

### Quick start (macOS / Linux)

```bash
git clone --branch v0.1.1 --depth 1 https://github.com/Jia-Ethan/grok-keysmith.git
cd grok-keysmith
test "$(git describe --tags --exact-match)" = "v0.1.1"
test "$(shasum -a 256 examples/grok-unrestricted.md | awk '{print $1}')" = "cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b"

python3 grok-keysmith.py --version
python3 grok-keysmith.py --status
python3 grok-keysmith.py --dry-run

# After confirming the target directory, prompt source, and compat/hooks plan:
python3 grok-keysmith.py --yes
```

Never install a formal release from a floating `main`. Verify with a new Grok session outside the repository directory:

```bash
cd ~
grok inspect --json | python3 -c "import sys,json; d=json.load(sys.stdin); [print('instruction',p['path'],'scope='+p['scope'],'status='+p.get('compatibilityStatus','enabled')) for p in d['projectInstructions']]; [print('compat',c['vendor'],c['surface'],'ON' if c['enabled'] else 'OFF','source='+c['source']) for c in d['externalCompat']['cells']]"
```

Should show `~/.grok/AGENTS.md` as `scope=global enabled`; every Claude/Cursor compatibility surface as `OFF`; and Codex `sessions` as `OFF`.

### Files it changes

| Path | What happens |
| --- | --- |
| `~/.grok/AGENTS.md` | Create, or back up and replace |
| `~/.grok/config.toml` | Marked `[compat.*]` isolation block injected (backed up first) |
| `~/.grok/hooks/*.json` | Isolated to `.json.disabled` (backed up first) |
| `~/.grok/.grok-keysmith-manifest.json` | Records what this deployment changed, for later uninstall |

Full field list and edge cases: [`docs/reference.md`](docs/reference.md).

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

- Python 3.8+; verified with Grok Build CLI `0.2.103`, default model `grok-4.5`.
- macOS / Linux are the primary support range; Windows is untested in v0.1.1.
- `~/.grok/AGENTS.md` is global with no per-project isolation; hooks are isolated as a whole-directory rename.
- Full limits list, compat isolation details, and maintainer verification: [`docs/reference.md`](docs/reference.md).

---

简体中文版: [`README.md`](README.md)。Agent install prompt and sibling projects: [`docs/agent-install.md`](docs/agent-install.md).
