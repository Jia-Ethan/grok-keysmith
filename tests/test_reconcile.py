from __future__ import annotations

from tests.conftest import COMPAT_BEGIN, COMPAT_END, parse_envelope, run_cli


OFFICIAL_CODEX = "[compat.codex]\nsessions = false"


def _strip_markers(text):
    return (
        text.replace(COMPAT_BEGIN + "\n", "")
        .replace(COMPAT_BEGIN, "")
        .replace(COMPAT_END + "\n", "")
        .replace(COMPAT_END, "")
    )


def _deploy(home, grok_dir, extra=None):
    if extra:
        grok_dir.mkdir(parents=True, exist_ok=True)
        (grok_dir / "config.toml").write_text(extra, encoding="utf-8")
    applied = parse_envelope(run_cli(["--yes"], grok_dir, home=home))
    assert applied["ok"] is True
    return applied


def _status(home, grok_dir):
    return parse_envelope(run_cli(["--status"], grok_dir, home=home))


def test_issue5_marker_loss_is_repairable_and_reconcile_unblocks_uninstall(isolated_home):
    home, grok_dir = isolated_home
    _deploy(home, grok_dir, extra='model = "grok-4.6"\n')
    config = grok_dir / "config.toml"
    rewritten = 'model = "grok-4.6"\n\n' + _strip_markers(config.read_text(encoding="utf-8")).lstrip()
    config.write_text(rewritten, encoding="utf-8")

    status = _status(home, grok_dir)
    assert status["result"]["state"] == "drift"
    assert status["result"]["compat"]["present"] is False
    assert status["result"]["compat"]["matches_expected"] is False
    assert status["result"]["compat"]["values_aligned"] is True
    assert status["result"]["compat"]["repairable"] is True
    assert status["result"]["drift"] == [
        "config fingerprint drifted; compat values aligned"
    ]

    assert parse_envelope(run_cli(["--yes"], grok_dir, home=home))["ok"] is False
    assert parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))["ok"] is False
    assert config.read_text(encoding="utf-8") == rewritten

    preview = parse_envelope(run_cli(["--reconcile"], grok_dir, home=home))
    assert preview["ok"] is True
    assert preview["operation"] == "reconcile"
    assert preview["preview"] is True
    assert preview["plan"]["will_change"] is True
    assert preview["plan"]["values_aligned"] is True
    assert preview["plan"]["repairable"] is True
    assert COMPAT_BEGIN not in config.read_text(encoding="utf-8")

    applied = parse_envelope(
        run_cli(
            [
                "--reconcile",
                "--yes",
                "--expected-preview-token",
                preview["plan"]["confirmation_token"],
            ],
            grok_dir,
            home=home,
        )
    )
    assert applied["ok"] is True
    assert applied["result"]["changed"] is True
    restored = config.read_text(encoding="utf-8")
    assert COMPAT_BEGIN in restored
    assert COMPAT_END in restored
    assert 'model = "grok-4.6"' in restored
    ready = _status(home, grok_dir)
    assert ready["result"]["state"] == "active-aligned"
    assert ready["result"]["compat"]["present"] is True
    assert ready["result"]["compat"]["matches_expected"] is True
    assert ready["result"]["compat"]["values_aligned"] is True
    assert ready["result"]["compat"]["repairable"] is False

    uninstalled = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))
    assert uninstalled["ok"] is True
    leftover = config.read_text(encoding="utf-8")
    assert leftover == 'model = "grok-4.6"\n'
    assert COMPAT_BEGIN not in leftover


def test_compat_value_change_is_not_repairable(isolated_home):
    home, grok_dir = isolated_home
    _deploy(home, grok_dir)
    config = grok_dir / "config.toml"
    before = config.read_text(encoding="utf-8")
    config.write_text(
        before.replace(OFFICIAL_CODEX, "[compat.codex]\nsessions = true"),
        encoding="utf-8",
    )
    status = _status(home, grok_dir)
    assert status["result"]["compat"]["values_aligned"] is False
    assert status["result"]["compat"]["repairable"] is False
    failed = parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert config.read_text(encoding="utf-8") != before
    assert "sessions = true" in config.read_text(encoding="utf-8")


def test_extra_compat_key_is_not_repairable(isolated_home):
    home, grok_dir = isolated_home
    _deploy(home, grok_dir)
    config = grok_dir / "config.toml"
    before = config.read_text(encoding="utf-8")
    config.write_text(
        before.replace(OFFICIAL_CODEX, OFFICIAL_CODEX + "\nextra = false"),
        encoding="utf-8",
    )
    status = _status(home, grok_dir)
    assert status["result"]["compat"]["repairable"] is False
    assert parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))["ok"] is False
    assert config.read_text(encoding="utf-8") != before


def test_missing_or_duplicate_or_unparseable_compat_is_not_repairable(isolated_home):
    home, grok_dir = isolated_home
    _deploy(home, grok_dir)
    config = grok_dir / "config.toml"
    original = config.read_text(encoding="utf-8")

    config.write_text(original.replace(OFFICIAL_CODEX, ""), encoding="utf-8")
    assert _status(home, grok_dir)["result"]["compat"]["repairable"] is False
    assert parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))["ok"] is False

    config.write_text(original + "\n" + OFFICIAL_CODEX + "\n", encoding="utf-8")
    assert _status(home, grok_dir)["result"]["compat"]["repairable"] is False
    assert parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))["ok"] is False

    config.write_text(
        original.replace(OFFICIAL_CODEX, '[compat.codex]\nsessions = "nope"'),
        encoding="utf-8",
    )
    assert _status(home, grok_dir)["result"]["compat"]["repairable"] is False
    assert parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))["ok"] is False
    assert '"nope"' in config.read_text(encoding="utf-8")


def test_fingerprint_only_drift_with_markers_is_repairable(isolated_home):
    home, grok_dir = isolated_home
    _deploy(home, grok_dir)
    config = grok_dir / "config.toml"
    # Trailing keys stay in the last [compat.*] table (TOML). Put extras in their own table.
    config.write_text(
        config.read_text(encoding="utf-8") + "\n[ui]\ntheme = \"minimal\"\n",
        encoding="utf-8",
    )
    status = _status(home, grok_dir)
    assert status["result"]["state"] == "drift"
    assert status["result"]["compat"]["present"] is True
    assert status["result"]["compat"]["values_aligned"] is True
    assert status["result"]["compat"]["repairable"] is True
    assert parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))["ok"] is False
    applied = parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))
    assert applied["ok"] is True
    ready = _status(home, grok_dir)
    assert ready["result"]["state"] == "active-aligned"
    assert "[ui]" in config.read_text(encoding="utf-8")
    assert 'theme = "minimal"' in config.read_text(encoding="utf-8")


def test_rule_drift_blocks_reconcile_even_when_compat_values_align(isolated_home):
    home, grok_dir = isolated_home
    _deploy(home, grok_dir)
    config = grok_dir / "config.toml"
    config.write_text(_strip_markers(config.read_text(encoding="utf-8")), encoding="utf-8")
    (grok_dir / "rules" / "99-keysmith.md").write_text("user edited this rule\n", encoding="utf-8")
    status = _status(home, grok_dir)
    assert status["result"]["state"] == "drift"
    assert status["result"]["compat"]["values_aligned"] is True
    assert status["result"]["compat"]["repairable"] is False
    failed = parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert COMPAT_BEGIN not in config.read_text(encoding="utf-8")


def test_journal_residue_blocks_reconcile(isolated_home):
    home, grok_dir = isolated_home
    _deploy(home, grok_dir)
    config = grok_dir / "config.toml"
    before = _strip_markers(config.read_text(encoding="utf-8"))
    config.write_text(before, encoding="utf-8")
    (grok_dir / (".grok-keysmith-transaction-" + ("ab" * 16))).mkdir()
    status = _status(home, grok_dir)
    assert status["result"]["state"] == "recovery-required"
    assert status["result"]["compat"]["repairable"] is False
    failed = parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))
    assert failed["ok"] is False
    assert config.read_text(encoding="utf-8") == before


def test_stale_reconcile_preview_token_writes_nothing(isolated_home):
    home, grok_dir = isolated_home
    _deploy(home, grok_dir)
    config = grok_dir / "config.toml"
    config.write_text(_strip_markers(config.read_text(encoding="utf-8")), encoding="utf-8")
    preview = parse_envelope(run_cli(["--reconcile"], grok_dir, home=home))
    token = preview["plan"]["confirmation_token"]
    mutated = config.read_text(encoding="utf-8") + "\nuser = true\n"
    config.write_text(mutated, encoding="utf-8")
    failed = parse_envelope(
        run_cli(
            ["--reconcile", "--yes", "--expected-preview-token", token],
            grok_dir,
            home=home,
        )
    )
    assert failed["ok"] is False
    assert config.read_text(encoding="utf-8") == mutated


def test_reconcile_is_idempotent_when_already_aligned(isolated_home):
    home, grok_dir = isolated_home
    _deploy(home, grok_dir)
    config = grok_dir / "config.toml"
    before = config.read_text(encoding="utf-8")
    preview = parse_envelope(run_cli(["--reconcile"], grok_dir, home=home))
    assert preview["ok"] is True
    assert preview["plan"]["will_change"] is False
    applied = parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))
    assert applied["ok"] is True
    assert applied["result"]["changed"] is False
    assert config.read_text(encoding="utf-8") == before
    assert _status(home, grok_dir)["result"]["state"] == "active-aligned"


def test_plain_config_replacement_is_not_repairable(isolated_home):
    home, grok_dir = isolated_home
    _deploy(home, grok_dir)
    config = grok_dir / "config.toml"
    config.write_text('model = "plain"\n', encoding="utf-8")
    status = _status(home, grok_dir)
    assert status["result"]["compat"]["values_aligned"] is False
    assert status["result"]["compat"]["repairable"] is False
    assert parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))["ok"] is False
    assert config.read_text(encoding="utf-8") == 'model = "plain"\n'
