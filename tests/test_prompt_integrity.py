from __future__ import annotations

import ast
import base64
import hashlib
import sys
from pathlib import Path

import grok_keysmith_runner

ROOT = Path(__file__).resolve().parents[1]


def _constants():
    source = (ROOT / "grok-keysmith.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    constants = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(
            node.targets[0], ast.Name
        ):
            name = node.targets[0].id
            if name in {"BUNDLED_PROMPT_B64", "BUNDLED_PROMPT_SHA256", "VERSION"}:
                constants[name] = ast.literal_eval(node.value)
    return constants


def test_python38_syntax_parses():
    source = (ROOT / "grok-keysmith.py").read_text(encoding="utf-8")
    ast.parse(source)
    for extra in ("grok_keysmith_runner.py", "grok_keysmith_breaktest.py"):
        path = ROOT / extra
        ast.parse(path.read_text(encoding="utf-8"))


def test_bundled_prompt_matches_example_and_hash():
    constants = _constants()
    bundled = base64.b64decode(constants["BUNDLED_PROMPT_B64"])
    prompt = (ROOT / "examples" / "grok-unrestricted.md").read_bytes()
    assert bundled == prompt
    digest = hashlib.sha256(prompt).hexdigest()
    assert digest == constants["BUNDLED_PROMPT_SHA256"]
    assert digest == "eb68d56c2c52663ecff5cef971e7374b3b3872d729c0ea41fa6e63be48ab907c"


def test_version_file_matches_python_constant():
    constants = _constants()
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    assert version == constants["VERSION"]
    assert version == "0.5.2"
    pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert 'version = "%s"' % version in pyproject
    for relative_path in (
        "README.md",
        "README.en.md",
        "CHANGELOG.md",
        "SECURITY.md",
    ):
        assert version in (ROOT / relative_path).read_text(encoding="utf-8")


def test_runner_frozen_fallback_matches_cli_version(monkeypatch):
    expected = _constants()["VERSION"]
    monkeypatch.delitem(sys.modules, "grok_keysmith_loader", raising=False)
    monkeypatch.setattr(
        grok_keysmith_runner.Path,
        "read_text",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("frozen bundle")),
    )
    assert grok_keysmith_runner._version() == expected
