#!/usr/bin/env bash
# Push database migrations to the VM and restart PocketBase.
# The site itself deploys on `git push` (Cloudflare Workers Builds, see README).
# Usage: ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
HOST="${TRIP_HOST:-ubuntu@89.168.118.89}"
SSH_KEY="${TRIP_SSH_KEY:-$HOME/.ssh/flatsy_oracle}"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes)

rsync -az --delete -e "${SSH[*]}" pb_migrations "$HOST:~/trip-src/"
"${SSH[@]}" "$HOST" 'set -e
  sudo install -m 644 -o trip -g trip ~/trip-src/pb_migrations/*.js /opt/trip/pb_migrations/
  sudo systemctl restart trip-pb
  for i in $(seq 1 20); do curl -fsS http://127.0.0.1:8090/api/health >/dev/null 2>&1 && break; sleep .5; done
  curl -fsS http://127.0.0.1:8090/api/health; echo'
echo "deployed"
