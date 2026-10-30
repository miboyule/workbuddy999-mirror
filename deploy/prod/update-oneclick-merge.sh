#!/bin/sh
# Incremental release only. Existing environment, gateway and database volumes stay in place.
set -eu
umask 077
release="$1"
archive="$2"
expected="$3"
case "$release" in merge-20[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]) ;; *) exit 2 ;; esac
cd /opt/workbuddy-prod
printf '%s  %s\n' "$expected" "$archive" | sha256sum -c -
backup="/opt/workbuddy-prod/backups/$release"
mkdir -p "$backup"
docker exec wb-postgres pg_dump -U wbuser -d new-api -Fc > "$backup/database.dump"
test -s "$backup/database.dump"
cp -p .env "$backup/environment.before"
tar -czf "$backup/files-before.tgz" oneclick server.mjs server shared scripts src public/setup dist
image=$(docker inspect wb-bff --format '{{.Image}}')
previous="workbuddy-prod-wb-bff:before-$release"
docker image tag "$image" "$previous"
printf '%s\n' "$image" > "$backup/image-before.txt"
cat > "$backup/rollback.sh" <<EOF
#!/bin/sh
set -eu
cd /opt/workbuddy-prod
tar -xzf '$backup/files-before.tgz'
docker image tag '$previous' workbuddy-prod-wb-bff:latest
docker compose up -d --no-deps --no-build --force-recreate wb-bff
docker compose exec -T wb-web nginx -s reload
EOF
chmod 700 "$backup/rollback.sh"
rollback() {
  code=$?
  if [ "$code" -ne 0 ]; then
    echo 'Release failed; restoring previous files and application image.' >&2
    sh "$backup/rollback.sh" || echo "Automatic rollback failed: $backup/rollback.sh" >&2
  fi
  exit "$code"
}
trap rollback EXIT
tar -xzf "$archive"
chmod +x oneclick/bin/server
docker compose build wb-bff
docker compose up -d --no-deps --no-build --force-recreate wb-bff
healthy=0
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8787/healthz > /dev/null; then healthy=1; break; fi
  sleep 1
done
test "$healthy" = 1
# Nginx resolves the recreated BFF container address when its workers reload.
docker compose exec -T wb-web nginx -t
docker compose exec -T wb-web nginx -s reload
curl -fsS http://127.0.0.1:8088/setup/ > /dev/null
curl -fsS https://www.workbuddy999.top/healthz > /dev/null
curl -fsS https://www.workbuddy999.top/setup/ > /dev/null
echo "RELEASE_OK=$release"
echo "ROLLBACK=$backup/rollback.sh"
trap - EXIT
