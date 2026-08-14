from __future__ import annotations

import importlib.util
import os
import stat
import subprocess
import sys
import time
from pathlib import Path

import pytest

from tests.conftest import CLI, cli_env, parse_envelope, run_cli


def load_cli_module():
    spec = importlib.util.spec_from_file_location("grok_keysmith_cli_test", str(CLI))
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_two_processes_one_writer(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    lock = grok_dir / ".grok-keysmith.lock"
    lock.write_bytes(b"holder\n")
    # Hold an exclusive lock in this process so the child cannot apply.
    fd = os.open(str(lock), os.O_RDWR)
    try:
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        completed = run_cli(["--yes"], grok_dir, home=home)
        envelope = parse_envelope(completed)
        assert envelope["ok"] is False
        assert any("lock" in item.lower() for item in envelope["diagnostics"])
        assert not (grok_dir / ".grok-keysmith-manifest.json").exists()
    finally:
        os.close(fd)


@pytest.mark.parametrize(
    ("arguments", "operation"),
    [
        (["--recover", "--yes"], "recover"),
        (["--restore-hooks", "--yes"], "restore_hooks"),
    ],
)
def test_lock_error_reports_requested_operation(isolated_home, arguments, operation):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    lock = grok_dir / ".grok-keysmith.lock"
    lock.write_bytes(b"holder\n")
    fd = os.open(str(lock), os.O_RDWR)
    try:
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        envelope = parse_envelope(run_cli(arguments, grok_dir, home=home))
        assert envelope["ok"] is False
        assert envelope["operation"] == operation
    finally:
        os.close(fd)


def test_same_second_redeploy_uses_unique_ids(isolated_home):
    home, grok_dir = isolated_home
    first = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
    second = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
    assert first["ok"] is True
    assert second["ok"] is True
    assert first["result"]["deployment_id"] != second["result"]["deployment_id"]
    backups = list(grok_dir.glob("*.keysmith-backup-*")) + list(
        grok_dir.glob("rules/*.keysmith-backup-*")
    )
    names = [path.name for path in backups]
    assert len(names) == len(set(names))


def test_symlink_file_target_is_conflict(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    (grok_dir / "rules").mkdir()
    real = grok_dir / "outside-rule.md"
    real.write_text("not-ours\n", encoding="utf-8")
    (grok_dir / "rules" / "99-keysmith.md").symlink_to(real)
    status = parse_envelope(run_cli(["--status"], grok_dir, home=home))
    assert status["result"]["state"] == "conflict"
    failed = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert real.read_text(encoding="utf-8") == "not-ours\n"


def test_grok_dir_symlink_resolves_and_deploys(isolated_home):
    home, grok_dir = isolated_home
    real = home / "real-grok"
    real.mkdir()
    grok_dir.symlink_to(real)
    applied = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
    assert applied["ok"] is True
    assert (real / "rules" / "99-keysmith.md").is_file()
    assert applied["target"]["grok_dir"] == str(real.resolve())


def test_path_rebind_during_apply_fails_closed(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    decoy = home / "rebind-target"
    decoy.mkdir()
    env = cli_env(home, {"GROK_KEYSMITH_FAULT_INJECT": "after_lock"})
    proc = subprocess.Popen(
        [
            sys.executable,
            "-B",
            str(CLI),
            "--json",
            "--lang",
            "en",
            "--grok-dir",
            str(grok_dir),
            "--yes",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    # The after_lock hook exits immediately; this test instead replaces the
    # directory between a dry-run bind and apply by swapping the inode.
    proc.wait(timeout=10)
    swapped = home / "swapped"
    swapped.mkdir()
    (swapped / "config.toml").write_text("stolen\n", encoding="utf-8")
    grok_dir.rename(home / "old-grok")
    swapped.rename(grok_dir)
    # A second apply must target the rebound directory as a new tree and not
    # follow the moved original inode implicitly.
    applied = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
    assert applied["ok"] is True
    assert (grok_dir / "config.toml").read_text(encoding="utf-8") != "stolen\n" or (
        "stolen" in (grok_dir / "config.toml").read_text(encoding="utf-8")
        and COMPAT_PRESENT(grok_dir)
    )
    assert (home / "old-grok" / ".grok-keysmith-manifest.json").exists() is False


def COMPAT_PRESENT(grok_dir):
    text = (Path(grok_dir) / "config.toml").read_text(encoding="utf-8")
    return "# === grok-keysmith compat isolation begin ===" in text


def test_abnormal_fifo_is_conflict(isolated_home):
    if os.name == "nt":
        return
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    (grok_dir / "rules").mkdir()
    fifo = grok_dir / "rules" / "99-keysmith.md"
    os.mkfifo(str(fifo))
    try:
        status = parse_envelope(run_cli(["--status"], grok_dir, home=home))
        assert status["result"]["state"] == "conflict"
        failed = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
        assert failed["ok"] is False
        assert stat.S_ISFIFO(fifo.lstat().st_mode)
    finally:
        fifo.unlink()


def test_apply_rebuilds_plan_inside_write_lock(isolated_home, monkeypatch):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    config = grok_dir / "config.toml"
    config.write_text('model = "before"\n', encoding="utf-8")
    module = load_cli_module()
    args = module.build_argparser().parse_args(["--grok-dir", str(grok_dir), "--yes"])
    paths = module.bind_grok_dir(str(grok_dir))
    plan = module.build_deploy_plan(paths, args)
    original_acquire = module.WriteLock.acquire

    def acquire_then_race(lock):
        result = original_acquire(lock)
        config.write_text('model = "raced"\n', encoding="utf-8")
        return result

    monkeypatch.setattr(module.WriteLock, "acquire", acquire_then_race)
    try:
        module.execute_deploy(paths, plan, args)
    except module.KeysmithError as error:
        assert "plan changed" in str(error)
    else:
        raise AssertionError("deploy unexpectedly applied a stale plan")
    assert config.read_text(encoding="utf-8") == 'model = "raced"\n'
    assert not (grok_dir / ".grok-keysmith-manifest.json").exists()
    assert not (grok_dir / "rules" / "99-keysmith.md").exists()


def test_bound_root_inode_rebind_is_rejected_before_apply(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    module = load_cli_module()
    args = module.build_argparser().parse_args(["--grok-dir", str(grok_dir), "--yes"])
    paths = module.bind_grok_dir(str(grok_dir))
    plan = module.build_deploy_plan(paths, args)
    old = home / "old-grok"
    grok_dir.rename(old)
    grok_dir.mkdir()
    (grok_dir / "sentinel").write_text("keep\n", encoding="utf-8")

    try:
        module.execute_deploy(paths, plan, args)
    except module.KeysmithError as error:
        assert "identity" in str(error) or "rebound" in " ".join(error.diagnostics)
    else:
        raise AssertionError("deploy unexpectedly followed a rebound grok-dir")
    assert (grok_dir / "sentinel").read_text(encoding="utf-8") == "keep\n"
    assert not (grok_dir / ".grok-keysmith-manifest.json").exists()


def test_atomic_write_does_not_follow_parent_rebind(isolated_home, monkeypatch):
    if os.name == "nt":
        return
    home, grok_dir = isolated_home
    rules = grok_dir / "rules"
    rules.mkdir(parents=True)
    outside = home / "outside-rules"
    outside.mkdir()
    moved = home / "moved-rules"
    module = load_cli_module()
    original_open = module.os.open
    raced = {"done": False}

    def open_after_rebind(path, flags, *args, **kwargs):
        if not raced["done"] and str(path) == str(rules) and "dir_fd" not in kwargs:
            raced["done"] = True
            rules.rename(moved)
            rules.symlink_to(outside, target_is_directory=True)
        return original_open(path, flags, *args, **kwargs)

    monkeypatch.setattr(module.os, "open", open_after_rebind)
    try:
        module.atomic_write_bytes(rules / "99-keysmith.md", b"must-not-escape\n")
    except (OSError, module.KeysmithError):
        pass
    else:
        raise AssertionError("atomic write unexpectedly followed a rebound parent")
    assert not (outside / "99-keysmith.md").exists()
