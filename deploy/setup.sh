#!/usr/bin/env bash
# Idempotent server bootstrap for the trip app. Run on the VM as root:
#
#   sudo TRIP_KEY=... TRIP_DOMAIN=... bash deploy/setup.sh     # first time
#   sudo bash deploy/setup.sh                                  # later: reads /opt/trip/trip.env
#
# Expects the repo checkout (or an rsync of it) in the current directory.
#
# Caddy is shared with other projects on this box (Flatsy owns
# /etc/caddy/Caddyfile and rewrites it on every deploy). We never edit that
# file. Instead Caddy runs /etc/caddy/root.caddy, which imports the Flatsy file
# first and then every /etc/caddy/sites.d/*.caddy - one file per app.
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
: "${TRIP_DOMAIN:?TRIP_DOMAIN is required on first run}"
umask 077
printf 'TRIP_KEY=%s\nTRIP_DOMAIN=%s\nTRIP_URL=https://%s\n' "$TRIP_KEY" "$TRIP_DOMAIN" "$TRIP_DOMAIN" > "$ENV_FILE.new"
mv "$ENV_FILE.new" "$ENV_FILE"
umask 022

# --- user + layout ----------------------------------------------------------
id trip >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin trip
mkdir -p "$APP/pb_data" "$APP/pb_migrations" "$APP/pb_public"

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
install -m 644 "$REPO/web/index.html" "$REPO/web/sw.js" "$APP/pb_public/"
mkdir -p "$APP/pb_public/vendor"
install -m 644 "$REPO"/web/vendor/* "$APP/pb_public/vendor/"
chown -R trip:trip "$APP"
chmod 600 "$ENV_FILE"; chown root:root "$ENV_FILE"

# --- systemd ----------------------------------------------------------------
install -m 644 "$REPO/deploy/trip-pb.service" /etc/systemd/system/trip-pb.service
systemctl daemon-reload
systemctl enable --now trip-pb.service
systemctl restart trip-pb.service

# --- caddy: root config + per-app site file ---------------------------------
# A broken file in sites.d would also stop Flatsy the next time Caddy restarts,
# so the new block is validated first and rolled back if it fails.
mkdir -p /etc/caddy/sites.d
SITE=/etc/caddy/sites.d/trip.caddy
[[ -f "$SITE" ]] && cp "$SITE" "$SITE.prev"
sed "s/__DOMAIN__/$TRIP_DOMAIN/" "$REPO/deploy/Caddyfile" > "$SITE"
install -m 644 "$REPO/deploy/caddy-root.caddy" /etc/caddy/root.caddy
mkdir -p /etc/systemd/system/caddy.service.d
install -m 644 "$REPO/deploy/caddy-20-sites.conf" /etc/systemd/system/caddy.service.d/20-sites.conf

# Validate with the same environment Caddy runs with (Flatsy keeps secrets there).
CADDY_ENV=()
[[ -f /etc/flatsy/caddy.env ]] && mapfile -t CADDY_ENV < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' /etc/flatsy/caddy.env)
if ! env "${CADDY_ENV[@]}" caddy validate --adapter caddyfile --config /etc/caddy/root.caddy; then
    if [[ -f "$SITE.prev" ]]; then mv "$SITE.prev" "$SITE"; else rm -f "$SITE"; fi
    echo "Caddy config invalid; trip site rolled back, Caddy not reloaded" >&2
    exit 1
fi
rm -f "$SITE.prev"
systemctl daemon-reload
if [[ "$(systemctl show caddy -p ExecStart --value)" == *root.caddy* ]] && systemctl is-active --quiet caddy; then
    systemctl reload caddy
else
    systemctl restart caddy
fi

for _ in $(seq 1 20); do
    curl -fsS http://127.0.0.1:8090/api/health >/dev/null 2>&1 && break
    sleep 0.5
done
curl -fsS http://127.0.0.1:8090/api/health && echo
echo "setup ok: https://$TRIP_DOMAIN"
