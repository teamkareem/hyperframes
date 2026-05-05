#!/usr/bin/env bash
set -euo pipefail

payload="$(cat || true)"
cmd="$(printf '%s' "$payload" | python3 -c 'import json,sys
try:
 data=json.load(sys.stdin)
 print((data.get("tool_input") or {}).get("command", ""))
except Exception:
 print("")')"

patterns=(
  '(^|[;&|[:space:]])sudo([[:space:]]|$)'
  '(^|[;&|[:space:]])rm[[:space:]]+-rf[[:space:]]+/'
  '(^|[;&|[:space:]])chmod[[:space:]]+777([[:space:]]|$)'
  '(^|[;&|[:space:]])git[[:space:]]+push[[:space:]][^;&|]*--force'
  '(^|[;&|[:space:]])git[[:space:]]+push[[:space:]][^;&|]*[[:space:]]-f([[:space:]]|$)'
  '(^|[;&|[:space:]])git[[:space:]]+reset[[:space:]]+--hard'
  '(^|[;&|[:space:]])npm[[:space:]]+publish([[:space:]]|$)'
  '(^|[;&|[:space:]])curl[^|]*\|[[:space:]]*(sh|bash)([[:space:]]|$)'
  '(^|[;&|[:space:]])wget[^|]*\|[[:space:]]*(sh|bash)([[:space:]]|$)'
)

for pattern in "${patterns[@]}"; do
  if printf '%s' "$cmd" | grep -Eiq "$pattern"; then
    echo "Blocked dangerous command: $cmd"
    exit 2
  fi
done

exit 0
