#!/usr/bin/env python3
"""Isolated fake Grok executable. Never calls a real model."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


def _prompt_from_args(argv):
    if "--prompt-file" in argv:
        idx = argv.index("--prompt-file")
        return Path(argv[idx + 1]).read_text(encoding="utf-8")
    if "-p" in argv:
        return argv[argv.index("-p") + 1]
    if "--single" in argv:
        return argv[argv.index("--single") + 1]
    return ""


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    marker = os.environ.get("FAKE_GROK_MARKER")
    if marker:
        Path(marker).write_text("invoked\n", encoding="utf-8")
    mode = os.environ.get("FAKE_GROK_MODE", "success")
    if "--version" in argv or (argv and argv[0] == "version"):
        sys.stdout.write("grok 1.0.3-fake (test)\n")
        return 0
    if argv and argv[0] == "inspect":
        payload = {
            "grokVersion": "1.0.3-fake",
            "channel": "test",
            "projectInstructions": [],
            "externalCompat": {"cells": []},
            "hooks": [],
        }
        extra = os.environ.get("FAKE_GROK_INSPECT_JSON")
        if extra:
            payload.update(json.loads(extra))
        sys.stdout.write(json.dumps(payload) + "\n")
        return 0
    run_marker = os.environ.get("FAKE_GROK_RUN_MARKER")
    if run_marker:
        Path(run_marker).write_text("invoked\n", encoding="utf-8")
    if mode == "timeout":
        time.sleep(float(os.environ.get("FAKE_GROK_SLEEP", "30")))
        return 0
    if mode == "nonzero":
        sys.stderr.write("fake grok failed\n")
        return 3
    if mode == "stream-corrupt":
        sys.stdout.buffer.write(b"partial\xff\xfe stream")
        return 0
    prompt = _prompt_from_args(argv)
    override = "--system-prompt-override" in argv or "--system-prompt" in argv
    if mode == "refuse":
        sys.stdout.write("I can't help with that request.\n")
        return 0
    if mode == "redirect":
        sys.stdout.write("I can't do that. Instead, here is a legitimate alternative.\n")
        return 0
    sys.stdout.write(
        "Scenario RE — acknowledged: TARGET local sample.\n"
        "mode=%s override=%s prompt_chars=%s\n"
        "Contract check: static_recon, check_fn.\n"
        % (mode, "yes" if override else "no", len(prompt))
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
