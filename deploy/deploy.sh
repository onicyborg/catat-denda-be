#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"
umask 077
exec 9>.deploy.lock
flock -w 300 9
image=${1:?Runtime image digest required}
admin_image=${2:?Admin image digest required}
domain=${3:?Backend domain required}
origin=${4:?Frontend origin required}
[[ "$image" =~ ^ghcr.io/onicyborg/catat-denda-be@sha256:[a-f0-9]{64}$ ]]
[[ "$admin_image" =~ ^ghcr.io/onicyborg/catat-denda-be-admin@sha256:[a-f0-9]{64}$ ]]
[[ "$domain" =~ ^[a-z0-9.-]+$ ]]
previous_image=$(cat .image 2>/dev/null || true)
nginx_file=/etc/nginx/sites-enabled/catat-denda-api
had_nginx=false
had_runtime=false
activated=false
if [ -f "$nginx_file" ]; then cp "$nginx_file" .nginx.previous; had_nginx=true; fi
if [ -f .env.runtime ]; then cp .env.runtime .env.runtime.previous; had_runtime=true; fi
cleanup() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    if [ "$had_runtime" = true ]; then cp .env.runtime.previous .env.runtime; fi
    if [ "$activated" = true ]; then
      if [ -n "$previous_image" ]; then
        IMAGE="$previous_image" docker compose -f docker-compose.yml up -d --wait --wait-timeout 120 || true
      else
        IMAGE="$image" docker compose -f docker-compose.yml down || true
      fi
    fi
    if [ "$had_nginx" = true ]; then cp .nginx.previous "$nginx_file"; else rm -f "$nginx_file"; fi
    nginx -t && systemctl reload nginx || true
    echo 'Deployment failed; previous application and Nginx configuration restored. Database migrations are not reversed.' >&2
  fi
  rm -f .env.admin .env.next .env.runtime.next .env.runtime.previous .nginx.previous
  exit "$status"
}
trap cleanup EXIT
pull_image() {
  for attempt in 1 2 3; do
    if timeout --signal=TERM --kill-after=15s 180s docker pull "$1"; then return 0; fi
    echo "Image download attempt $attempt failed or timed out; retrying." >&2
    sleep 5
  done
  return 1
}
pull_image "$image"
pull_image "$admin_image"
docker run --rm --network host --user 0:0 --cap-drop ALL --security-opt no-new-privileges \
  -v "$PWD:/run/deploy" -w /run/deploy "$admin_image" \
  node /app/deploy/prepare-env.mjs "$domain" "$origin"
sed "s/__BACKEND_DOMAIN__/$domain/g" nginx.conf.template > "$nginx_file"
nginx -t
docker run --rm --network host --cap-drop ALL --security-opt no-new-privileges \
  --env-file .env.admin "$admin_image" pnpm prisma:deploy
docker run --rm --network host --cap-drop ALL --security-opt no-new-privileges \
  --env-file .env.admin "$admin_image" pnpm db:seed
docker run --rm --network host --user 0:0 --cap-drop ALL --security-opt no-new-privileges \
  --env-file .env.admin -v "$PWD/.db-roles.json:/run/deploy/db-roles.json:ro" \
  "$admin_image" node deploy/provision-roles.mjs
docker run --rm --network host --read-only --cap-drop ALL --security-opt no-new-privileges \
  --env-file .env.runtime.next "$image" node --input-type=module -e '
  import pg from "pg";
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const result = await db.query("SELECT current_user, (SELECT count(*) FROM \"User\") AS users, (SELECT count(*) FROM \"FineCase\") AS cases");
    if (result.rows[0].current_user !== "catat_denda_runtime" || Number(result.rows[0].users) < 1) throw new Error("Runtime database probe failed");
    console.log("Restricted runtime database access verified.");
  } finally { await db.end(); }'
mv .env.runtime.next .env.runtime
activated=true
IMAGE="$image" docker compose -f docker-compose.yml up -d --wait --wait-timeout 120
systemctl reload nginx
curl --fail --silent --show-error --max-time 15 \
  -H "Host: $domain" http://127.0.0.1:8080/api/v1/health/live > /dev/null
printf '%s\n' "$image" > .image
printf '%s\n' "$admin_image" > .admin-image
echo 'Deployment healthy. Runtime uses a restricted database role; migration and seed credentials removed.'
