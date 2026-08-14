from __future__ import annotations

import json

import pytest

from tests.conftest import HARD_EXIT, parse_envelope, run_cli, write_hook

DEPLOY_PHASES = [
    "after_lock",
    "after_intent",
    "after_backup_rule",
    "after_backup_config",
    "after_write_rule",
    "after_write_config",
    "after_isolate_hooks",
    "after_write_manifest",
]


@pytest.mark.parametrize("phase", DEPLOY_PHASES)
def test_recover_restores_before_state_for_each_deploy_phase(isolated_home, phase):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    (grok_dir / "rules").mkdir()
    original_rule = "before-rule-%s\n" % phase
    original_config = "model = \"keep-%s\"\n" % phase
    (grok_dir / "rules" / "99-keysmith.md").write_text(original_rule, encoding="utf-8")
    (grok_dir / "config.toml").write_text(original_config, encoding="utf-8")
    write_hook(grok_dir, "session.json", '{"keep":true}\n')

    crashed = run_cli(
        ["--yes"],
        grok_dir,
        home=home,
        extra_env={"GROK_KEYSMITH_FAULT_INJECT": phase},
    )
    assert crashed.returncode == HARD_EXIT
    status = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert status["result"]["state"] == "recovery-required"

    recovered = parse_envelope(run_cli(["--recover", "--yes"], grok_dir, home=home))
    assert recovered["ok"] is True
    assert (grok_dir / "rules" / "99-keysmith.md").read_text(encoding="utf-8") == original_rule
    assert (grok_dir / "config.toml").read_text(encoding="utf-8") == original_config
    assert (grok_dir / "hooks" / "session.json").read_text(encoding="utf-8") == '{"keep":true}\n'
    assert not list(grok_dir.glob(".grok-keysmith-transaction-*"))
    ready = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert ready["result"]["state"] == "not-installed"


def test_recover_does_not_delete_preexisting_unrelated_rule_when_hashes_differ(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    (grok_dir / "rules").mkdir()
    (grok_dir / "rules" / "99-keysmith.md").write_text("original\n", encoding="utf-8")
    crashed = run_cli(
        ["--yes"],
        grok_dir,
        home=home,
        extra_env={"GROK_KEYSMITH_FAULT_INJECT": "after_write_rule"},
    )
    assert crashed.returncode == HARD_EXIT
    (grok_dir / "rules" / "99-keysmith.md").write_text("user-changed-during-crash\n", encoding="utf-8")
    failed = parse_envelope(run_cli(["--recover", "--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert (grok_dir / "rules" / "99-keysmith.md").read_text(encoding="utf-8") == (
        "user-changed-during-crash\n"
    )
    assert list(grok_dir.glob(".grok-keysmith-transaction-*"))


def test_committed_cleanup_residue_is_recoverable(isolated_home):
    home, grok_dir = isolated_home
    crashed = run_cli(
        ["--yes"],
        grok_dir,
        home=home,
        extra_env={"GROK_KEYSMITH_FAULT_INJECT": "after_commit"},
    )
    assert crashed.returncode == HARD_EXIT
    recovered = parse_envelope(run_cli(["--recover", "--yes"], grok_dir, home=home))
    assert recovered["ok"] is True
    status = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert status["result"]["state"] == "active-aligned"
    manifest = json.loads((grok_dir / ".grok-keysmith-manifest.json").read_text(encoding="utf-8"))
    assert manifest["schema_version"] == 2
