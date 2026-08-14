from __future__ import annotations

import json
import stat
from pathlib import Path

from tests.conftest import FAKE_GROK, parse_envelope, run_cli


def _fake_bin(home):
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
                "1",
            ],
            grok_dir,
            home=home,
        )
    )
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
