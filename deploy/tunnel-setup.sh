#!/usr/bin/env bash
# One-time: create the Cloudflare tunnel for the trip API and run it as a service.
# Run on the VM as the user that did `cloudflared tunnel login` (cert in ~/.cloudflared):
#   bash ~/trip-src/deploy/tunnel-setup.sh
# The account-wide cert.pem is deleted at the end; the tunnel keeps only its own
# credentials file, which can run this one tunnel and nothing else.
set -euo pipefail
NAME=trip
HOST=trip-api.svorobovich.com
DIR="$(cd "$(dirname "$0")" && pwd)"

if ! cloudflared tunnel list -o json | grep -q "\"name\":\"$NAME\""; then
    cloudflared tunnel create "$NAME"
fi
ID="$(cloudflared tunnel list -o json | python3 -c "import sys,json;print([t['id'] for t in json.load(sys.stdin) if t['name']=='$NAME'][0])")"
cloudflared tunnel route dns "$NAME" "$HOST" || true   # no-op if the record exists

sudo id trip-tunnel >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin trip-tunnel
sudo install -d -m 750 -o root -g trip-tunnel /etc/trip-tunnel
sudo install -m 640 -o root -g trip-tunnel "$HOME/.cloudflared/$ID.json" "/etc/trip-tunnel/$ID.json"
sed "s/__TUNNEL_ID__/$ID/g" "$DIR/trip-tunnel.yml" | sudo tee /etc/trip-tunnel/config.yml >/dev/null
sudo chown root:trip-tunnel /etc/trip-tunnel/config.yml; sudo chmod 640 /etc/trip-tunnel/config.yml
sudo cloudflared --config /etc/trip-tunnel/config.yml tunnel ingress validate

sudo install -m 644 "$DIR/trip-tunnel.service" /etc/systemd/system/trip-tunnel.service
sudo systemctl daemon-reload
sudo systemctl enable --now trip-tunnel.service
sudo systemctl restart trip-tunnel.service

rm -f "$HOME/.cloudflared/cert.pem" "$HOME/.cloudflared/$ID.json"
echo "tunnel $NAME ($ID) -> https://$HOST"
