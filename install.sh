#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="/opt/workbuddy-prod"
REPO="${WORKBUDDY_REPO:-miboyule/workbuddy999-mirror}"
RELEASE="${WORKBUDDY_RELEASE:-gateway-20261030}"
DB_BACKUP="${WORKBUDDY_DB_BACKUP:-}"
PORTAL_DOMAIN="${WORKBUDDY_PORTAL_DOMAIN:-www.workbuddy999.top}"
API_DOMAIN="${WORKBUDDY_API_DOMAIN:-api.workbuddy999.top}"
ADMIN_DOMAIN="${WORKBUDDY_ADMIN_DOMAIN:-yeradminer.workbuddy999.top}"
while (($#)); do
  case "$1" in
    --dir) ROOT="$2"; shift 2 ;;
    --db-backup) DB_BACKUP="$2"; shift 2 ;;
    --release) RELEASE="$2"; shift 2 ;;
    --help|-h) printf '用法：sudo ./install.sh [--dir PATH] [--db-backup PATH] [--release TAG]\n'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
die() { printf '安装失败：%s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "缺少命令 $1"; }
for command in docker curl openssl tar; do need "$command"; done
docker compose version >/dev/null 2>&1 || die 'Docker Compose 插件不可用'
SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[[ -f "$SOURCE_DIR/package.json" ]] || die '请从仓库目录运行 install.sh'
[[ $EUID -eq 0 ]] || die '请使用 sudo ./install.sh 运行'
mkdir -p "$ROOT"
if [[ "$SOURCE_DIR" != "$ROOT" ]]; then
  tar --exclude=.git --exclude=backups --exclude=artifacts --exclude=deploy/releases --exclude=node_modules --exclude=dist --exclude=deploy/new-api-credit -cf - -C "$SOURCE_DIR" . | tar -xf - -C "$ROOT"
fi
cd "$ROOT"
cp -f deploy/prod/docker-compose.yml docker-compose.yml
cp -f deploy/prod/Dockerfile.bff Dockerfile.bff
cp -f deploy/prod/nginx.conf nginx.conf
cp -f deploy/Dockerfile.credit Dockerfile.credit
if [[ ! -f .env ]]; then
  umask 077
  rand_hex() { openssl rand -hex "$1"; }
  rand_b64() { openssl rand -base64 "$1" | tr -d '\n' | tr '/+' '_-'; }
  cat > .env <<EOF
WB_DB_PASSWORD=$(rand_hex 24)
WB_REDIS_PASSWORD=$(rand_hex 24)
WB_SESSION_SECRET=$(rand_b64 48)
PORTAL_SECRET=$(rand_hex 32)
NEW_API_ADMIN_USERNAME=${NEW_API_ADMIN_USERNAME:-wbadmin}
NEW_API_ADMIN_PASSWORD=${NEW_API_ADMIN_PASSWORD:-$(rand_b64 18)}
WB_PORTAL_DOMAIN=${PORTAL_DOMAIN}
WB_API_DOMAIN=${API_DOMAIN}
WB_ADMIN_DOMAIN=${ADMIN_DOMAIN}
WB_NEW_API_IMAGE=workbuddy-newapi:credit-20261027
EOF
  chmod 600 .env
fi
if [[ ! -x new-api-credit ]]; then
  asset="new-api-credit-linux-amd64"
  if [[ -n "${SUDO_USER:-}" && -d "/home/${SUDO_USER}/.config/gh" ]]; then
    export GH_CONFIG_DIR="/home/${SUDO_USER}/.config/gh"
  fi
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    gh release download "$RELEASE" --repo "$REPO" --pattern "$asset" --clobber --output new-api-credit
  elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
    api="https://api.github.com/repos/${REPO}/releases/tags/${RELEASE}"
    url=$(curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" -H 'Accept: application/vnd.github+json' "$api" | sed -n "s/.*\"browser_download_url\": \"\([^\"]*${asset}\)\".*/\1/p" | head -n1)
    [[ -n "$url" ]] || die "release ${RELEASE} 中找不到 ${asset}"
    curl -fL -H "Authorization: Bearer ${GITHUB_TOKEN}" -o new-api-credit "$url"
  else
    curl -fL --retry 3 -o new-api-credit "https://github.com/${REPO}/releases/download/${RELEASE}/${asset}"
  fi
  chmod 755 new-api-credit
fi
if [[ ! -d node_modules ]]; then npm ci; fi
npm run build
docker compose --env-file .env config --quiet
docker compose --env-file .env up -d wb-postgres wb-redis
ready=0
for _ in $(seq 1 60); do
  if docker exec wb-postgres pg_isready -U wbuser -d new-api >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ $ready == 1 ]] || die 'PostgreSQL 启动超时'
if [[ -n "$DB_BACKUP" ]]; then
  [[ -f "$DB_BACKUP" ]] || die "数据库备份不存在：$DB_BACKUP"
  tables=$(docker exec wb-postgres psql -U wbuser -d new-api -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  [[ "$tables" == 0 ]] || die '数据库已有表，拒绝覆盖'
  docker cp "$DB_BACKUP" wb-postgres:/tmp/workbuddy.dump
  docker exec wb-postgres pg_restore -U wbuser -d new-api --no-owner --no-privileges --exit-on-error /tmp/workbuddy.dump
fi
docker compose --env-file .env up -d --build wb-new-api wb-bff wb-web
for url in http://127.0.0.1:8088/healthz http://127.0.0.1:8787/healthz; do
  ok=0
  for _ in $(seq 1 45); do curl -fsS "$url" >/dev/null 2>&1 && ok=1 && break || sleep 1; done
  [[ $ok == 1 ]] || die "健康检查失败：$url"
done
printf '\n安装完成\n前台: https://%s\n模型 API: https://%s/v1\n管理后台: https://%s\n目录: %s\n' "$PORTAL_DOMAIN" "$API_DOMAIN" "$ADMIN_DOMAIN" "$ROOT"
printf '后续更新：cd %s && git pull && sudo ./install.sh --dir %s\n' "$ROOT" "$ROOT"

