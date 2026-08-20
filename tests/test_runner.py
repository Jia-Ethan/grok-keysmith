from __future__ import annotations

import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import pytest

from grok_keysmith_runner import (
    STREAM_EVENT_PREFIX,
    FIXTURE_WRAP_MARK,
    RunnerError,
    build_command,
    find_grok_on_path,
    run_stream,
    validate_command,
    wrap_prompt,
)
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
    before = set(Path(tempfile.gettempdir()).glob("grok-keysmith-prompt-*"))
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
    if os.name == "nt":
        assert override["ok"] is False
        assert any("native grok.exe" in item for item in override["diagnostics"])
        assert set(Path(tempfile.gettempdir()).glob("grok-keysmith-prompt-*")) == before
    else:
        assert override["ok"] is True
        assert "override=yes" in override["result"]["stdout"]


def test_build_command_preserves_full_override_contract(tmp_path):
    contract = tmp_path / "contract.md"
    contract.write_text("header\n%s\n" % ("x" * 9000), encoding="utf-8")
    command = build_command(
        "grok",
        "override",
        str(contract),
        "prompt.txt",
        None,
        None,
        None,
        "plain",
    )
    index = command.index("--system-prompt-override")
    assert command[index + 1] == contract.read_text(encoding="utf-8")


def test_windows_batch_override_requires_native_executable(tmp_path):
    contract = tmp_path / "contract.md"
    contract.write_text("literal %PATH% & echo unchanged\n", encoding="utf-8")
    command = build_command(
        "grok.exe",
        "override",
        str(contract),
        "prompt.txt",
        None,
        None,
        None,
        "plain",
    )
    command[0] = "grok.cmd"
    with pytest.raises(RunnerError, match="native grok.exe"):
        validate_command(command, platform_name="nt")


def test_windows_batch_default_mode_remains_supported():
    validate_command(
        ["grok.cmd", "--prompt-file", "prompt.txt", "--output-format", "plain"],
        platform_name="nt",
    )


def test_windows_path_prefers_native_executable(monkeypatch):
    calls = []

    def fake_which(name):
        calls.append(name)
        return "C:/Grok/grok.exe" if name == "grok.exe" else "C:/Grok/grok.cmd"

    monkeypatch.setattr("grok_keysmith_runner.shutil.which", fake_which)
    assert find_grok_on_path(platform_name="nt") == "C:/Grok/grok.exe"
    assert calls == ["grok.exe"]


def test_windows_path_falls_back_to_batch_launcher(monkeypatch):
    calls = []

    def fake_which(name):
        calls.append(name)
        return None if name == "grok.exe" else "C:/Grok/grok.cmd"

    monkeypatch.setattr("grok_keysmith_runner.shutil.which", fake_which)
    assert find_grok_on_path(platform_name="nt") == "C:/Grok/grok.cmd"
    assert calls == ["grok.exe", "grok"]


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
    assert Path(completed["target"]["contract"]) == renamed.resolve()
    # Windows environment names are case-insensitive, so this alias is canonical there.
    if os.name == "nt":
        assert not any("deprecated" in item for item in completed["diagnostics"])
    else:
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
    assert result["stdout"] == "live-output" + os.linesep
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


def test_wrap_prompt_prefixes_once():
    raw = "The server is not mine."
    wrapped = wrap_prompt(raw, "fixture")
    assert wrapped.startswith(FIXTURE_WRAP_MARK)
    assert wrapped.endswith(raw)
    assert wrap_prompt(wrapped, "fixture") == wrapped
    assert wrap_prompt(raw, "none") == raw
    with pytest.raises(RunnerError, match="unknown wrap"):
        wrap_prompt(raw, "jailbreak")


def test_runner_wrap_fixture_changes_user_prompt(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    plain = parse_envelope(
        run_cli(
            ["run", "--grok-bin", fake, "--prompt", "hello fixture", "--timeout", "5"],
            grok_dir,
            home=home,
        )
    )
    wrapped = parse_envelope(
        run_cli(
            [
                "run",
                "--wrap",
                "fixture",
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
    assert plain["ok"] is True
    assert wrapped["ok"] is True
    plain_chars = int(plain["result"]["stdout"].split("prompt_chars=")[1].split()[0])
    wrap_chars = int(wrapped["result"]["stdout"].split("prompt_chars=")[1].split()[0])
    assert wrap_chars > plain_chars
