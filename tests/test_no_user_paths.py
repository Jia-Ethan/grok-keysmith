from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".git", "node_modules", "target", "dist", "work", "__pycache__"}


def test_no_hardcoded_user_home_in_product_sources():
    hits = []
    for path in ROOT.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix not in {".py", ".js", ".jsx", ".rs", ".sh", ".ps1", ".md"}:
            continue
        if path.name == "test_no_user_paths.py":
            continue
        if path.name.endswith(".md") and path.parent.name in {"breaktest"}:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if "/Users/ethan" in text:
            hits.append(str(path.relative_to(ROOT)))
    assert hits == []
