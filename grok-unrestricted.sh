#!/bin/bash
# grok-unrestricted.sh — wrapper around grok-keysmith.py run
#
# Usage:
#   ./grok-unrestricted.sh "your prompt"
#   ./grok-unrestricted.sh --override "your prompt"
#   ./grok-unrestricted.sh --contract-path FILE "your prompt"
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PYTHON="${PYTHON:-python3}"

MODE="default"
CONTRACT=""
PROMPT=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --override) MODE="override"; shift ;;
        --contract-path) CONTRACT="$2"; shift 2 ;;
        --) shift; PROMPT="$*"; break ;;
        *) PROMPT="$1"; shift ;;
    esac
done

if [[ -z "$PROMPT" ]]; then
    echo "usage: $0 [--override] [--contract-path FILE] <prompt>" >&2
    exit 2
fi

args=( "$ROOT/grok-keysmith.py" run --mode "$MODE" --prompt "$PROMPT" )
if [[ -n "$CONTRACT" ]]; then
    args+=( --contract-path "$CONTRACT" )
fi
exec "$PYTHON" "${args[@]}"
