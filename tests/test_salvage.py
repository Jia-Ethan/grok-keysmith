# Uninstall when the managed config backup is gone (Keysmith Switch issue #95).
from __future__ import annotations

from conftest import COMPAT_BEGIN, COMPAT_END, parse_envelope, run_cli


def _deploy(grok_dir, tmp_path):
    grok_dir.mkdir(parents=True, exist_ok=True)
    (grok_dir / "config.toml").write_text('[ui]\npermission_mode = "ask"\n', encoding="utf-8")
    prompt = tmp_path / "p.md"
    prompt.write_text("# Test\nhello\n", encoding="utf-8")
    done = parse_envelope(run_cli(["--file", prompt, "--name", "test", "--yes"], grok_dir))
    assert done["ok"], done


def _lose_backup_and_edit(grok_dir):
    for backup in grok_dir.glob("config.toml.keysmith-backup-*"):
        backup.unlink()
    with (grok_dir / "config.toml").open("a", encoding="utf-8") as handle:
        handle.write('\n[models]\ndefault = "grok-4.6"\n')


def test_without_salvage_a_lost_backup_still_blocks(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _deploy(grok_dir, tmp_path)
    _lose_backup_and_edit(grok_dir)
    preview = parse_envelope(run_cli(["--uninstall"], grok_dir))
    assert not preview["ok"]
    assert "managed config backup is missing or abnormal" in str(preview)


def test_status_says_salvage_is_available(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _deploy(grok_dir, tmp_path)
    _lose_backup_and_edit(grok_dir)
    preview = parse_envelope(run_cli(["--uninstall", "--salvage-config"], grok_dir))
    assert preview["ok"], preview
    assert preview["plan"]["config_salvage"] is True


def test_salvage_removes_only_the_compat_block_and_keeps_edits(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _deploy(grok_dir, tmp_path)
    _lose_backup_and_edit(grok_dir)
    before = (grok_dir / "config.toml").read_text(encoding="utf-8")
    assert COMPAT_BEGIN in before
    done = parse_envelope(run_cli(["--uninstall", "--salvage-config", "--yes"], grok_dir))
    assert done["ok"], done
    after = (grok_dir / "config.toml").read_text(encoding="utf-8")
    assert COMPAT_BEGIN not in after and COMPAT_END not in after
    assert 'permission_mode = "ask"' in after
    assert 'default = "grok-4.6"' in after
    assert not (grok_dir / ".grok-keysmith-manifest.json").exists()
    status = parse_envelope(run_cli(["--status"], grok_dir))
    assert status["ok"], status
    assert "drift" not in str(status.get("blockers") or "")


def test_salvage_does_not_cover_other_drift(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _deploy(grok_dir, tmp_path)
    _lose_backup_and_edit(grok_dir)
    rules = [path for path in (grok_dir / "rules").glob("*.md") if "backup" not in path.name]
    assert rules
    rules[0].write_text("changed by hand\n", encoding="utf-8")
    preview = parse_envelope(run_cli(["--uninstall", "--salvage-config"], grok_dir))
    assert not preview["ok"]
    assert "rule content does not match managed after-state" in str(preview)


def test_salvage_is_not_used_when_the_backup_is_intact(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _deploy(grok_dir, tmp_path)
    preview = parse_envelope(run_cli(["--uninstall", "--salvage-config"], grok_dir))
    assert preview["ok"], preview
    assert preview["plan"]["config_salvage"] is False


def test_salvage_requires_uninstall(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    completed = run_cli(["--status", "--salvage-config"], grok_dir)
    assert completed.returncode == 2
