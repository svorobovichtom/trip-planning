#!/usr/bin/env bash
# Push the app to the VM: index.html + vendor/ -> pb_public, migrations -> pb_migrations.
# Usage: ./deploy.sh            (frontend only, no restart)
#        ./deploy.sh --restart  (also migrations + restart PocketBase)
set -euo pipefail
cd "$(dirname "$0")"
HOST="${TRIP_HOST:-ubuntu@89.168.118.89}"
SSH_KEY="${TRIP_SSH_KEY:-$HOME/.ssh/flatsy_oracle}"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes)

rsync -az --delete -e "${SSH[*]}" index.html vendor pb_migrations "$HOST:~/trip-src/"
"${SSH[@]}" "$HOST" 'set -e
  sudo install -m 644 -o trip -g trip ~/trip-src/index.html /opt/trip/pb_public/index.html
  sudo mkdir -p /opt/trip/pb_public/vendor
  sudo install -m 644 -o trip -g trip ~/trip-src/vendor/* /opt/trip/pb_public/vendor/
  if [ "'"${1:-}"'" = --restart ]; then
    sudo install -m 644 -o trip -g trip ~/trip-src/pb_migrations/*.js /opt/trip/pb_migrations/
    sudo systemctl restart trip-pb
    for i in $(seq 1 20); do curl -fsS http://127.0.0.1:8090/api/health >/dev/null 2>&1 && break; sleep .5; done
  fi
  curl -fsS http://127.0.0.1:8090/api/health; echo'
echo "deployed"
