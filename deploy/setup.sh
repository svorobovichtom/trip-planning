#!/usr/bin/env bash
# Idempotent server bootstrap for the trip API (PocketBase). Run on the VM as root:
#
#   sudo TRIP_KEY=... bash deploy/setup.sh     # first time
#   sudo bash deploy/setup.sh                  # later: reads /opt/trip/trip.env
#
# Expects the repo checkout (or an rsync of it) in the current directory.
# Public access goes through the Cloudflare Tunnel (deploy/tunnel-setup.sh);
# nothing here touches Caddy or any port other than 127.0.0.1:8090.
set -euo pipefail

PB_VERSION=0.40.4
APP=/opt/trip
REPO="$(cd "$(dirname "$0")/.." && pwd)"

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }

# --- config / secrets -------------------------------------------------------
mkdir -p "$APP"
ENV_FILE="$APP/trip.env"
if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    set -a; . "$ENV_FILE"; set +a
fi
: "${TRIP_KEY:?TRIP_KEY is required on first run}"
: "${TRIP_URL:=https://trip-planning.svorobovichtom.workers.dev}"
umask 077
printf 'TRIP_KEY=%s\nTRIP_URL=%s\n' "$TRIP_KEY" "$TRIP_URL" > "$ENV_FILE.new"
mv "$ENV_FILE.new" "$ENV_FILE"
umask 022

# --- user + layout ----------------------------------------------------------
id trip >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin trip
mkdir -p "$APP/pb_data" "$APP/pb_migrations" "$APP/pb_public"   # pb_public stays empty: the site is on Cloudflare

# --- pocketbase binary ------------------------------------------------------
case "$(uname -m)" in
    aarch64|arm64) PB_ARCH=arm64 ;;
    x86_64|amd64)  PB_ARCH=amd64 ;;
    *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
esac
if ! "$APP/pocketbase" --version 2>/dev/null | grep -q "$PB_VERSION"; then
    tmp="$(mktemp -d)"
    curl -fsSL -o "$tmp/pb.zip" \
        "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip"
    command -v unzip >/dev/null || apt-get install -y -qq unzip
    unzip -oq "$tmp/pb.zip" pocketbase -d "$tmp"
    install -m 755 "$tmp/pocketbase" "$APP/pocketbase"
    rm -rf "$tmp"
fi

# --- app files --------------------------------------------------------------
install -m 644 "$REPO"/pb_migrations/*.js "$APP/pb_migrations/"
chown -R trip:trip "$APP"
chmod 600 "$ENV_FILE"; chown root:root "$ENV_FILE"

# --- systemd ----------------------------------------------------------------
install -m 644 "$REPO/deploy/trip-pb.service" /etc/systemd/system/trip-pb.service
systemctl daemon-reload
systemctl enable --now trip-pb.service
systemctl restart trip-pb.service

for _ in $(seq 1 20); do
    curl -fsS http://127.0.0.1:8090/api/health >/dev/null 2>&1 && break
    sleep 0.5
done
curl -fsS http://127.0.0.1:8090/api/health && echo
echo "setup ok: PocketBase on 127.0.0.1:8090 (public via deploy/tunnel-setup.sh)"
