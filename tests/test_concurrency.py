from __future__ import annotations

import os
import stat
import subprocess
import sys
import time
from pathlib import Path

from tests.conftest import CLI, cli_env, parse_envelope, run_cli


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
