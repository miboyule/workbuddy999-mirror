#!/usr/bin/env bash
set -euo pipefail
base_url="${WORKBUDDY_SETUP_BASE_URL:-https://www.workbuddy999.top}"
read -r -p 'CodeBuddy 国内版请输入 cn，国际版直接回车: ' region
args=()
if [[ "$region" == cn ]]; then args+=(cn); else args+=(global); fi
tmp="${TMPDIR:-/tmp}/codebuddy-setup-$$.sh"
trap 'rm -f "$tmp"' EXIT
curl -fsSL "$base_url/setup/codebuddy-setup.sh" -o "$tmp"
bash "$tmp" "${args[@]}"
