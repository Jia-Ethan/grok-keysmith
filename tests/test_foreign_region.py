# A second managed region in config.toml owned by another tool (Keysmith Switch input
# rewrite). This tool must never treat it as drift, and must keep it through every path
# that rewrites the config: deploy, uninstall, salvage, reconcile and recovery.
from __future__ import annotations

from tests.conftest import COMPAT_BEGIN, HARD_EXIT, parse_envelope, run_cli

BEGIN = "# === keysmith-switch input rewrite begin ==="
END = "# === keysmith-switch input rewrite end ==="
REGION = f'{BEGIN}\n[model."grok-4.6"]\nbase_url = "http://127.0.0.1:4000/t/tok/grok/xai"\n{END}\n'
REGION2 = REGION.replace("4000", "4001")
USER = '[ui]\npermission_mode = "ask"\n'


# Bytes, not text: text mode on Windows would turn every "\n" into "\r\n", which rewrites
# lines outside the region and is (correctly) drift.
def _config(grok_dir):
    return (grok_dir / "config.toml").read_bytes().decode("utf-8")


def _write(grok_dir, text):
    grok_dir.mkdir(parents=True, exist_ok=True)
    (grok_dir / "config.toml").write_bytes(text.encode("utf-8"))


def _deploy(grok_dir, tmp_path):
    prompt = tmp_path / "p.md"
    prompt.write_bytes(b"# Test\nhello\n")
    done = parse_envelope(run_cli(["--file", prompt, "--name", "test", "--yes"], grok_dir))
    assert done["ok"], done


def _add_region(grok_dir, region=REGION):
    text = _config(grok_dir)
    if BEGIN in text:
        start = text.index(BEGIN)
        end = text.index(END) + len(END) + 1
        text = text[:start] + region + text[end:]
    else:
        text = text + region
    _write(grok_dir, text)


def _status(grok_dir):
    status = parse_envelope(run_cli(["--status"], grok_dir))
    assert status["ok"], status
    return status


def test_region_added_after_deploy_is_not_drift_and_survives_uninstall(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER)
    _deploy(grok_dir, tmp_path)
    _add_region(grok_dir)
    status = _status(grok_dir)
    assert "drift" not in str(status.get("blockers") or "")
    done = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir))
    assert done["ok"], done
    assert _config(grok_dir) == USER + REGION


def test_region_present_before_deploy_is_left_as_is(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER + REGION)
    _deploy(grok_dir, tmp_path)
    text = _config(grok_dir)
    assert REGION in text and COMPAT_BEGIN in text
    assert text.count(BEGIN) == 1
    done = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir))
    assert done["ok"], done
    assert _config(grok_dir) == USER + REGION


def test_region_changed_while_deployed_keeps_the_newest(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER + REGION)
    _deploy(grok_dir, tmp_path)
    _add_region(grok_dir, REGION2)
    assert "drift" not in str(_status(grok_dir).get("blockers") or "")
    done = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir))
    assert done["ok"], done
    assert _config(grok_dir) == USER + REGION2


def test_region_removed_while_deployed_stays_removed(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER + REGION)
    _deploy(grok_dir, tmp_path)
    _write(grok_dir, _config(grok_dir).replace(REGION, ""))
    done = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir))
    assert done["ok"], done
    assert BEGIN not in _config(grok_dir)
    assert _config(grok_dir) == USER


def test_redeploy_over_a_region_keeps_it(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER)
    _deploy(grok_dir, tmp_path)
    _add_region(grok_dir)
    _deploy(grok_dir, tmp_path)
    assert _config(grok_dir).count(BEGIN) == 1
    for _ in range(2):
        done = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir))
        assert done["ok"], done
    assert _config(grok_dir) == USER + REGION


def test_user_edits_outside_the_region_are_still_drift(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER)
    _deploy(grok_dir, tmp_path)
    _add_region(grok_dir)
    _write(grok_dir, _config(grok_dir).replace('"ask"', '"never"'))
    preview = parse_envelope(run_cli(["--uninstall"], grok_dir))
    assert not preview["ok"]
    assert "config content does not match managed after-state" in str(preview)


def test_reconcile_keeps_the_region(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER)
    _deploy(grok_dir, tmp_path)
    # Grok's own appended table moves the fingerprint; reconcile re-records it.
    _write(grok_dir, _config(grok_dir) + "\n[marketplace]\ndefault_skills_installs_purged = true\n")
    _add_region(grok_dir)
    preview = parse_envelope(run_cli(["--reconcile"], grok_dir))
    assert preview["ok"], preview
    token = preview["plan"]["confirmation_token"]
    done = parse_envelope(
        run_cli(["--reconcile", "--yes", "--expected-preview-token", token], grok_dir)
    )
    assert done["ok"], done
    assert REGION in _config(grok_dir)
    assert "drift" not in str(_status(grok_dir).get("blockers") or "")


def test_salvage_keeps_the_region(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER)
    _deploy(grok_dir, tmp_path)
    for backup in grok_dir.glob("config.toml.keysmith-backup-*"):
        backup.unlink()
    _write(grok_dir, _config(grok_dir) + '\n[models]\ndefault = "grok-4.6"\n')
    _add_region(grok_dir)
    done = parse_envelope(run_cli(["--uninstall", "--salvage-config", "--yes"], grok_dir))
    assert done["ok"], done
    text = _config(grok_dir)
    assert REGION in text and COMPAT_BEGIN not in text and 'default = "grok-4.6"' in text


def test_interrupted_uninstall_recovers_with_the_region(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER)
    _deploy(grok_dir, tmp_path)
    _add_region(grok_dir)
    deployed = _config(grok_dir)
    crashed = run_cli(
        ["--uninstall", "--yes"],
        grok_dir,
        extra_env={"GROK_KEYSMITH_FAULT_INJECT": "after_uninstall_write_config"},
    )
    assert crashed.returncode == HARD_EXIT
    done = parse_envelope(run_cli(["--recover", "--yes"], grok_dir))
    assert done["ok"], done
    assert _config(grok_dir) == deployed
    assert "drift" not in str(_status(grok_dir).get("blockers") or "")


def test_an_unterminated_region_owns_nothing(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER + BEGIN + '\n[model."x"]\nbase_url = "http://h"\n')
    _deploy(grok_dir, tmp_path)
    _write(grok_dir, _config(grok_dir).replace('base_url = "http://h"', 'base_url = "http://g"'))
    preview = parse_envelope(run_cli(["--uninstall"], grok_dir))
    assert not preview["ok"], "without an end marker the text is the person's, so a change is drift"


def test_crlf_config_keeps_its_line_endings_around_the_region(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER.replace("\n", "\r\n"))
    _deploy(grok_dir, tmp_path)
    _add_region(grok_dir)
    assert "drift" not in str(_status(grok_dir).get("blockers") or "")
    done = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir))
    assert done["ok"], done
    assert _config(grok_dir) == USER.replace("\n", "\r\n") + REGION
