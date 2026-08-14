#!/usr/bin/env python3
"""Cross-platform Grok prompt runner for grok-keysmith."""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

TOOL_NAME = "grok-keysmith"
ENVELOPE_SCHEMA = "grok-keysmith.envelope.v1"
DEFAULT_CONTRACT_NAME = "rules/99-keysmith.md"
DEPRECATED_CONTRACT_ENV = "GROK_KEYSMIth_CONTRACT"
CONTRACT_ENV = "GROK_KEYSMITH_CONTRACT"
MAX_CONCURRENCY_NOTICE = 4


class RunnerError(Exception):
    def __init__(self, message, exit_code=2, diagnostics=None):
        Exception.__init__(self, message)
        self.exit_code = exit_code
        self.diagnostics = list(diagnostics or [message])


def _version():
    try:
        from grok_keysmith_loader import VERSION
    except Exception:
        VERSION = "0.4.0-dev"
        try:
            text = Path(__file__).with_name("grok-keysmith.py").read_text(encoding="utf-8")
            for line in text.splitlines():
                if line.startswith("VERSION = "):
                    VERSION = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
        except Exception:
            pass
    return VERSION


def which_grok(explicit):
    if explicit:
        path = Path(explicit).expanduser()
        if not path.is_file():
            raise RunnerError("Grok binary not found: %s" % path)
        return str(path)
    env = os.environ.get("GROK_BIN")
    if env and Path(env).is_file():
        return env
    home = Path.home() / ".grok" / "bin" / "grok"
    if os.name == "nt":
        home = Path.home() / ".grok" / "bin" / "grok.exe"
    if home.is_file():
        return str(home)
    found = shutil.which("grok") or shutil.which("grok.exe")
    if found:
        return found
    raise RunnerError("Grok binary not found")


def resolve_contract(explicit, grok_dir=None):
    diagnostics = []
    if explicit:
        path = Path(explicit).expanduser()
        if not path.is_file():
            raise RunnerError("contract not found: %s" % path)
        return str(path.resolve()), diagnostics
    if os.environ.get(CONTRACT_ENV):
        path = Path(os.environ[CONTRACT_ENV]).expanduser()
        if path.is_file():
            return str(path.resolve()), diagnostics
    if os.environ.get(DEPRECATED_CONTRACT_ENV):
        path = Path(os.environ[DEPRECATED_CONTRACT_ENV]).expanduser()
        diagnostics.append(
            "GROK_KEYSMIth_CONTRACT is deprecated; use GROK_KEYSMITH_CONTRACT"
        )
        if path.is_file():
            return str(path.resolve()), diagnostics
    base = Path(grok_dir) if grok_dir else Path.home() / ".grok"
    candidate = base / "rules" / "99-keysmith.md"
    if candidate.is_file():
        return str(candidate.resolve()), diagnostics
    raise RunnerError("contract not found: %s (deploy grok-keysmith first)" % candidate)


def grok_version(binary):
    try:
        completed = subprocess.run(
            [binary, "--version"],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except Exception as error:
        raise RunnerError("unable to execute Grok binary: %s" % error)
    text = (completed.stdout or "").strip() or (completed.stderr or "").strip()
    if completed.returncode != 0:
        raise RunnerError("Grok --version failed: %s" % text)
    return text.splitlines()[0] if text else "unknown"


def build_command(binary, mode, contract, prompt_file, model, effort, cwd, output_format):
    command = [binary, "--prompt-file", prompt_file, "--output-format", output_format or "plain", "--no-alt-screen"]
    if cwd:
        command.extend(["--cwd", cwd])
    if model:
        command.extend(["--model", model])
    if effort:
        command.extend(["--reasoning-effort", effort])
    if mode == "override":
        command.extend(["--system-prompt-override", Path(contract).read_text(encoding="utf-8")])
    return command


def _kill_tree(proc):
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            os.killpg(proc.pid, signal.SIGKILL)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def run_stream(command, timeout, max_output_bytes, cwd=None):
    start = time.time()
    stdout_chunks = []
    stderr_chunks = []
    stdout_size = [0]
    stderr_size = [0]
    truncated = {"stdout": False, "stderr": False}
    popen_kwargs = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "cwd": cwd or None,
    }
    if os.name == "nt":
        popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        popen_kwargs["preexec_fn"] = os.setsid
    proc = subprocess.Popen(command, **popen_kwargs)

    def _reader(stream, bucket, counter, label):
        while True:
            chunk = stream.read(4096)
            if not chunk:
                break
            if isinstance(chunk, bytes):
                try:
                    text = chunk.decode("utf-8")
                except UnicodeDecodeError:
                    text = chunk.decode("utf-8", "replace")
                    if label == "stdout":
                        bucket.append(text)
                        counter[0] += len(text)
                    else:
                        bucket.append(text)
                    continue
            else:
                text = chunk
            if counter[0] >= max_output_bytes:
                truncated[label] = True
                continue
            remain = max_output_bytes - counter[0]
            if len(text) > remain:
                bucket.append(text[:remain])
                counter[0] += remain
                truncated[label] = True
            else:
                bucket.append(text)
                counter[0] += len(text)

    threads = [
        threading.Thread(target=_reader, args=(proc.stdout, stdout_chunks, stdout_size, "stdout")),
        threading.Thread(target=_reader, args=(proc.stderr, stderr_chunks, stderr_size, "stderr")),
    ]
    for thread in threads:
        thread.daemon = True
        thread.start()
    timed_out = False
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        _kill_tree(proc)
        try:
            proc.wait(timeout=5)
        except Exception:
            pass
    for thread in threads:
        thread.join(timeout=2)
    exit_code = proc.returncode if proc.returncode is not None else -1
    return {
        "stdout": "".join(stdout_chunks),
        "stderr": "".join(stderr_chunks),
        "exit_code": exit_code,
        "timed_out": timed_out,
        "truncated": truncated,
        "seconds": time.time() - start,
        "pid": proc.pid,
    }


def emit(operation, ok, target, plan, result, diagnostics, exit_code, as_json, human_lines):
    envelope = {
        "schema": ENVELOPE_SCHEMA,
        "tool": TOOL_NAME,
        "version": _version(),
        "operation": operation,
        "preview": False,
        "apply": True,
        "ok": bool(ok),
        "target": target,
        "plan": plan,
        "result": result,
        "diagnostics": list(diagnostics or []),
        "exit_code": int(exit_code),
    }
    if as_json:
        sys.stdout.write(json.dumps(envelope, indent=2, ensure_ascii=False) + "\n")
    else:
        if result and result.get("stdout") is not None and not as_json:
            sys.stdout.write(result["stdout"])
            if result["stdout"] and not result["stdout"].endswith("\n"):
                sys.stdout.write("\n")
        for line in human_lines or []:
            sys.stderr.write(line + "\n")
    return exit_code


def runner_main(args):
    as_json = bool(getattr(args, "json", False))
    diagnostics = []
    tmp_prompt = None
    try:
        binary = which_grok(getattr(args, "grok_bin", None))
        version = grok_version(binary)
        grok_dir = getattr(args, "grok_dir", None)
        contract, extra = resolve_contract(getattr(args, "contract_path", None), grok_dir=grok_dir)
        diagnostics.extend(extra)
        prompt = getattr(args, "prompt", None)
        prompt_file = getattr(args, "prompt_file", None)
        if prompt_file:
            source = Path(prompt_file)
            if not source.is_file():
                raise RunnerError("prompt file not found: %s" % source)
            prompt_text = source.read_text(encoding="utf-8")
        elif prompt is not None:
            prompt_text = prompt
        else:
            if not sys.stdin.isatty():
                prompt_text = sys.stdin.read()
            else:
                raise RunnerError("provide --prompt or --prompt-file")
        handle = tempfile.NamedTemporaryFile(
            prefix="grok-keysmith-prompt-",
            suffix=".txt",
            delete=False,
            mode="w",
            encoding="utf-8",
        )
        tmp_prompt = handle.name
        handle.write(prompt_text)
        handle.close()
        command = build_command(
            binary,
            getattr(args, "mode", "default") or "default",
            contract,
            tmp_prompt,
            getattr(args, "model", None),
            getattr(args, "reasoning_effort", None),
            getattr(args, "cwd", None),
            getattr(args, "output_format", "plain"),
        )
        timeout = float(getattr(args, "timeout", 180.0) or 180.0)
        max_bytes = int(getattr(args, "max_output_bytes", 2 * 1024 * 1024))
        result = run_stream(command, timeout, max_bytes, cwd=getattr(args, "cwd", None))
        result["grok_version"] = version
        result["command"] = command[:1] + [
            item if item != Path(contract).read_text(encoding="utf-8") else "<system-prompt-override>"
            for item in command[1:]
        ]
        if getattr(args, "save_output", None):
            Path(args.save_output).write_text(result["stdout"], encoding="utf-8")
            result["saved_output"] = str(Path(args.save_output))
        ok = (not result["timed_out"]) and result["exit_code"] == 0
        return emit(
            "run",
            ok,
            {"grok_bin": binary, "contract": contract},
            {"mode": getattr(args, "mode", "default"), "timeout": timeout},
            result,
            diagnostics,
            0 if ok else (124 if result["timed_out"] else (result["exit_code"] or 1)),
            as_json,
            diagnostics,
        )
    except RunnerError as error:
        return emit(
            "run",
            False,
            {},
            None,
            None,
            error.diagnostics,
            error.exit_code,
            as_json,
            error.diagnostics,
        )
    finally:
        if tmp_prompt:
            try:
                os.unlink(tmp_prompt)
            except OSError:
                pass


if __name__ == "__main__":
    sys.stderr.write("use grok-keysmith.py run ...\n")
    sys.exit(2)
