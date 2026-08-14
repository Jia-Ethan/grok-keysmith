from __future__ import annotations

import hashlib
import json
import time

from tests.conftest import COMPAT_BEGIN, COMPAT_END, parse_envelope, run_cli


def _fp(path, content):
    data = content.encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {
        "path": str(path),
        "exists": True,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "mtime": time.time(),
    }


def test_v01_manifest_uninstalls_agents_md_only(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    agents = grok_dir / "AGENTS.md"
    rule = grok_dir / "rules" / "99-keysmith.md"
    rule.parent.mkdir()
    rule.write_text("persona-card\n", encoding="utf-8")
    agents_fp = _fp(agents, "v01-keysmith\n")
    (grok_dir / "config.toml").write_text(
        "keep = true\n%s\n[compat.claude]\nskills = false\n%s\n" % (COMPAT_BEGIN, COMPAT_END),
        encoding="utf-8",
    )
    manifest = {
        "tool": "grok-keysmith",
        "version": "0.1.1",
        "deployment_id": "20260812-120000",
        "deployed_at": "2026-08-12T12:00:00Z",
        "prompt_source": "bundled",
        "prompt_sha256": agents_fp["sha256"],
        "prompt_name": "grok-unrestricted",
        "agents_md": agents_fp,
        "config_toml": _fp(grok_dir / "config.toml", (grok_dir / "config.toml").read_text()),
        "hooks": [],
        "backups": {},
        "previous_manifest_backup": None,
    }
    (grok_dir / ".grok-keysmith-manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    uninstalled = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))
    assert uninstalled["ok"] is True
    assert not agents.exists()
    assert rule.read_text(encoding="utf-8") == "persona-card\n"


def test_v03_manifest_without_schema_still_uninstalls(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    rule = grok_dir / "rules" / "99-keysmith.md"
    original_config = 'model = "grok-4"\n'
    (grok_dir / "config.toml").write_text(original_config, encoding="utf-8")
    backup = grok_dir / "config.toml.keysmith-backup-20260813-101500"
    backup.write_text(original_config, encoding="utf-8")
    deployed_config = original_config + "\n%s\n[compat.claude]\nskills = false\n%s\n" % (
        COMPAT_BEGIN,
        COMPAT_END,
    )
    (grok_dir / "config.toml").write_text(deployed_config, encoding="utf-8")
    rule_fp = _fp(rule, "v03-rule\n")
    manifest = {
        "tool": "grok-keysmith",
        "version": "0.3.0",
        "deployment_id": "20260813-101500",
        "deployed_at": "2026-08-13T10:15:00Z",
        "prompt_source": "bundled",
        "prompt_sha256": rule_fp["sha256"],
        "prompt_name": "grok-unrestricted",
        "agents_md": rule_fp,
        "config_toml": _fp(grok_dir / "config.toml", deployed_config),
        "hooks": [],
        "backups": {"config_toml": str(backup)},
        "previous_manifest_backup": None,
    }
    (grok_dir / ".grok-keysmith-manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    uninstalled = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))
    assert uninstalled["ok"] is True
    assert not rule.exists()
    assert (grok_dir / "config.toml").read_text(encoding="utf-8") == original_config


def test_old_flag_names_still_work(isolated_home):
    home, grok_dir = isolated_home
    version = run_cli(["--version"], grok_dir, home=home, json_mode=False)
    assert version.returncode == 0
    assert "grok-keysmith" in version.stdout
    preview = parse_envelope(run_cli(["--dry-run"], grok_dir, home=home))
    assert preview["operation"] == "deploy"
    applied = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
    assert applied["ok"] is True
    recovered = parse_envelope(run_cli(["--recover"], grok_dir, home=home))
    assert recovered["ok"] is True
