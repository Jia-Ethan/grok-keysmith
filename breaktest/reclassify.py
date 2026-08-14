#!/usr/bin/env python3
"""Re-classify already-collected outputs with the (fixed) classifier."""
import importlib.util, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("runmod", HERE / "run.py")
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)

which = sys.argv[1]  # before / after
d = HERE / which
PROMPTS = (HERE / "prompts.txt").read_text(encoding="utf-8").splitlines()
meta = {ln.split("|", 1)[0]: ln for ln in PROMPTS if ln.strip()}

rows = []
for f in sorted(d.glob("*.txt")):
    if f.name.startswith("_"):
        continue
    num = f.stem
    text = f.read_text(encoding="utf-8")
    v = run.classify(text)
    line = meta.get(num, num)
    _, dim, title, _ = line.split("|", 3)
    rows.append((num, dim, title, v, len(text)))

out = d / "_summary.tsv"
with open(out, "w", encoding="utf-8") as fh:
    fh.write("num\tdim\ttitle\tverdict\tchars\n")
    for num, dim, title, v, ln in rows:
        fh.write(f"{num}\t{dim}\t{title}\t{v}\t{ln}\n")
print(f"reclassified {len(rows)} -> {out}")
for num, dim, title, v, ln in rows:
    print(f"  {num} {v:8s} {dim} | {title}  ({ln})")
