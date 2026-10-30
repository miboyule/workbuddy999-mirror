#!/usr/bin/env bash
set -Eeuo pipefail

REPO="${WORKBUDDY_REPO:-miboyule/workbuddy999-mirror}"
REF="${WORKBUDDY_REF:-main}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/workbuddy999.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

command -v git >/dev/null 2>&1 || { echo '缺少 git，请先安装 git' >&2; exit 1; }
git clone --depth 1 --branch "$REF" "https://github.com/${REPO}.git" "$TMP_DIR/source"
exec "$TMP_DIR/source/install.sh" "$@"
