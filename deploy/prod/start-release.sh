#!/bin/sh
set -eu
cd /opt/workbuddy-prod
docker compose config --quiet
docker compose up -d wb-postgres wb-redis
ready=0
for attempt in $(seq 1 60); do
  if docker exec wb-postgres pg_isready -h 127.0.0.1 -U wbuser -d new-api >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
test "$ready" = 1
tables=$(docker exec wb-postgres psql -U wbuser -d new-api -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
if [ "$tables" != 0 ]; then
  echo 'Database already contains tables; refusing to restore over existing data.' >&2
  exit 1
fi
docker cp /var/backups/workbuddy/database-local-20261027.dump wb-postgres:/tmp/initial.dump
docker exec wb-postgres pg_restore -U wbuser -d new-api --no-owner --no-privileges --exit-on-error /tmp/initial.dump
docker compose up -d wb-new-api
ready=0
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3002/api/status -o /tmp/workbuddy-status.json; then ready=1; break; fi
  sleep 1
done
test "$ready" = 1
python3 -c 'import json; assert json.load(open("/tmp/workbuddy-status.json"))["data"]["upstream_credit_billing"] is True'
docker compose up -d wb-bff wb-web
docker compose ps
