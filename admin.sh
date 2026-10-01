#!/usr/bin/env bash
# Open the PocketBase admin UI. It is not reachable from the internet (blocked
# in the tunnel and in Caddy); this forwards it over SSH to http://localhost:8091/_/.
# Ctrl+C closes the tunnel. Login is in deploy/.secrets (PB_ADMIN_*).
set -euo pipefail
HOST="${TRIP_HOST:-ubuntu@89.168.118.89}"
SSH_KEY="${TRIP_SSH_KEY:-$HOME/.ssh/flatsy_oracle}"
PORT="${TRIP_ADMIN_PORT:-8091}"
echo "admin: http://localhost:$PORT/_/   (Ctrl+C to close)"
(sleep 2; open "http://localhost:$PORT/_/" 2>/dev/null || true) &
exec ssh -i "$SSH_KEY" -N -o ExitOnForwardFailure=yes -L "$PORT:127.0.0.1:8090" "$HOST"
