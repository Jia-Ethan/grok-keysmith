from __future__ import annotations

import os
import stat
import sys
from pathlib import Path

from tests.conftest import FAKE_GROK, parse_envelope, run_cli


def _fake_bin(home):
    dest = Path(home) / "fake-grok"
    dest.write_text(FAKE_GROK.read_text(encoding="utf-8"), encoding="utf-8")
    dest.chmod(dest.stat().st_mode | stat.S_IEXEC)
    return dest


def test_runner_default_and_override(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    default = parse_envelope(
        run_cli(
            ["run", "--grok-bin", fake, "--prompt", "hello fixture", "--timeout", "5"],
            grok_dir,
            home=home,
        )
    )
    assert default["ok"] is True
    assert "override=no" in default["result"]["stdout"]
    override = parse_envelope(
        run_cli(
            [
                "run",
                "--mode",
                "override",
                "--grok-bin",
                fake,
                "--prompt",
                "hello fixture",
                "--timeout",
                "5",
            ],
            grok_dir,
            home=home,
        )
    )
    assert override["ok"] is True
    assert "override=yes" in override["result"]["stdout"]


def test_runner_timeout_and_nonzero(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    timed = parse_envelope(
        run_cli(
            ["run", "--grok-bin", fake, "--prompt", "x", "--timeout", "0.2"],
            grok_dir,
            home=home,
            extra_env={"FAKE_GROK_MODE": "timeout", "FAKE_GROK_SLEEP": "5"},
        )
    )
    assert timed["ok"] is False
    assert timed["result"]["timed_out"] is True
    failed = parse_envelope(
        run_cli(
            ["run", "--grok-bin", fake, "--prompt", "x", "--timeout", "5"],
            grok_dir,
            home=home,
            extra_env={"FAKE_GROK_MODE": "nonzero"},
        )
    )
    assert failed["ok"] is False
    assert failed["result"]["exit_code"] == 3


def test_runner_stream_corrupt_and_prompt_temp_cleaned(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    before = set(Path(os.environ.get("TMPDIR", "/tmp")).glob("grok-keysmith-prompt-*"))
    completed = parse_envelope(
        run_cli(
            ["run", "--grok-bin", fake, "--prompt", "corrupt", "--timeout", "5"],
            grok_dir,
            home=home,
            extra_env={"FAKE_GROK_MODE": "stream-corrupt"},
        )
    )
    assert "partial" in completed["result"]["stdout"]
    after = set(Path(os.environ.get("TMPDIR", "/tmp")).glob("grok-keysmith-prompt-*"))
    assert after == before


def test_deprecated_contract_env_alias(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    contract = grok_dir / "rules" / "99-keysmith.md"
    renamed = grok_dir / "rules" / "moved.md"
    contract.rename(renamed)
    completed = parse_envelope(
        run_cli(
            ["run", "--grok-bin", fake, "--prompt", "alias", "--timeout", "5"],
            grok_dir,
            home=home,
            extra_env={"GROK_KEYSMIth_CONTRACT": str(renamed)},
        )
    )
    assert completed["ok"] is True
    assert any("deprecated" in item for item in completed["diagnostics"])
