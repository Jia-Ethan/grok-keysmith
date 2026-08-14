from __future__ import annotations

import json

import pytest

from tests.conftest import HARD_EXIT, parse_envelope, run_cli, snapshot_tree, write_hook

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


@pytest.mark.parametrize(
    "phase", ["after_transaction_dir", "after_transaction_intent"]
)
def test_recover_handles_transaction_initialization_gaps(isolated_home, phase):
    home, grok_dir = isolated_home
    crashed = run_cli(
        ["--yes"],
        grok_dir,
        home=home,
        extra_env={"GROK_KEYSMITH_FAULT_INJECT": phase},
    )
    assert crashed.returncode == HARD_EXIT
    assert list(grok_dir.glob(".grok-keysmith-transaction-*"))

    recovered = parse_envelope(run_cli(["--recover", "--yes"], grok_dir, home=home))
    assert recovered["ok"] is True
    assert not list(grok_dir.glob(".grok-keysmith-transaction-*"))
    assert parse_envelope(run_cli(["--status"], grok_dir, home=home))["result"]["state"] == (
        "not-installed"
    )


def test_committed_cleanup_is_idempotent_after_intent_removal(isolated_home):
    home, grok_dir = isolated_home
    crashed = run_cli(
        ["--yes"],
        grok_dir,
        home=home,
        extra_env={"GROK_KEYSMITH_FAULT_INJECT": "after_cleanup_intent"},
    )
    assert crashed.returncode == HARD_EXIT
    jdir = next(grok_dir.glob(".grok-keysmith-transaction-*"))
    assert not (jdir / "intent.json").exists()
    assert (jdir / "journal.json").is_file()

    recovered = parse_envelope(run_cli(["--recover", "--yes"], grok_dir, home=home))
    assert recovered["ok"] is True
    assert not list(grok_dir.glob(".grok-keysmith-transaction-*"))
    assert parse_envelope(run_cli(["--status"], grok_dir, home=home))["result"]["state"] == (
        "active-aligned"
    )


def test_recover_removes_owned_atomic_temp_residue(isolated_home):
    home, grok_dir = isolated_home
    crashed = run_cli(
        ["--yes"],
        grok_dir,
        home=home,
        extra_env={"GROK_KEYSMITH_FAULT_INJECT": "after_transaction_intent"},
    )
    assert crashed.returncode == HARD_EXIT
    jdir = next(grok_dir.glob(".grok-keysmith-transaction-*"))
    txid = jdir.name.rsplit("-", 1)[-1]
    residue = jdir / (".journal.json.tmp-keysmith-%s-999999" % txid)
    residue.write_text("partial journal", encoding="utf-8")

    recovered = parse_envelope(run_cli(["--recover", "--yes"], grok_dir, home=home))
    assert recovered["ok"] is True
    assert not jdir.exists()


def test_recover_keeps_unknown_transaction_residue_fail_closed(isolated_home):
    home, grok_dir = isolated_home
    crashed = run_cli(
        ["--yes"],
        grok_dir,
        home=home,
        extra_env={"GROK_KEYSMITH_FAULT_INJECT": "after_transaction_intent"},
    )
    assert crashed.returncode == HARD_EXIT
    jdir = next(grok_dir.glob(".grok-keysmith-transaction-*"))
    unknown = jdir / ".unknown.tmp-keysmith-deadbeef-999999"
    unknown.write_text("keep", encoding="utf-8")

    failed = parse_envelope(run_cli(["--recover", "--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert unknown.read_text(encoding="utf-8") == "keep"
    assert jdir.exists()


@pytest.mark.parametrize(
    "phase",
    ["after_rule_intent", "after_config_intent", "after_hooks_intent", "after_manifest_intent"],
)
def test_recover_handles_intent_before_mutation_windows(isolated_home, phase):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    (grok_dir / "rules").mkdir()
    (grok_dir / "rules" / "99-keysmith.md").write_text("before-rule\n", encoding="utf-8")
    (grok_dir / "config.toml").write_text('model = "before"\n', encoding="utf-8")
    write_hook(grok_dir, "session.json", '{"before":true}\n')
    before = snapshot_tree(grok_dir)

    crashed = run_cli(
        ["--yes"],
        grok_dir,
        home=home,
        extra_env={"GROK_KEYSMITH_FAULT_INJECT": phase},
    )
    assert crashed.returncode == HARD_EXIT
    recovered = parse_envelope(run_cli(["--recover", "--yes"], grok_dir, home=home))
    assert recovered["ok"] is True
    after = snapshot_tree(grok_dir)
    after.pop(".grok-keysmith.lock", None)
    before.pop(".grok-keysmith.lock", None)
    assert after == before


@pytest.mark.parametrize("phase", ["after_manifest_intent", "after_write_manifest"])
def test_layered_redeploy_recovery_restores_previous_manifest(isolated_home, phase):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    before = snapshot_tree(grok_dir)
    first_manifest = json.loads(
        (grok_dir / ".grok-keysmith-manifest.json").read_text(encoding="utf-8")
    )
    custom = home / "custom.md"
    custom.write_text("# replacement\n", encoding="utf-8")
    crashed = run_cli(
        ["--file", custom, "--name", "replacement", "--yes"],
        grok_dir,
        home=home,
        extra_env={"GROK_KEYSMITH_FAULT_INJECT": phase},
    )
    assert crashed.returncode == HARD_EXIT

    recovered = parse_envelope(run_cli(["--recover", "--yes"], grok_dir, home=home))
    assert recovered["ok"] is True
    restored_manifest = json.loads(
        (grok_dir / ".grok-keysmith-manifest.json").read_text(encoding="utf-8")
    )
    assert restored_manifest["deployment_id"] == first_manifest["deployment_id"]
    assert snapshot_tree(grok_dir) == before


UNINSTALL_PHASES = [
    "after_uninstall_intent",
    "after_uninstall_snapshots",
    "after_uninstall_config_intent",
    "after_uninstall_config",
    "after_uninstall_rule_intent",
    "after_uninstall_rule",
    "after_uninstall_hooks_intent",
    "after_uninstall_hook",
    "after_uninstall_hooks",
    "after_uninstall_manifest_intent",
    "after_uninstall_archive",
    "after_uninstall_manifest",
]


@pytest.mark.parametrize("phase", UNINSTALL_PHASES)
def test_uninstall_recovery_restores_complete_deployed_before_state(isolated_home, phase):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    (grok_dir / "rules").mkdir()
    (grok_dir / "rules" / "99-keysmith.md").write_text("original-rule\n", encoding="utf-8")
    (grok_dir / "config.toml").write_text('model = "original"\n', encoding="utf-8")
    write_hook(grok_dir, "session.json", '{"original":true}\n')
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    before = snapshot_tree(grok_dir)

    crashed = run_cli(
        ["--uninstall", "--yes"],
        grok_dir,
        home=home,
        extra_env={"GROK_KEYSMITH_FAULT_INJECT": phase},
    )
    assert crashed.returncode == HARD_EXIT
    assert parse_envelope(run_cli(["--status"], grok_dir, home=home))["result"]["state"] == (
        "recovery-required"
    )

    recovered = parse_envelope(run_cli(["--recover", "--yes"], grok_dir, home=home))
    assert recovered["ok"] is True
    assert snapshot_tree(grok_dir) == before
    status = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert status["result"]["state"] == "active-aligned"
