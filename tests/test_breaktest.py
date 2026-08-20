from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import time
from pathlib import Path

import grok_keysmith_breaktest as breaktest
from grok_keysmith_runner import STREAM_EVENT_PREFIX
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


def _bank(home):
    path = Path(home) / "tiny-bank.txt"
    path.write_text(
        "01|fixture|ok|Return a local fixture sample for TARGET.\n"
        "02|fixture|refuse-me|Please refuse this harmless fixture.\n",
        encoding="utf-8",
    )
    return path


def test_breaktest_marks_truncated_case_as_error(tmp_path, monkeypatch):
    contract = tmp_path / "contract.md"
    contract.write_text("fixture", encoding="utf-8")
    monkeypatch.setattr(
        breaktest,
        "run_stream",
        lambda *args, **kwargs: {
            "stdout": "partial",
            "stderr": "",
            "exit_code": 0,
            "timed_out": False,
            "cancelled": False,
            "truncated": {"stdout": True, "stderr": False},
            "captured_bytes": {"stdout": 7, "stderr": 0},
            "seconds": 0.1,
        },
    )
    record = breaktest.one_case(
        {
            "run_dir": str(tmp_path),
            "num": "01",
            "dim": "fixture",
            "title": "truncated",
            "mode": "default",
            "repetition": 1,
            "prompt": "fixture",
        },
        "grok",
        str(contract),
        5,
        None,
        None,
        None,
    )
    assert record["verdict"] == "error"
    assert "byte limit" in record["reason"]


def test_breaktest_ab_writes_run_artifacts(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    bank = _bank(home)
    out = Path(home) / "bt-run"
    completed = parse_envelope(
        run_cli(
            [
                "breaktest",
                "--bank",
                bank,
                "--mode",
                "ab",
                "--output-dir",
                out,
                "--grok-bin",
                fake,
                "--timeout",
                "5",
                "--concurrency",
                "2",
            ],
            grok_dir,
            home=home,
        )
    )
    if os.name == "nt":
        assert completed["ok"] is False
        assert any("native grok.exe" in item for item in completed["diagnostics"])
        assert not out.exists()
        return
    assert completed["ok"] is True
    assert (out / "run-manifest.json").is_file()
    assert (out / "results.ndjson").is_file()
    assert (out / "_summary.tsv").is_file()
    assert (out / "report.md").is_file()
    summary = (out / "_summary.tsv").read_text(encoding="utf-8").splitlines()
    assert summary[0].startswith("num\tdim\ttitle\tmode\trepetition")
    assert len(summary) == 5  # header + 2 prompts * 2 modes
    report = (out / "report.md").read_text(encoding="utf-8")
    assert "heuristic" in report.lower()
    rows = [
        json.loads(line)
        for line in (out / "results.ndjson").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert all(row["heuristic"] is True for row in rows)
    assert all(row["review_status"] == "unreviewed" for row in rows)
    assert all(
        ("override=yes" in row["stdout"]) == (row["mode"] == "override")
        for row in rows
    )


def test_breaktest_timeout_nonzero_refuse_and_resume(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    bank = _bank(home)
    out = Path(home) / "bt-fail"
    refused = parse_envelope(
        run_cli(
            [
                "breaktest",
                "--bank",
                bank,
                "--mode",
                "default",
                "--output-dir",
                out,
                "--grok-bin",
                fake,
                "--timeout",
                "5",
            ],
            grok_dir,
            home=home,
            extra_env={"FAKE_GROK_MODE": "refuse"},
        )
    )
    assert refused["ok"] is True
    rows = [
        json.loads(line)
        for line in (out / "results.ndjson").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert {row["verdict"] for row in rows} == {"refuse"}

    timed = Path(home) / "bt-timeout"
    parse_envelope(
        run_cli(
            [
                "breaktest",
                "--bank",
                bank,
                "--mode",
                "default",
                "--output-dir",
                timed,
                "--grok-bin",
                fake,
                "--timeout",
                "0.2",
            ],
            grok_dir,
            home=home,
            extra_env={"FAKE_GROK_MODE": "timeout", "FAKE_GROK_SLEEP": "3"},
        )
    )
    trows = [
        json.loads(line)
        for line in (timed / "results.ndjson").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert any(row["verdict"] == "timeout" or row["timed_out"] for row in trows)

    resumed = parse_envelope(
        run_cli(
            [
                "breaktest",
                "--bank",
                bank,
                "--mode",
                "default",
                "--output-dir",
                out,
                "--grok-bin",
                fake,
                "--timeout",
                "5",
                "--resume",
            ],
            grok_dir,
            home=home,
        )
    )
    assert resumed["ok"] is True
    again = [
        json.loads(line)
        for line in (out / "results.ndjson").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(again) == 2


def test_breaktest_rejects_unbounded_concurrency(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    bank = _bank(home)
    completed = parse_envelope(
        run_cli(
            [
                "breaktest",
                "--bank",
                bank,
                "--output-dir",
                Path(home) / "bt-cap",
                "--grok-bin",
                fake,
                "--concurrency",
                "99",
            ],
            grok_dir,
            home=home,
        )
    )
    assert completed["ok"] is False
    assert any("cap" in item.lower() or "concurrency" in item.lower() for item in completed["diagnostics"])


def test_breaktest_rejects_zero_numeric_limits(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    bank = _bank(home)
    cases = [
        ("--repetitions", "repetitions must be >= 1"),
        ("--concurrency", "concurrency must be >= 1"),
        ("--timeout", "timeout must be > 0"),
    ]
    for index, (option, diagnostic) in enumerate(cases):
        completed = parse_envelope(
            run_cli(
                [
                    "breaktest",
                    "--bank",
                    bank,
                    "--output-dir",
                    Path(home) / ("bt-zero-%s" % index),
                    "--grok-bin",
                    fake,
                    option,
                    "0",
                ],
                grok_dir,
                home=home,
            )
        )
        assert completed["ok"] is False
        assert any(diagnostic in item for item in completed["diagnostics"])


def test_breaktest_rejects_nonfinite_numeric_limits(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    bank = _bank(home)
    for index, (option, value) in enumerate(
        (("--timeout", "nan"), ("--timeout", "inf"), ("--interval", "nan"), ("--interval", "inf"))
    ):
        output_dir = Path(home) / ("bt-nonfinite-%s" % index)
        completed = parse_envelope(
            run_cli(
                [
                    "breaktest",
                    "--bank",
                    bank,
                    "--output-dir",
                    output_dir,
                    "--grok-bin",
                    fake,
                    option,
                    value,
                ],
                grok_dir,
                home=home,
            )
        )
        assert completed["ok"] is False
        assert any("finite" in item for item in completed["diagnostics"])
        assert not output_dir.exists()


def test_breaktest_rejects_unsafe_and_duplicate_prompt_ids(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    for name, text, expected in [
        ("unsafe.txt", "../../TARGET|fixture|bad|prompt\n", "invalid prompt id"),
        ("duplicate.txt", "01|fixture|one|prompt\n01|fixture|two|prompt\n", "duplicate prompt id"),
        (
            "case-duplicate.txt",
            "Case|fixture|one|prompt\ncase|fixture|two|prompt\n",
            "duplicate prompt id",
        ),
    ]:
        bank = Path(home) / name
        bank.write_text(text, encoding="utf-8")
        output = Path(home) / (name + ".out")
        envelope = parse_envelope(
            run_cli(
                ["breaktest", "--bank", bank, "--output-dir", output, "--grok-bin", fake],
                grok_dir,
                home=home,
            )
        )
        assert envelope["ok"] is False
        assert expected in " ".join(envelope["diagnostics"])
        assert not output.exists()


def test_breaktest_resume_repairs_only_unterminated_tail(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    bank = _bank(home)
    out = Path(home) / "bt-repair"
    first = parse_envelope(
        run_cli(
            ["breaktest", "--bank", bank, "--output-dir", out, "--grok-bin", fake],
            grok_dir,
            home=home,
        )
    )
    assert first["ok"] is True
    ndjson = out / "results.ndjson"
    with ndjson.open("ab") as handle:
        handle.write(b'{"num":')
    repaired = parse_envelope(
        run_cli(
            [
                "breaktest",
                "--bank",
                bank,
                "--output-dir",
                out,
                "--grok-bin",
                fake,
                "--resume",
            ],
            grok_dir,
            home=home,
        )
    )
    assert repaired["ok"] is True
    assert any("truncated" in item for item in repaired["diagnostics"])
    assert len([json.loads(line) for line in ndjson.read_text(encoding="utf-8").splitlines()]) == 2

    with ndjson.open("a", encoding="utf-8") as handle:
        handle.write("not-json\n")
    rejected = parse_envelope(
        run_cli(
            [
                "breaktest",
                "--bank",
                bank,
                "--output-dir",
                out,
                "--grok-bin",
                fake,
                "--resume",
            ],
            grok_dir,
            home=home,
        )
    )
    assert rejected["ok"] is False
    assert any("invalid results.ndjson" in item for item in rejected["diagnostics"])


def test_breaktest_resume_rejects_identity_drift_and_existing_artifacts(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    bank = _bank(home)
    out = Path(home) / "bt-identity"
    first = parse_envelope(
        run_cli(
            ["breaktest", "--bank", bank, "--output-dir", out, "--grok-bin", fake],
            grok_dir,
            home=home,
        )
    )
    assert first["ok"] is True
    duplicate = parse_envelope(
        run_cli(
            ["breaktest", "--bank", bank, "--output-dir", out, "--grok-bin", fake],
            grok_dir,
            home=home,
        )
    )
    assert duplicate["ok"] is False
    assert any("already contains" in item for item in duplicate["diagnostics"])

    bank.write_text(bank.read_text(encoding="utf-8") + "03|fixture|new|new prompt\n", encoding="utf-8")
    drifted = parse_envelope(
        run_cli(
            [
                "breaktest",
                "--bank",
                bank,
                "--output-dir",
                out,
                "--grok-bin",
                fake,
                "--resume",
            ],
            grok_dir,
            home=home,
        )
    )
    assert drifted["ok"] is False
    assert any("identity mismatch" in item for item in drifted["diagnostics"])


def test_breaktest_wrap_changes_identity_and_prompt(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    bank = _bank(home)
    out = Path(home) / "bt-wrap"
    first = parse_envelope(
        run_cli(
            ["breaktest", "--bank", bank, "--output-dir", out, "--grok-bin", fake],
            grok_dir,
            home=home,
        )
    )
    assert first["ok"] is True
    manifest = json.loads((out / "run-manifest.json").read_text(encoding="utf-8"))
    assert manifest["identity"]["wrap"] == "none"
    drifted = parse_envelope(
        run_cli(
            [
                "breaktest",
                "--bank",
                bank,
                "--output-dir",
                out,
                "--grok-bin",
                fake,
                "--wrap",
                "fixture",
                "--resume",
            ],
            grok_dir,
            home=home,
        )
    )
    assert drifted["ok"] is False
    assert any("identity mismatch" in item for item in drifted["diagnostics"])
    wrapped_dir = Path(home) / "bt-wrap-on"
    wrapped = parse_envelope(
        run_cli(
            [
                "breaktest",
                "--bank",
                bank,
                "--output-dir",
                wrapped_dir,
                "--grok-bin",
                fake,
                "--wrap",
                "fixture",
            ],
            grok_dir,
            home=home,
        )
    )
    assert wrapped["ok"] is True
    wrap_manifest = json.loads((wrapped_dir / "run-manifest.json").read_text(encoding="utf-8"))
    assert wrap_manifest["identity"]["wrap"] == "fixture"
    row = json.loads((wrapped_dir / "results.ndjson").read_text(encoding="utf-8").splitlines()[0])
    wrap_chars = int(row["stdout"].split("prompt_chars=")[1].split()[0])
    assert wrap_chars > len("Return a local fixture sample for TARGET.")


def test_breaktest_lock_and_cooperative_cancel(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    bank = _bank(home)
    out = Path(home) / "bt-locked"
    cancel_file = Path(home) / "cancel.marker"
    run_marker = Path(home) / "fake-grok-run"
    base = [
        sys.executable,
        "-B",
        str(CLI),
        "--json",
        "--lang",
        "en",
        "--grok-dir",
        str(grok_dir),
        "breaktest",
        "--bank",
        str(bank),
        "--output-dir",
        str(out),
        "--grok-bin",
        str(fake),
        "--timeout",
        "30",
    ]
    env = cli_env(
        home,
        {
            "FAKE_GROK_MODE": "timeout",
            "FAKE_GROK_SLEEP": "30",
            "FAKE_GROK_RUN_MARKER": str(run_marker),
            "GROK_KEYSMITH_CANCEL_FILE": str(cancel_file),
        },
    )
    first = subprocess.Popen(base, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    deadline = time.time() + 8
    while time.time() < deadline and not run_marker.is_file():
        time.sleep(0.05)
    assert (out / "run-manifest.json").is_file()
    assert run_marker.is_file()

    second = subprocess.run(base + ["--resume"], capture_output=True, text=True, env=env, timeout=8)
    second_envelope = json.loads(second.stdout)
    assert second_envelope["ok"] is False
    assert any("already in use" in item for item in second_envelope["diagnostics"])

    cancel_file.write_text("cancel\n", encoding="utf-8")
    stdout, stderr = first.communicate(timeout=8)
    assert stderr == ""
    assert first.returncode == 130
    cancelled = json.loads(stdout)
    assert cancelled["result"]["cancelled"] is True
    assert cancelled["result"]["completed"] == 1
    assert (out / "run-manifest.json").is_file()
    assert (out / "results.ndjson").is_file()
    cancel_file.unlink()
    resumed = parse_envelope(
        run_cli(
            [
                "breaktest",
                "--bank",
                bank,
                "--output-dir",
                out,
                "--grok-bin",
                fake,
                "--resume",
            ],
            grok_dir,
            home=home,
        )
    )
    assert resumed["ok"] is True
    assert resumed["result"]["completed"] == 2
    rows = [json.loads(line) for line in (out / "results.ndjson").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 2
    assert all(not row["cancelled"] for row in rows)


def test_breaktest_stream_event_contract(isolated_home):
    home, grok_dir = isolated_home
    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is True
    fake = _fake_bin(home)
    bank = Path(home) / "one-bank.txt"
    bank.write_text("01|fixture|title|prompt\n", encoding="utf-8")
    completed = run_cli(
        [
            "breaktest",
            "--bank",
            bank,
            "--output-dir",
            Path(home) / "bt-events",
            "--grok-bin",
            fake,
        ],
        grok_dir,
        home=home,
        extra_env={"GROK_KEYSMITH_STREAM_EVENTS": "1"},
    )
    assert parse_envelope(completed)["ok"] is True
    events = [
        json.loads(line[len(STREAM_EVENT_PREFIX):])
        for line in completed.stderr.splitlines()
        if line.startswith(STREAM_EVENT_PREFIX)
    ]
    assert [event["type"] for event in events if event["type"] != "output"] == [
        "case-start",
        "case-complete",
        "summary",
    ]
    start = next(event for event in events if event["type"] == "case-start")
    assert (start["num"], start["dim"], start["title"]) == ("01", "fixture", "title")
    summary = next(event for event in events if event["type"] == "summary")
    assert summary["total"] == summary["completed"] == 1
    assert summary["failed"] == 0
