from __future__ import annotations

import io
import json
import os
import stat
import subprocess
import sys
import threading
import time
from pathlib import Path

from grok_keysmith_runner import STREAM_EVENT_PREFIX, run_stream
from tests.conftest import CLI, FAKE_GROK, cli_env, parse_envelope, run_cli


def _fake_bin(home):
    if os.name == "nt":
        dest = Path(home) / "fake-grok.cmd"
        dest.write_text(
            '@echo off\r\n"%s" "%s" %%*\r\n' % (sys.executable, FAKE_GROK),
            encoding="utf-8",
        )
        return dest
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


def test_runner_rejects_zero_timeout(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    completed = parse_envelope(
        run_cli(
            ["run", "--grok-bin", fake, "--prompt", "x", "--timeout", "0"],
            grok_dir,
            home=home,
        )
    )
    assert completed["ok"] is False
    assert any("timeout must be > 0" in item for item in completed["diagnostics"])


def test_runner_rejects_nonfinite_timeout_before_launch(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    marker = Path(home) / "fake-grok-invoked"
    fake = _fake_bin(home)
    for value in ("nan", "inf", "-inf"):
        completed = parse_envelope(
            run_cli(
                ["run", "--grok-bin", fake, "--prompt", "x", "--timeout=%s" % value],
                grok_dir,
                home=home,
                extra_env={"FAKE_GROK_MARKER": str(marker)},
            )
        )
        assert completed["ok"] is False
        assert any("finite" in item for item in completed["diagnostics"])
    assert not marker.exists()


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


def test_run_stream_caps_invalid_utf8_by_raw_bytes():
    command = [
        sys.executable,
        "-c",
        "import sys; sys.stdout.buffer.write(b'a' * 40); sys.stderr.buffer.write(b'\\xff' * 40)",
    ]
    result = run_stream(command, timeout=5, max_output_bytes=16)
    assert result["captured_bytes"] == {"stdout": 16, "stderr": 16}
    assert result["truncated"] == {"stdout": True, "stderr": True}
    assert result["stdout"] == "a" * 16
    assert result["stderr"] == "\ufffd" * 16


def test_runner_fails_closed_and_preserves_save_target_on_truncation(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    saved = Path(home) / "saved.txt"
    saved.write_text("keep-me", encoding="utf-8")
    completed = parse_envelope(
        run_cli(
            [
                "run",
                "--grok-bin",
                fake,
                "--prompt",
                "truncate fixture",
                "--timeout",
                "5",
                "--max-output-bytes",
                "8",
                "--save-output",
                saved,
            ],
            grok_dir,
            home=home,
        )
    )
    assert completed["ok"] is False
    assert completed["exit_code"] == 1
    assert any("incomplete" in item for item in completed["diagnostics"])
    assert "saved_output" not in completed["result"]
    assert saved.read_text(encoding="utf-8") == "keep-me"


def test_run_stream_emits_prefixed_output_events_before_exit(monkeypatch):
    monkeypatch.setenv("GROK_KEYSMITH_STREAM_EVENTS", "1")
    sink = io.StringIO()
    monkeypatch.setattr(sys, "stderr", sink)
    result_holder = {}

    def run():
        result_holder["result"] = run_stream(
            [
                sys.executable,
                "-c",
                "import time; print('live-output', flush=True); time.sleep(1.2)",
            ],
            timeout=5,
            max_output_bytes=1024,
        )

    thread = threading.Thread(target=run)
    thread.start()
    deadline = time.time() + 0.8
    while time.time() < deadline and "live-output" not in sink.getvalue():
        time.sleep(0.02)
    assert thread.is_alive()
    assert "live-output" in sink.getvalue()
    thread.join(timeout=4)
    assert not thread.is_alive()
    result = result_holder["result"]
    assert result["stdout"] == "live-output\n"
    lines = [line for line in sink.getvalue().splitlines() if line]
    assert lines and all(line.startswith(STREAM_EVENT_PREFIX) for line in lines)
    payloads = [json.loads(line[len(STREAM_EVENT_PREFIX):]) for line in lines]
    assert any(item["type"] == "output" and "live-output" in item["text"] for item in payloads)


def test_runner_cooperative_cancel_cleans_prompt_temp(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    cancel_file = Path(home) / "cancel.marker"
    before = set(Path(os.environ.get("TMPDIR", "/tmp")).glob("grok-keysmith-prompt-*"))
    command = [
        sys.executable,
        "-B",
        str(CLI),
        "--json",
        "--lang",
        "en",
        "--grok-dir",
        str(grok_dir),
        "run",
        "--grok-bin",
        str(fake),
        "--prompt",
        "cancel fixture",
        "--timeout",
        "30",
    ]
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=cli_env(
            home,
            {
                "FAKE_GROK_MODE": "timeout",
                "FAKE_GROK_SLEEP": "30",
                "GROK_KEYSMITH_CANCEL_FILE": str(cancel_file),
            },
        ),
    )
    timer = threading.Timer(0.3, lambda: cancel_file.write_text("cancel\n", encoding="utf-8"))
    timer.start()
    try:
        stdout, stderr = process.communicate(timeout=8)
    finally:
        timer.cancel()
    assert stderr == ""
    assert process.returncode == 130
    envelope = json.loads(stdout)
    assert envelope["ok"] is False
    assert envelope["exit_code"] == 130
    assert envelope["result"]["cancelled"] is True
    assert set(Path(os.environ.get("TMPDIR", "/tmp")).glob("grok-keysmith-prompt-*")) == before
