from __future__ import annotations

from tests.conftest import parse_envelope, run_cli


REQUIRED_ENVELOPE = {
    "schema",
    "tool",
    "version",
    "operation",
    "preview",
    "apply",
    "ok",
    "target",
    "plan",
    "result",
    "diagnostics",
    "exit_code",
}


def test_status_json_envelope_on_missing_dir(isolated_home):
    home, grok_dir = isolated_home
    completed = run_cli(["--status"], grok_dir, home=home)
    envelope = parse_envelope(completed)
    assert REQUIRED_ENVELOPE.issubset(envelope)
    assert envelope["tool"] == "grok-keysmith"
    assert envelope["operation"] == "status"
    assert envelope["preview"] is True
    assert envelope["apply"] is False
    assert envelope["ok"] is True
    assert envelope["target"]["grok_dir"] == str(grok_dir)
    assert envelope["result"]["state"] == "not-installed"
    assert envelope["exit_code"] == completed.returncode


def test_relative_grok_dir_rejected(isolated_home):
    home, _grok_dir = isolated_home
    completed = run_cli(["--status"], "relative-grok", home=home)
    envelope = parse_envelope(completed)
    assert envelope["ok"] is False
    assert envelope["exit_code"] != 0
    assert any("absolute" in item.lower() for item in envelope["diagnostics"])


def test_dry_run_yes_is_rejected_and_writes_nothing(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    before = list(grok_dir.rglob("*"))
    completed = run_cli(["--dry-run", "--yes"], grok_dir, home=home)
    envelope = parse_envelope(completed)
    assert envelope["ok"] is False
    assert envelope["preview"] is False
    assert envelope["apply"] is False
    assert envelope["exit_code"] != 0
    assert list(grok_dir.rglob("*")) == before
    assert not (grok_dir / "rules").exists()
    assert not (grok_dir / ".grok-keysmith-manifest.json").exists()
