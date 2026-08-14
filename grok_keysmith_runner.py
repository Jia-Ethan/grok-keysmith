#!/usr/bin/env python3
"""Cross-platform Grok prompt runner for grok-keysmith."""
from __future__ import annotations

import codecs
import json
import math
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
STREAM_EVENT_PREFIX = "GROK_KEYSMITH_EVENT "
STREAM_EVENT_SCHEMA = "grok-keysmith.stream.v1"
_STREAM_EVENT_LOCK = threading.Lock()


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
    found = find_grok_on_path()
    if found:
        return found
    raise RunnerError("Grok binary not found")


def find_grok_on_path(platform_name=None):
    platform_name = os.name if platform_name is None else platform_name
    names = ("grok.exe", "grok") if platform_name == "nt" else ("grok",)
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    return None


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


def validate_command(command, platform_name=None):
    platform_name = os.name if platform_name is None else platform_name
    if platform_name != "nt" or "--system-prompt-override" not in command:
        return
    suffix = Path(str(command[0])).suffix.lower()
    if suffix not in (".bat", ".cmd"):
        return
    raise RunnerError(
        "Windows override mode requires native grok.exe; .cmd/.bat launchers "
        "can truncate or reinterpret contract content"
    )


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
    validate_command(command)
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


def _cancel_requested(cancel_file=None):
    value = cancel_file or os.environ.get("GROK_KEYSMITH_CANCEL_FILE")
    return bool(value and Path(value).exists())


def emit_stream_event(event_type, **payload):
    if os.environ.get("GROK_KEYSMITH_STREAM_EVENTS") != "1":
        return
    event = {"schema": STREAM_EVENT_SCHEMA, "type": event_type}
    event.update(payload)
    line = STREAM_EVENT_PREFIX + json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"
    with _STREAM_EVENT_LOCK:
        sys.stderr.write(line)
        sys.stderr.flush()


def run_stream(command, timeout, max_output_bytes, cwd=None, event_context=None):
    start = time.time()
    if max_output_bytes < 1:
        raise RunnerError("max output bytes must be >= 1")
    stdout_bytes = bytearray()
    stderr_bytes = bytearray()
    truncated = {"stdout": False, "stderr": False}
    context = dict(event_context or {})
    cancel_file = os.environ.get("GROK_KEYSMITH_CANCEL_FILE")
    if _cancel_requested(cancel_file):
        return {
            "stdout": "",
            "stderr": "",
            "exit_code": 130,
            "timed_out": False,
            "cancelled": True,
            "truncated": truncated,
            "captured_bytes": {"stdout": 0, "stderr": 0},
            "seconds": time.time() - start,
            "pid": None,
        }
    popen_kwargs = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "cwd": cwd or None,
    }
    if os.name == "nt":
        popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        popen_kwargs["start_new_session"] = True
    try:
        proc = subprocess.Popen(command, **popen_kwargs)
    except OSError as error:
        raise RunnerError("unable to execute Grok binary: %s" % error)

    def _reader(stream, bucket, label):
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        read_chunk = getattr(stream, "read1", stream.read)
        while True:
            chunk = read_chunk(4096)
            if not chunk:
                break
            if not isinstance(chunk, bytes):
                chunk = chunk.encode("utf-8", "replace")
            remaining = max_output_bytes - len(bucket)
            if remaining <= 0:
                truncated[label] = True
                continue
            captured = chunk[:remaining]
            bucket.extend(captured)
            if len(chunk) > remaining:
                truncated[label] = True
            text = decoder.decode(captured, final=False)
            if text:
                emit_stream_event("output", channel=label, text=text, **context)
        tail = decoder.decode(b"", final=True)
        if tail:
            emit_stream_event("output", channel=label, text=tail, **context)

    threads = [
        threading.Thread(target=_reader, args=(proc.stdout, stdout_bytes, "stdout")),
        threading.Thread(target=_reader, args=(proc.stderr, stderr_bytes, "stderr")),
    ]
    for thread in threads:
        thread.daemon = True
        thread.start()
    timed_out = False
    cancelled = False
    deadline = start + timeout
    while proc.poll() is None:
        if _cancel_requested(cancel_file):
            cancelled = True
            _kill_tree(proc)
            break
        remaining = deadline - time.time()
        if remaining <= 0:
            timed_out = True
            _kill_tree(proc)
            break
        try:
            proc.wait(timeout=min(0.1, remaining))
        except subprocess.TimeoutExpired:
            continue
    if proc.poll() is None:
        try:
            proc.wait(timeout=5)
        except Exception:
            pass
    for thread in threads:
        thread.join(timeout=2)
    exit_code = 130 if cancelled else (proc.returncode if proc.returncode is not None else -1)
    return {
        "stdout": bytes(stdout_bytes).decode("utf-8", "replace"),
        "stderr": bytes(stderr_bytes).decode("utf-8", "replace"),
        "exit_code": exit_code,
        "timed_out": timed_out,
        "cancelled": cancelled,
        "truncated": truncated,
        "captured_bytes": {"stdout": len(stdout_bytes), "stderr": len(stderr_bytes)},
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


def write_text_atomic(path, contents):
    target = Path(path).expanduser()
    parent = target.parent
    if not parent.is_dir():
        raise RunnerError("output directory not found: %s" % parent)
    mode = (target.stat().st_mode & 0o777) if target.is_file() else 0o600
    fd, temporary = tempfile.mkstemp(prefix=".%s." % target.name, suffix=".tmp", dir=str(parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(contents)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, target)
    finally:
        try:
            os.unlink(temporary)
        except OSError:
            pass


def runner_main(args):
    as_json = bool(getattr(args, "json", False))
    diagnostics = []
    tmp_prompt = None
    try:
        timeout_value = getattr(args, "timeout", 180.0)
        timeout = 180.0 if timeout_value is None else float(timeout_value)
        if not math.isfinite(timeout) or timeout <= 0:
            raise RunnerError("timeout must be > 0 and finite")
        max_bytes = int(getattr(args, "max_output_bytes", 2 * 1024 * 1024))
        if max_bytes < 1:
            raise RunnerError("max output bytes must be >= 1")
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
        result = run_stream(command, timeout, max_bytes, cwd=getattr(args, "cwd", None))
        result["grok_version"] = version
        result["command"] = command[:1] + [
            item if item != Path(contract).read_text(encoding="utf-8") else "<system-prompt-override>"
            for item in command[1:]
        ]
        output_truncated = any(result["truncated"].values())
        if output_truncated:
            diagnostics.append("runner output exceeded --max-output-bytes; result is incomplete")
        if getattr(args, "save_output", None):
            if output_truncated:
                diagnostics.append("--save-output was skipped because captured output is incomplete")
            else:
                saved_output = Path(args.save_output).expanduser()
                write_text_atomic(saved_output, result["stdout"])
                result["saved_output"] = str(saved_output)
        ok = (
            (not result["timed_out"])
            and (not result["cancelled"])
            and (not output_truncated)
            and result["exit_code"] == 0
        )
        if result["cancelled"]:
            exit_code = 130
        elif result["timed_out"]:
            exit_code = 124
        else:
            exit_code = result["exit_code"] or (0 if ok else 1)
        return emit(
            "run",
            ok,
            {"grok_bin": binary, "contract": contract},
            {"mode": getattr(args, "mode", "default"), "timeout": timeout},
            result,
            diagnostics,
            exit_code,
            as_json,
            diagnostics,
        )
    except Exception as error:
        if not isinstance(error, RunnerError):
            error = RunnerError("runner failed: %s" % error, exit_code=1)
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
