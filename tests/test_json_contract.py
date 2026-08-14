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


def test_status_run_is_rejected_before_runner_dispatch(isolated_home):
    home, grok_dir = isolated_home
    completed = run_cli(["--status", "run", "--prompt", "must-not-run"], grok_dir, home=home)
    envelope = parse_envelope(completed)
    assert envelope["operation"] == "run"
    assert envelope["ok"] is False
    assert completed.returncode != 0
    assert not grok_dir.exists()


def test_dry_run_breaktest_is_rejected_before_harness_dispatch(isolated_home):
    home, grok_dir = isolated_home
    output_dir = home / "breaktest-output"
    completed = run_cli(
        ["--dry-run", "breaktest", "--output-dir", output_dir], grok_dir, home=home
    )
    envelope = parse_envelope(completed)
    assert envelope["operation"] == "breaktest"
    assert envelope["ok"] is False
    assert completed.returncode != 0
    assert not output_dir.exists()
    assert not grok_dir.exists()


def test_argparse_failures_still_return_json_envelopes(isolated_home):
    home, grok_dir = isolated_home
    unknown = parse_envelope(run_cli(["--unknown-option"], grok_dir, home=home))
    assert unknown["ok"] is False
    assert unknown["operation"] == "deploy"
    assert unknown["exit_code"] == 2

    invalid_type = parse_envelope(
        run_cli(["run", "--timeout", "not-a-number"], grok_dir, home=home)
    )
    assert invalid_type["ok"] is False
    assert invalid_type["operation"] == "run"
    assert invalid_type["exit_code"] == 2

    option_value = parse_envelope(run_cli(["--lang", "run"], grok_dir, home=home))
    assert option_value["ok"] is False
    assert option_value["operation"] == "deploy"
    assert option_value["exit_code"] == 2


def test_invalid_target_keeps_requested_operation_in_envelope(isolated_home):
    home, _grok_dir = isolated_home
    completed = run_cli(["--recover", "--yes"], "relative-grok", home=home)
    envelope = parse_envelope(completed)
    assert envelope["ok"] is False
    assert envelope["operation"] == "recover"


def test_confirmed_preview_token_blocks_state_changes(isolated_home):
    home, grok_dir = isolated_home
    grok_dir.mkdir()
    config = grok_dir / "config.toml"
    config.write_text('model = "before"\n', encoding="utf-8")
    preview = parse_envelope(run_cli(["--dry-run"], grok_dir, home=home))
    token = preview["plan"]["confirmation_token"]
    config.write_text('model = "changed"\n', encoding="utf-8")

    failed = parse_envelope(
        run_cli(
            ["--yes", "--expected-preview-token", token],
            grok_dir,
            home=home,
        )
    )
    assert failed["ok"] is False
    assert any("preview" in item.lower() for item in failed["diagnostics"])
    assert config.read_text(encoding="utf-8") == 'model = "changed"\n'
    assert not (grok_dir / ".grok-keysmith-manifest.json").exists()

    fresh = parse_envelope(run_cli(["--dry-run"], grok_dir, home=home))
    applied = parse_envelope(
        run_cli(
            [
                "--yes",
                "--expected-preview-token",
                fresh["plan"]["confirmation_token"],
            ],
            grok_dir,
            home=home,
        )
    )
    assert applied["ok"] is True
