#!/usr/bin/env bash
set -euo pipefail
base_url="${WORKBUDDY_SETUP_BASE_URL:-https://www.workbuddy999.top}"
tmp="${TMPDIR:-/tmp}/workbuddy-setup-$$.sh"
trap 'rm -f "$tmp"' EXIT
curl -fsSL "$base_url/setup/workbuddy-setup.sh" -o "$tmp"
bash "$tmp" "$@"
