# Isolated-home helpers for grok-keysmith lifecycle tests.
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "grok-keysmith.py"
RUNNER = ROOT / "grok_keysmith_runner.py"
BREAKTEST = ROOT / "grok_keysmith_breaktest.py"
FAKE_GROK = Path(__file__).resolve().parent / "fixtures" / "fake_grok.py"
ENVELOPE_SCHEMA = "grok-keysmith.envelope.v1"
HARD_EXIT = 86

COMPAT_BEGIN = "# === grok-keysmith compat isolation begin ==="
COMPAT_END = "# === grok-keysmith compat isolation end ==="


@pytest.fixture
def isolated_home(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    grok_dir = home / ".grok"
    return home, grok_dir


def cli_env(home, extra=None):
    env = os.environ.copy()
    env["HOME"] = str(home)
    env["PYTHONUTF8"] = "1"
    env["PYTHONNOUSERSITE"] = "1"
    env.pop("GROK_KEYSMITH_FAULT_INJECT", None)
    env.pop("GROK_KEYSMITH_CONTRACT", None)
    env.pop("GROK_KEYSMIth_CONTRACT", None)
    if extra:
        env.update(extra)
    return env


def run_cli(args, grok_dir, home=None, extra_env=None, json_mode=True):
    home = Path(home) if home is not None else Path(grok_dir).parent
    cmd = [sys.executable, "-B", str(CLI)]
    if json_mode:
        cmd.append("--json")
    cmd.extend(["--lang", "en", "--grok-dir", str(grok_dir)])
    cmd.extend(str(item) for item in args)
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=cli_env(home, extra_env),
    )


def parse_envelope(completed):
    text = completed.stdout.strip()
    assert text, "expected JSON envelope on stdout, got empty output; stderr=%r" % (
        completed.stderr,
    )
    data = json.loads(text)
    assert data.get("schema") == ENVELOPE_SCHEMA
    return data


def snapshot_tree(root):
    entries = {}
    root = Path(root)
    if not root.exists():
        return entries
    for path in sorted(root.rglob("*")):
        rel = str(path.relative_to(root))
        if path.is_symlink():
            entries[rel] = ("symlink", os.readlink(str(path)))
        elif path.is_dir():
            entries[rel] = ("dir", None)
        elif path.is_file():
            entries[rel] = ("file", path.read_bytes())
    return entries


def write_hook(grok_dir, name, payload=None):
    hooks = Path(grok_dir) / "hooks"
    hooks.mkdir(parents=True, exist_ok=True)
    path = hooks / name
    path.write_text(payload or '{"event":"%s"}\n' % name, encoding="utf-8")
    return path
