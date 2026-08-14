from __future__ import annotations

import hashlib
import json
import os
import stat

import pytest

from tests.conftest import HARD_EXIT, parse_envelope, run_cli, write_hook


def _manifest(grok_dir):
    path = grok_dir / ".grok-keysmith-manifest.json"
    return path, json.loads(path.read_text(encoding="utf-8"))


def _legacy_fingerprint(path):
    data = path.read_bytes()
    return {
        "path": str(path),
        "exists": True,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "mtime": path.stat().st_mtime,
    }


@pytest.mark.parametrize(
    "mutation",
    [
        lambda data, sentinel: data.update({"unexpected": True}),
        lambda data, sentinel: data["layer"]["rule"].update({"path": str(sentinel)}),
        lambda data, sentinel: data["layer"]["rule"].update({"path": "../sentinel"}),
        lambda data, sentinel: data.update({"schema_version": 3}),
        lambda data, sentinel: data.update({"prompt_sha256": "0" * 64}),
        lambda data, sentinel: data["layer"]["config"]["after"].update({"size": "bad"}),
    ],
)
def test_invalid_schema2_manifest_blocks_status_redeploy_and_uninstall(
    isolated_home, mutation
):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    sentinel = home / "sentinel"
    sentinel.write_text("keep\n", encoding="utf-8")
    manifest_path, data = _manifest(grok_dir)
    mutation(data, sentinel)
    manifest_path.write_text(json.dumps(data), encoding="utf-8")

    status = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert status["result"]["state"] == "conflict"
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is False
    assert parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))["ok"] is False
    assert sentinel.read_text(encoding="utf-8") == "keep\n"


def test_legacy_manifest_cannot_reference_outside_grok_dir(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    sentinel = home / "outside.md"
    sentinel.write_text("outside\n", encoding="utf-8")
    config = grok_dir / "config.toml"
    config.write_text('model = "keep"\n', encoding="utf-8")
    sentinel_fp = _legacy_fingerprint(sentinel)
    manifest = {
        "tool": "grok-keysmith",
        "version": "0.3.0",
        "deployment_id": "20260814-120000",
        "deployed_at": "2026-08-14T12:00:00Z",
        "prompt_source": "bundled",
        "prompt_sha256": sentinel_fp["sha256"],
        "prompt_name": "grok-unrestricted",
        "agents_md": sentinel_fp,
        "config_toml": _legacy_fingerprint(config),
        "hooks": [],
        "backups": {},
        "previous_manifest_backup": None,
    }
    (grok_dir / ".grok-keysmith-manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    failed = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert sentinel.read_text(encoding="utf-8") == "outside\n"


def test_legacy_prompt_fingerprint_must_match_managed_rule(isolated_home):
    home, grok_dir = isolated_home
    rule = grok_dir / "rules" / "99-keysmith.md"
    config = grok_dir / "config.toml"
    rule.parent.mkdir(parents=True)
    rule.write_text("user-owned\n", encoding="utf-8")
    config.write_text('model = "keep"\n', encoding="utf-8")
    manifest = {
        "tool": "grok-keysmith",
        "version": "0.3.0",
        "deployment_id": "20260814-120001",
        "deployed_at": "2026-08-14T12:00:01Z",
        "prompt_source": "bundled",
        "prompt_sha256": "0" * 64,
        "prompt_name": "grok-unrestricted",
        "agents_md": _legacy_fingerprint(rule),
        "config_toml": _legacy_fingerprint(config),
        "hooks": [],
        "backups": {},
        "previous_manifest_backup": None,
    }
    (grok_dir / ".grok-keysmith-manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )

    failed = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert rule.read_text(encoding="utf-8") == "user-owned\n"
    assert not list(grok_dir.glob(".grok-keysmith-transaction-*"))


def test_unrelated_json_is_not_treated_as_legacy_ownership(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    rule = grok_dir / "rules" / "99-keysmith.md"
    rule.parent.mkdir()
    rule.write_text("user-owned\n", encoding="utf-8")
    (grok_dir / ".grok-keysmith-manifest.json").write_text(
        json.dumps({"unrelated": True}), encoding="utf-8"
    )

    failed = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert rule.read_text(encoding="utf-8") == "user-owned\n"
    assert not list(grok_dir.glob(".grok-keysmith-transaction-*"))


def test_internal_symlink_parents_are_rejected(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    outside_rules = home / "outside-rules"
    outside_rules.mkdir()
    (grok_dir / "rules").symlink_to(outside_rules)
    failed = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert not (outside_rules / "99-keysmith.md").exists()

    (grok_dir / "rules").unlink()
    outside_hooks = home / "outside-hooks"
    outside_hooks.mkdir()
    hook = outside_hooks / "session.json"
    hook.write_text('{"keep":true}\n', encoding="utf-8")
    (grok_dir / "hooks").symlink_to(outside_hooks)
    failed = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert hook.is_file()
    assert not (outside_hooks / "session.json.disabled").exists()


def test_transaction_directory_symlink_is_never_cleaned(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    outside = home / "outside-transaction"
    outside.mkdir()
    sentinel = outside / "sentinel"
    sentinel.write_text("keep\n", encoding="utf-8")
    name = ".grok-keysmith-transaction-" + "a" * 32
    (grok_dir / name).symlink_to(outside)

    failed = parse_envelope(run_cli(["--recover", "--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert sentinel.read_text(encoding="utf-8") == "keep\n"
    assert (grok_dir / name).is_symlink()


@pytest.mark.parametrize(
    "tamper", ["journal-extra", "intent-operation", "resource-path", "target-identity"]
)
def test_tampered_transaction_evidence_fails_closed(isolated_home, tamper):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    (grok_dir / "rules").mkdir()
    (grok_dir / "rules" / "99-keysmith.md").write_text("before\n", encoding="utf-8")
    write_hook(grok_dir, "session.json", '{"keep":true}\n')
    crashed = run_cli(
        ["--yes"],
        grok_dir,
        home=home,
        extra_env={"GROK_KEYSMITH_FAULT_INJECT": "after_write_rule"},
    )
    assert crashed.returncode == HARD_EXIT
    jdir = next(grok_dir.glob(".grok-keysmith-transaction-*"))
    intent_path = jdir / "intent.json"
    journal_path = jdir / "journal.json"
    intent = json.loads(intent_path.read_text(encoding="utf-8"))
    journal = json.loads(journal_path.read_text(encoding="utf-8"))
    if tamper == "journal-extra":
        journal["extra"] = True
    elif tamper == "intent-operation":
        intent["operation"] = "uninstall"
    elif tamper == "resource-path":
        intent["resources"][0]["path"] = str(home / "outside")
        journal["resources"][0]["path"] = str(home / "outside")
    else:
        intent["target"]["identity"]["ino"] += 1
        journal["target"]["identity"]["ino"] += 1
    intent_path.chmod(0o644)
    intent_path.write_text(json.dumps(intent), encoding="utf-8")
    journal_path.write_text(json.dumps(journal), encoding="utf-8")

    failed = parse_envelope(run_cli(["--recover", "--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert jdir.exists()


def test_duplicate_owned_hook_paths_are_rejected_before_uninstall(isolated_home):
    home, grok_dir = isolated_home
    write_hook(grok_dir, "session.json", '{"keep":true}\n')
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    manifest_path, manifest = _manifest(grok_dir)
    manifest["layer"]["hooks"]["owned"].append(
        dict(manifest["layer"]["hooks"]["owned"][0])
    )
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    failed = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert (grok_dir / "hooks" / "session.json.disabled").is_file()
    assert not list(grok_dir.glob(".grok-keysmith-transaction-*"))


def test_deploy_and_uninstall_preserve_private_modes(isolated_home):
    if os.name == "nt":
        pytest.skip("Windows does not expose POSIX permission modes")
    home, grok_dir = isolated_home
    rule = grok_dir / "rules" / "99-keysmith.md"
    config = grok_dir / "config.toml"
    rule.parent.mkdir(parents=True)
    rule.write_text("private-rule\n", encoding="utf-8")
    config.write_text('token_source = "private"\n', encoding="utf-8")
    rule.chmod(0o600)
    config.chmod(0o600)

    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    assert stat.S_IMODE(rule.stat().st_mode) == 0o600
    assert stat.S_IMODE(config.stat().st_mode) == 0o600
    assert stat.S_IMODE((grok_dir / ".grok-keysmith-manifest.json").stat().st_mode) == 0o600

    assert parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))["ok"] is True
    assert rule.read_text(encoding="utf-8") == "private-rule\n"
    assert config.read_text(encoding="utf-8") == 'token_source = "private"\n'
    assert stat.S_IMODE(rule.stat().st_mode) == 0o600
    assert stat.S_IMODE(config.stat().st_mode) == 0o600


def test_new_config_defaults_to_private_mode(isolated_home):
    if os.name == "nt":
        pytest.skip("Windows does not expose POSIX permission modes")
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    assert stat.S_IMODE((grok_dir / "config.toml").stat().st_mode) == 0o600


def test_recovery_restores_private_modes(isolated_home):
    if os.name == "nt":
        pytest.skip("Windows does not expose POSIX permission modes")
    home, grok_dir = isolated_home
    rule = grok_dir / "rules" / "99-keysmith.md"
    config = grok_dir / "config.toml"
    rule.parent.mkdir(parents=True)
    rule.write_text("private-rule\n", encoding="utf-8")
    config.write_text('token_source = "private"\n', encoding="utf-8")
    rule.chmod(0o600)
    config.chmod(0o600)

    crashed = run_cli(
        ["--yes"],
        grok_dir,
        home=home,
        extra_env={"GROK_KEYSMITH_FAULT_INJECT": "after_write_config"},
    )
    assert crashed.returncode == HARD_EXIT
    recovered = parse_envelope(run_cli(["--recover", "--yes"], grok_dir, home=home))
    assert recovered["ok"] is True
    assert rule.read_text(encoding="utf-8") == "private-rule\n"
    assert config.read_text(encoding="utf-8") == 'token_source = "private"\n'
    assert stat.S_IMODE(rule.stat().st_mode) == 0o600
    assert stat.S_IMODE(config.stat().st_mode) == 0o600
