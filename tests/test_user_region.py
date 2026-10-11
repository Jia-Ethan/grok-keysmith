# The person's own config.toml region next to Keysmith Switch's (issue #34): both kept,
# neither counted, compat tables never hidden in it, and its text never echoed.
from __future__ import annotations

from tests.conftest import COMPAT_BEGIN, parse_envelope, run_cli

SWITCH_BEGIN = "# === keysmith-switch input rewrite begin ==="
SWITCH_END = "# === keysmith-switch input rewrite end ==="
USER_BEGIN = "# === keysmith user region begin ==="
USER_END = "# === keysmith user region end ==="
SECRET = "sk-secret-do-not-echo"
USER_REGION = (
    f'{USER_BEGIN}\n[model."grok-4.7-api"]\nmodel = "gw-4.7"\n'
    f'base_url = "https://gw.example/v1"\napi_key = "{SECRET}"\n{USER_END}\n'
)
SWITCH_REGION = (
    f'{SWITCH_BEGIN}\n[model."grok-4.6"]\nbase_url = "http://127.0.0.1:4000/t/tok/grok/xai"\n'
    f"{SWITCH_END}\n"
)
USER = '[ui]\npermission_mode = "ask"\n'


def _config(grok_dir):
    return (grok_dir / "config.toml").read_bytes().decode("utf-8")


def _write(grok_dir, text):
    grok_dir.mkdir(parents=True, exist_ok=True)
    (grok_dir / "config.toml").write_bytes(text.encode("utf-8"))


def _deploy(grok_dir, tmp_path, ok=True):
    prompt = tmp_path / "p.md"
    prompt.write_bytes(b"# Test\nhello\n")
    completed = run_cli(["--file", prompt, "--name", "test", "--yes"], grok_dir)
    done = parse_envelope(completed)
    assert done["ok"] is ok, done
    return completed, done


def _status(grok_dir):
    completed = run_cli(["--status"], grok_dir)
    return completed, parse_envelope(completed)


def test_both_regions_survive_the_lifecycle_in_order(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER)
    _deploy(grok_dir, tmp_path)
    # User region first, Switch's last, as Switch re-appends its own on every link.
    _write(grok_dir, _config(grok_dir) + USER_REGION + SWITCH_REGION)
    _completed, status = _status(grok_dir)
    assert status["result"]["state"] == "active-aligned", status
    _deploy(grok_dir, tmp_path)
    assert _config(grok_dir).count(USER_BEGIN) == 1
    for _ in range(2):
        done = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir))
        assert done["ok"], done
    assert _config(grok_dir) == USER + USER_REGION + SWITCH_REGION


def test_status_reports_size_but_never_the_text(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER)
    _deploy(grok_dir, tmp_path)
    _write(grok_dir, _config(grok_dir) + USER_REGION)
    completed, status = _status(grok_dir)
    region = status["result"]["config_regions"]["user"]
    assert region == {"present": True, "bytes": len(USER_REGION.encode()), "ignored": None}
    assert status["result"]["config_regions"]["keysmith-switch"]["present"] is False
    human = run_cli(["--status"], grok_dir, json_mode=False)
    for output in (completed.stdout + completed.stderr, human.stdout + human.stderr):
        assert SECRET not in output
    assert "config region user: present" in human.stdout
    for args in (["--dry-run"], ["--uninstall"], ["--reconcile"]):
        preview = run_cli(args, grok_dir)
        assert SECRET not in preview.stdout + preview.stderr


def test_compat_tables_in_the_region_block_deploy(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    region = f"{USER_BEGIN}\n[compat.claude]\nsessions = true\n{USER_END}\n"
    _write(grok_dir, USER + region)
    completed, done = _deploy(grok_dir, tmp_path, ok=False)
    assert "holds compat tables" in str(done["diagnostics"])
    assert _config(grok_dir) == USER + region


def test_compat_tables_added_to_the_region_after_deploy_are_drift(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER)
    _deploy(grok_dir, tmp_path)
    _write(grok_dir, _config(grok_dir) + f"{USER_BEGIN}\n[compat.codex]\nsessions = true\n{USER_END}\n")
    _completed, status = _status(grok_dir)
    assert status["result"]["state"] == "drift", status
    assert status["result"]["config_regions"]["user"]["ignored"] == "contains compat tables"
    preview = parse_envelope(run_cli(["--reconcile"], grok_dir))
    assert not preview["ok"]


def test_a_region_that_would_move_keys_between_tables_owns_nothing(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER)
    _deploy(grok_dir, tmp_path)
    # Bare keys after the region belong to the region's last table; cutting the region
    # out would hand them to the table before it, so the region is not honoured.
    _write(grok_dir, _config(grok_dir) + USER_REGION + 'stray = "x"\n')
    _completed, status = _status(grok_dir)
    assert status["result"]["config_regions"]["user"]["ignored"] == "keys after the region"
    assert status["result"]["state"] == "drift", status


def test_keys_before_the_first_table_in_the_region_own_nothing(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER)
    _deploy(grok_dir, tmp_path)
    _write(grok_dir, _config(grok_dir) + f'{USER_BEGIN}\nloose = 1\n{USER_END}\n')
    _completed, status = _status(grok_dir)
    assert status["result"]["config_regions"]["user"]["ignored"] == "keys before the first table"
    assert status["result"]["state"] == "drift", status


def test_a_region_in_the_middle_of_the_file_is_kept_at_the_end(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER + USER_REGION + "[models]\ndefault = \"grok-4.6\"\n")
    _deploy(grok_dir, tmp_path)
    _completed, status = _status(grok_dir)
    assert status["result"]["state"] == "active-aligned", status
    assert COMPAT_BEGIN in _config(grok_dir)
    done = parse_envelope(run_cli(["--uninstall", "--yes"], grok_dir))
    assert done["ok"], done
    assert _config(grok_dir) == USER + "[models]\ndefault = \"grok-4.6\"\n" + USER_REGION


def test_duplicate_markers_own_nothing(isolated_home, tmp_path):
    home, grok_dir = isolated_home
    _write(grok_dir, USER)
    _deploy(grok_dir, tmp_path)
    _write(grok_dir, _config(grok_dir) + USER_REGION + USER_REGION)
    _completed, status = _status(grok_dir)
    assert status["result"]["config_regions"]["user"]["ignored"] == "duplicate markers"
    assert status["result"]["state"] == "drift", status
