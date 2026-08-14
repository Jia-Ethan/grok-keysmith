#!/bin/bash
# grok-unrestricted.sh — keysmith wrapper for grok -p
#
# Usage:
#   ./grok-unrestricted.sh "your prompt"                 # default mode: contract via rules
#   ./grok-unrestricted.sh --override "your prompt"      # override mode: contract as system prompt
#   ./grok-unrestricted.sh --contract-path FILE "your prompt"
#
# Default mode relies on ~/.grok/rules/99-keysmith.md being deployed
# (grok-keysmith.py --yes). Override mode replaces the system prompt
# entirely, which is useful when the provider's default system prompt
# changes behavior (e.g. API-key sessions using the "autonomous agent"
# template).
#
# Notes:
# - Uses account (OIDC) login when available. API-key sessions get a
#   different system prompt template and stricter refusal behavior;
#   run `grok login --oauth` to return to account login.
set -euo pipefail

GROK_BIN="${GROK_BIN:-$HOME/.grok/bin/grok}"
CONTRACT="${GROK_KEYSMIth_CONTRACT:-$HOME/.grok/rules/99-keysmith.md}"
OUTPUT_FORMAT="${GROK_OUTPUT_FORMAT:-plain}"

MODE="default"
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

if [[ ! -f "$CONTRACT" ]]; then
    echo "contract not found: $CONTRACT (run grok-keysmith.py --yes first)" >&2
    exit 2
fi

if [[ "$MODE" == "override" ]]; then
    exec "$GROK_BIN" -p "$PROMPT" \
        --system-prompt "$(cat "$CONTRACT")" \
        --output-format "$OUTPUT_FORMAT" --no-alt-screen
else
    exec "$GROK_BIN" -p "$PROMPT" \
        --output-format "$OUTPUT_FORMAT" --no-alt-screen
fi
