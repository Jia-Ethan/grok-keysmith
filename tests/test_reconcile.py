from __future__ import annotations

import json
import sys

from tests.conftest import COMPAT_BEGIN, COMPAT_END, parse_envelope, run_cli


OFFICIAL_CODEX = "[compat.codex]\nsessions = false"


def _load_toml(text):
    if sys.version_info < (3, 11):
        return None
    import tomllib

    return tomllib.loads(text)


def _strip_markers(text):
    return (
        text.replace(COMPAT_BEGIN + "\n", "")
        .replace(COMPAT_BEGIN, "")
        .replace(COMPAT_END + "\n", "")
        .replace(COMPAT_END, "")
    )


def _strip_marker_lines(text):
    return "".join(
        line
        for line in text.splitlines(keepends=True)
        if line.strip() not in {COMPAT_BEGIN, COMPAT_END}
    )


def _strip_last_marker_lines(text):
    lines = text.splitlines(keepends=True)
    for marker in (COMPAT_BEGIN, COMPAT_END):
        for index in range(len(lines) - 1, -1, -1):
            if lines[index].strip() == marker:
                del lines[index]
                break
    return "".join(lines)


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


def test_marker_text_inside_string_is_not_owned_or_removed(isolated_home):
    home, grok_dir = isolated_home
    literal = 'banner = "prefix %s suffix"\n' % COMPAT_BEGIN
    _deploy(home, grok_dir, extra=literal)
    config = grok_dir / "config.toml"
    managed = config.read_text(encoding="utf-8")
    config.write_text(_strip_marker_lines(managed), encoding="utf-8")

    status = _status(home, grok_dir)
    assert status["result"]["compat"]["present"] is False
    assert status["result"]["compat"]["repairable"] is True
    reconciled = parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))
    assert reconciled["ok"] is True
    repaired = config.read_text(encoding="utf-8")
    assert literal.strip() in repaired
    parsed = _load_toml(repaired)
    if parsed is not None:
        assert parsed["banner"] == "prefix %s suffix" % COMPAT_BEGIN


def test_marker_and_compat_text_inside_multiline_strings_are_not_structural(
    isolated_home,
):
    home, grok_dir = isolated_home
    original = (
        'basic = """\n'
        + COMPAT_BEGIN
        + "\n[compat.claude]\nskills = false\n"
        + COMPAT_END
        + "\n\"\"\"\n"
        + "literal = '''\n"
        + COMPAT_BEGIN
        + "\n[compat.codex]\nsessions = false\n"
        + COMPAT_END
        + "\n'''\n"
    )
    _deploy(home, grok_dir, extra=original)
    config = grok_dir / "config.toml"
    managed = config.read_text(encoding="utf-8")
    config.write_text(_strip_last_marker_lines(managed), encoding="utf-8")

    status = _status(home, grok_dir)
    assert status["result"]["compat"]["present"] is False
    assert status["result"]["compat"]["values_aligned"] is True
    assert status["result"]["compat"]["repairable"] is True
    assert parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))["ok"] is True
    repaired = config.read_text(encoding="utf-8")
    parsed = _load_toml(repaired)
    expected = _load_toml(original)
    if parsed is not None:
        assert parsed["basic"] == expected["basic"]
        assert parsed["literal"] == expected["literal"]
    assert repaired.count(COMPAT_BEGIN) == 3
    assert repaired.count(COMPAT_END) == 3


def test_multiline_compat_lookalikes_alone_do_not_make_drift_repairable(isolated_home):
    home, grok_dir = isolated_home
    original = (
        'payload = """\n'
        + COMPAT_BEGIN
        + "\n[compat.claude]\nskills = false\nrules = false\nagents = false\n"
        + "mcps = false\nhooks = false\nsessions = false\n"
        + "[compat.cursor]\nskills = false\nrules = false\nagents = false\n"
        + "mcps = false\nhooks = false\nsessions = false\n"
        + "[compat.codex]\nsessions = false\n"
        + COMPAT_END
        + "\n\"\"\"\n"
    )
    _deploy(home, grok_dir, extra=original)
    config = grok_dir / "config.toml"
    managed = config.read_text(encoding="utf-8")
    real_block = managed.rfind("\n" + COMPAT_BEGIN + "\n")
    assert real_block >= 0
    rewritten = managed[: real_block + 1]
    config.write_text(rewritten, encoding="utf-8")

    status = _status(home, grok_dir)
    assert status["result"]["compat"]["present"] is False
    assert status["result"]["compat"]["values_aligned"] is False
    assert status["result"]["compat"]["repairable"] is False
    assert parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))["ok"] is False
    assert config.read_text(encoding="utf-8") == rewritten


def test_commented_compat_headers_reconcile_without_duplicates(isolated_home):
    home, grok_dir = isolated_home
    _deploy(home, grok_dir, extra='[ui] # user settings\ntheme = "minimal"\n')
    config = grok_dir / "config.toml"
    formatter_output = _strip_markers(config.read_text(encoding="utf-8"))
    formatter_output = formatter_output.replace("[compat.claude]", "[compat.claude] # formatter")
    formatter_output = formatter_output.replace("[compat.cursor]", "[compat.cursor] # formatter")
    formatter_output = formatter_output.replace("[compat.codex]", "[compat.codex] # formatter")
    config.write_text(formatter_output, encoding="utf-8")

    status = _status(home, grok_dir)
    assert status["result"]["compat"]["values_aligned"] is True
    assert status["result"]["compat"]["repairable"] is True
    assert parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))["ok"] is True
    repaired = config.read_text(encoding="utf-8")
    parsed = _load_toml(repaired)
    assert repaired.count("[compat.claude]") == 1
    assert repaired.count("[compat.cursor]") == 1
    assert repaired.count("[compat.codex]") == 1
    if parsed is not None:
        assert parsed["ui"] == {"theme": "minimal"}


def test_single_marker_and_non_compat_around_block_survive_reconcile(isolated_home):
    home, grok_dir = isolated_home
    original = '[before]\nvalue = "kept-before"\n\n[after]\nvalue = "kept-after"\n'
    _deploy(home, grok_dir, extra=original)
    config = grok_dir / "config.toml"
    managed = config.read_text(encoding="utf-8")
    block_start = managed.index(COMPAT_BEGIN)
    block_end = managed.index(COMPAT_END) + len(COMPAT_END)
    block = managed[block_start:block_end]
    # Formatter leaves one orphan begin before user settings, followed by the real block.
    rewritten = (
        COMPAT_BEGIN
        + "\n"
        + original
        + "\n"
        + block
        + "\n"
    )
    config.write_text(rewritten, encoding="utf-8")

    status = _status(home, grok_dir)
    assert status["result"]["compat"]["values_aligned"] is True
    assert status["result"]["compat"]["repairable"] is True
    assert parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))["ok"] is True
    repaired = config.read_text(encoding="utf-8")
    assert repaired.count(COMPAT_BEGIN) == 1
    assert repaired.count(COMPAT_END) == 1
    parsed = _load_toml(repaired)
    if parsed is not None:
        assert parsed["before"] == {"value": "kept-before"}
        assert parsed["after"] == {"value": "kept-after"}


def test_mispaired_markers_do_not_claim_non_compat_settings(isolated_home):
    home, grok_dir = isolated_home
    _deploy(home, grok_dir, extra='[original]\nvalue = "deploy-time"\n')
    config = grok_dir / "config.toml"
    managed = config.read_text(encoding="utf-8")
    block_start = managed.index(COMPAT_BEGIN)
    block_end = managed.index(COMPAT_END) + len(COMPAT_END)
    compat_without_markers = _strip_marker_lines(managed[block_start:block_end])
    rewritten = (
        COMPAT_BEGIN
        + '\n[ui]\ntheme = "must-survive"\n'
        + COMPAT_END
        + "\n"
        + compat_without_markers
    )
    config.write_text(rewritten, encoding="utf-8")

    status = _status(home, grok_dir)
    assert status["result"]["compat"]["values_aligned"] is True
    assert status["result"]["compat"]["repairable"] is True
    assert parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))["ok"] is True
    repaired = config.read_text(encoding="utf-8")
    assert repaired.count(COMPAT_BEGIN) == 1
    assert repaired.count(COMPAT_END) == 1
    assert '[ui]\ntheme = "must-survive"' in repaired
    parsed = _load_toml(repaired)
    if parsed is not None:
        assert parsed["ui"] == {"theme": "must-survive"}


def test_reconcile_preserves_original_config_backup_for_uninstall(isolated_home):
    home, grok_dir = isolated_home
    original = '[user]\nsetting = "original"\n'
    _deploy(home, grok_dir, extra=original)
    config = grok_dir / "config.toml"
    manifest_path = grok_dir / ".grok-keysmith-manifest.json"
    original_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    original_backup = original_manifest["layer"]["config"]["backup"]
    config.write_text(_strip_markers(config.read_text(encoding="utf-8")), encoding="utf-8")

    assert parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))["ok"] is True
    reconciled_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert reconciled_manifest["layer"]["config"]["backup"] == original_backup
    assert parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))["ok"] is True
    assert config.read_text(encoding="utf-8") == original


def test_non_compat_added_after_deploy_survives_reconcile_but_not_uninstall(isolated_home):
    home, grok_dir = isolated_home
    original = '[before]\nvalue = "original"\n'
    _deploy(home, grok_dir, extra=original)
    config = grok_dir / "config.toml"
    rewritten = _strip_markers(config.read_text(encoding="utf-8"))
    rewritten += '\n[after]\nvalue = "added-after-deploy"\n'
    config.write_text(rewritten, encoding="utf-8")

    assert parse_envelope(run_cli(["--reconcile", "--yes"], grok_dir, home=home))["ok"] is True
    repaired = config.read_text(encoding="utf-8")
    assert '[after]\nvalue = "added-after-deploy"' in repaired
    parsed = _load_toml(repaired)
    if parsed is not None:
        assert parsed["after"] == {"value": "added-after-deploy"}
    assert parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir, home=home))["ok"] is True
    # The existing ownership contract restores the deploy-time backup exactly.
    assert config.read_text(encoding="utf-8") == original
