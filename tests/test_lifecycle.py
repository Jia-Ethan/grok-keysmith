from __future__ import annotations

import hashlib
import json

from tests.conftest import (
    COMPAT_BEGIN,
    COMPAT_END,
    parse_envelope,
    run_cli,
    snapshot_tree,
    write_hook,
)


def test_fresh_dir_status_deploy_uninstall(isolated_home):
    home, grok_dir = isolated_home
    status = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert status["result"]["state"] == "not-installed"

    preview = parse_envelope(run_cli(["--dry-run"], grok_dir, home=home))
    assert preview["ok"] is True
    assert preview["preview"] is True
    assert preview["apply"] is False
    assert preview["operation"] == "deploy"
    assert not grok_dir.exists() or not (grok_dir / "config.toml").exists()
    assert preview["plan"]["config"]["will_write_markers"] is True

    applied = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
    assert applied["ok"] is True
    assert applied["apply"] is True
    assert applied["preview"] is False
    config = (grok_dir / "config.toml").read_text(encoding="utf-8")
    assert COMPAT_BEGIN in config
    assert COMPAT_END in config
    assert "[compat.claude]" in config
    rule = grok_dir / "rules" / "99-keysmith.md"
    assert rule.is_file()
    manifest = json.loads((grok_dir / ".grok-keysmith-manifest.json").read_text(encoding="utf-8"))
    assert manifest["schema_version"] == 2
    assert manifest["layer"]["rule"]["before"] is None
    assert manifest["layer"]["config"]["before"] is None
    assert manifest["layer"]["rule"]["after"]["sha256"] == hashlib.sha256(
        rule.read_bytes()
    ).hexdigest()

    ready = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert ready["result"]["state"] == "active-aligned"

    uninstall_preview = parse_envelope(run_cli(["--uninstall"], grok_dir, home=home))
    assert uninstall_preview["preview"] is True
    assert rule.exists()

    uninstalled = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))
    assert uninstalled["ok"] is True
    assert not rule.exists()
    if (grok_dir / "config.toml").exists():
        leftover = (grok_dir / "config.toml").read_text(encoding="utf-8")
        assert COMPAT_BEGIN not in leftover
        assert COMPAT_END not in leftover
    assert not (grok_dir / ".grok-keysmith-manifest.json").exists()
    empty = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert empty["result"]["state"] == "not-installed"


def test_existing_rule_and_config_restored_exactly(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    (grok_dir / "rules").mkdir()
    original_rule = "keep-this-rule\nsecond-line\n"
    original_config = 'model = "grok-4.6"\n\n[ui]\nscreen_mode = "minimal"\n'
    (grok_dir / "rules" / "99-keysmith.md").write_text(original_rule, encoding="utf-8")
    (grok_dir / "config.toml").write_text(original_config, encoding="utf-8")
    before = snapshot_tree(grok_dir)

    applied = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
    assert applied["ok"] is True
    assert (grok_dir / "rules" / "99-keysmith.md").read_text(encoding="utf-8") != original_rule
    config = (grok_dir / "config.toml").read_text(encoding="utf-8")
    assert COMPAT_BEGIN in config
    assert 'model = "grok-4.6"' in config

    uninstalled = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))
    assert uninstalled["ok"] is True
    after = snapshot_tree(grok_dir)
    assert after["rules/99-keysmith.md"] == before["rules/99-keysmith.md"]
    assert after["config.toml"] == before["config.toml"]


def test_external_disabled_hook_is_not_taken_over(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    owned = write_hook(grok_dir, "owned.json", '{"owned":true}\n')
    external = write_hook(grok_dir, "external.json.disabled", '{"external":true}\n')
    external_bytes = external.read_bytes()

    applied = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
    assert applied["ok"] is True
    assert not owned.exists()
    assert (grok_dir / "hooks" / "owned.json.disabled").is_file()
    assert external.exists()
    assert external.read_bytes() == external_bytes
    manifest = json.loads((grok_dir / ".grok-keysmith-manifest.json").read_text(encoding="utf-8"))
    owned_names = [item["original"].split("/")[-1] for item in manifest["layer"]["hooks"]["owned"]]
    assert "owned.json" in owned_names
    assert "external.json.disabled" in [
        name.split("/")[-1] for name in manifest["layer"]["hooks"]["external_disabled_untouched"]
    ]

    restored = parse_envelope(run_cli(["--restore-hooks", "--yes"], grok_dir, home=home))
    assert restored["ok"] is True
    assert owned.is_file()
    assert owned.read_text(encoding="utf-8") == '{"owned":true}\n'
    assert external.exists()
    assert external.read_bytes() == external_bytes
    assert not (grok_dir / "hooks" / "owned.json.disabled").exists()


def test_layered_uninstall_only_removes_current_layer(isolated_home):
    home, grok_dir = isolated_home
    first = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
    assert first["ok"] is True
    first_id = first["result"]["deployment_id"]
    custom = home / "custom.md"
    custom.write_text("# custom layer\n", encoding="utf-8")
    second = parse_envelope(
        run_cli(["--file", custom, "--name", "custom-layer", "--yes"], grok_dir, home=home)
    )
    assert second["ok"] is True
    assert (grok_dir / "rules" / "99-keysmith.md").read_text(encoding="utf-8") == "# custom layer\n"

    uninstalled = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))
    assert uninstalled["ok"] is True
    manifest = json.loads((grok_dir / ".grok-keysmith-manifest.json").read_text(encoding="utf-8"))
    assert manifest["deployment_id"] == first_id
    assert (grok_dir / "rules" / "99-keysmith.md").read_text(encoding="utf-8") != "# custom layer\n"
    status = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert status["result"]["state"] == "active-aligned"


def test_drift_blocks_uninstall_and_keeps_evidence(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    rule = grok_dir / "rules" / "99-keysmith.md"
    rule.write_text("user edited this rule\n", encoding="utf-8")
    status = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert status["result"]["state"] == "drift"
    failed = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert rule.read_text(encoding="utf-8") == "user edited this rule\n"
    assert (grok_dir / ".grok-keysmith-manifest.json").is_file()
    journals = list(grok_dir.glob(".grok-keysmith-transaction-*"))
    assert journals or failed["diagnostics"]


def test_inactive_when_compat_removed(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    (grok_dir / "config.toml").write_text("model = \"plain\"\n", encoding="utf-8")
    status = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert status["result"]["state"] in {"inactive", "drift"}


def test_status_conflict_on_rule_directory(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    rule = grok_dir / "rules" / "99-keysmith.md"
    rule.unlink()
    rule.mkdir()
    status = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert status["result"]["state"] == "conflict"
    assert status["exit_code"] != 0


def test_active_hook_with_existing_disabled_peer_blocks_without_mutation(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    active = write_hook(grok_dir, "session.json", '{"active":true}\n')
    disabled = write_hook(grok_dir, "session.json.disabled", '{"disabled":true}\n')
    active_bytes = active.read_bytes()
    disabled_bytes = disabled.read_bytes()

    failed = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert active.read_bytes() == active_bytes
    assert disabled.read_bytes() == disabled_bytes
    assert not (grok_dir / ".grok-keysmith-manifest.json").exists()


def test_owned_disabled_hook_tamper_blocks_status_restore_and_uninstall(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    write_hook(grok_dir, "session.json", '{"owned":true}\n')
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    disabled = grok_dir / "hooks" / "session.json.disabled"
    disabled.write_text('{"tampered":true}\n', encoding="utf-8")

    status = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert status["result"]["state"] == "drift"
    assert parse_envelope(run_cli(["--restore-hooks", "--yes"], grok_dir, home=home))[
        "ok"
    ] is False
    assert parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))["ok"] is False
    assert not (grok_dir / "hooks" / "session.json").exists()
    assert disabled.read_text(encoding="utf-8") == '{"tampered":true}\n'


def test_config_drift_status_uninstall_and_redeploy_agree(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    config = grok_dir / "config.toml"
    config.write_text(config.read_text(encoding="utf-8") + "\nuser = true\n", encoding="utf-8")

    status = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert status["result"]["state"] == "drift"
    assert parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))["ok"] is False
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is False


def test_schema2_manifest_paths_are_relative(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    write_hook(grok_dir, "session.json", '{"owned":true}\n')
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    manifest = json.loads((grok_dir / ".grok-keysmith-manifest.json").read_text(encoding="utf-8"))
    layer = manifest["layer"]
    paths = [layer["rule"]["path"], layer["config"]["path"]]
    paths.extend(item["original"] for item in layer["hooks"]["owned"])
    paths.extend(item["disabled"] for item in layer["hooks"]["owned"])
    paths.extend(
        value
        for value in (
            layer["rule"]["backup"],
            layer["config"]["backup"],
            layer["previous_manifest"]["backup"],
        )
        if value
    )
    assert paths
    assert all(not value.startswith("/") and ".." not in value.split("/") for value in paths)
