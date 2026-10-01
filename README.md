# trip-planning

Общая страница для поездки на выходные (9 человек): список покупок с отметками
«куплено» в реальном времени и учёт расходов с чеками. Логина нет: читать может
любой, писать — только тот, у кого есть ссылка с ключом.

- Сайт: https://trip-planning.svorobovichtom.workers.dev/
- Ссылка для участников: `https://trip-planning.svorobovichtom.workers.dev/#k=<TRIP_KEY>`
  (ключ в `deploy/.secrets` и `/opt/trip/trip.env`). Страница сохраняет ключ в
  `localStorage` и дальше шлёт его в заголовке `X-Trip-Key`.
- API: https://trip-api.svorobovich.com
- Админка: только через SSH — `./admin.sh` открывает http://localhost:8091/_/ (из интернета `/_/` и вход суперюзера закрыты в туннеле и в Caddy). Логин в `deploy/.secrets`.
  (логин и пароль в `deploy/.secrets`).

## Архитектура

```
браузер ── статика ──► Cloudflare Workers (web/, собирается из GitHub)
   │
   │  REST + realtime (SSE), записи с заголовком X-Trip-Key
   ▼
trip-api.svorobovich.com ── Cloudflare Tunnel "trip" ──► VM Oracle
                            (trip-tunnel, исходящее        PocketBase 0.40.4
                             соединение, портов нет)       127.0.0.1:8090 (trip-pb)
```

Коллекции: `people` (участники), `items` (покупки), `expenses` (расходы, чек —
файл). Правила: `list`/`view` открыты, `create`/`update`/`delete` требуют
`@request.headers.x_trip_key = "<ключ>"`. Ключ подставляется из переменной
окружения `TRIP_KEY` в момент миграции, поэтому в репозитории его нет.

На VM: `/opt/trip` (бинарник, `pb_data`, `pb_migrations`, `pb_public`, `trip.env`),
сервис `trip-pb` от пользователя `trip` (лимиты 384M / 50% CPU) и сервис
`trip-tunnel` от пользователя `trip-tunnel`, конфиг в `/etc/trip-tunnel/`
(лимиты 128M / 25% CPU). Входящих портов у приложения нет.

С Flatsy общая только сама VM: отдельные пользователи, каталоги, порты и
systemd-лимиты. (Пока идёт переходный период, ещё общий Caddy, см. ниже.)

## Структура репозитория

| Путь | Что это |
|---|---|
| `web/index.html` | вся страница (HTML, CSS, JS в одном файле) |
| `web/sw.js`, `web/_headers` | service worker (офлайн) и заголовки кэша для Cloudflare |
| `web/vendor/pocketbase.umd.js` | JS SDK PocketBase |
| `web/vendor/torph.mjs` | torph 0.1.3 (MIT, Lochie Axon), морфинг текста |
| `wrangler.jsonc` | Worker `trip-planning`: раздаёт `web/` как статику |
| `pb_migrations/` | схема, сид, настройки (batch, бэкапы) |
| `deploy.sh` | выкладка миграций и копии `web/` на VM |
| `deploy/setup.sh` | идемпотентная настройка PocketBase на VM (от root) |
| `deploy/tunnel-setup.sh` | разовая настройка туннеля |
| `deploy/trip-pb.service`, `trip-tunnel.service`, `trip-tunnel.yml` | systemd-юниты и конфиг cloudflared |
| `deploy/Caddyfile`, `caddy-root.caddy`, `caddy-20-sites.conf` | старый сайт на sslip.io (переходный период) |

## Фронтенд

Cloudflare Workers Builds подключён к GitHub: каждый push в `main` публикует
`web/` (около 1–2 минут). Preview-сборки выключены. GitHub Pages выключен.
`SERVER` в `web/index.html` указывает на `https://trip-api.svorobovich.com`;
если страницу отдаёт сам PocketBase (локально), она ходит в свой origin.

Если push по SSH не проходит: один раз `gh auth setup-git` и пушить по HTTPS
(`origin` уже HTTPS).

## Бэкенд

Миграции выкладываются вручную, с ноутбука:

```sh
./deploy.sh --restart  # pb_migrations/ + копия web/ + перезапуск trip-pb
./deploy.sh            # только копия web/ на VM, без рестарта
```

Новые миграции применяются при старте PocketBase, поэтому для них нужен
`--restart`. Автоматизации нет намеренно: SSH-ключ с sudo на VM, где живёт
Flatsy, не должен лежать в GitHub.

Первая установка (PocketBase, затем туннель):

```sh
rsync -az -e "ssh -i ~/.ssh/flatsy_oracle" --exclude .git --exclude deploy/.secrets \
  ./ ubuntu@89.168.118.89:~/trip-src/
ssh -i ~/.ssh/flatsy_oracle ubuntu@89.168.118.89
cd ~/trip-src && sudo TRIP_KEY=... TRIP_DOMAIN=89-168-118-89.sslip.io bash deploy/setup.sh
cloudflared tunnel login && bash deploy/tunnel-setup.sh
```

`TRIP_KEY` — 12–64 символа `[A-Za-z0-9_-]`. Повторные запуски
`sudo bash deploy/setup.sh` читают значения из `/opt/trip/trip.env`.
`tunnel-setup.sh` разовый и в конце удаляет общий для аккаунта `cert.pem`;
у туннеля остаются только свои credentials в `/etc/trip-tunnel/`.
Администратор для `/_/`:
`sudo -u trip /opt/trip/pocketbase superuser upsert <email> <пароль> --dir=/opt/trip/pb_data`.

## Локальный запуск

```sh
TRIP_KEY=... ./pocketbase serve --http 127.0.0.1:8099 --dir pb_data \
  --migrationsDir pb_migrations --publicDir web
```

Бинарник `pocketbase` и `pb_data` в `.gitignore`. Страница на
http://127.0.0.1:8099/#k=... работает с тем же origin.

## Ключ и его смена

1. На VM: `sudo nano /opt/trip/trip.env` и заменить `TRIP_KEY=` (нужно для
   будущих миграций и повторного `setup.sh`). Обновить `deploy/.secrets`.
2. Админка (`./admin.sh`) → Collections → `people` → ⚙ →
   API Rules: в Create, Update и Delete заменить ключ в
   `@request.headers.x_trip_key = "..."`. Повторить для `items` и `expenses`.
3. Разослать новую ссылку `https://trip-planning.svorobovichtom.workers.dev/#k=<новый ключ>`.
   Старая ссылка продолжит читать, но записывать уже не сможет.

Альтернатива п. 2: новая миграция, которая читает `$os.getenv("TRIP_KEY")` и
переставляет правила трёх коллекций (как `writeRule()` в `1790000000_init.js`),
затем `./deploy.sh --restart`.

## Снять все отметки

Кнопка «Снять все отметки» на странице. Или curl:

```sh
K=...   # TRIP_KEY
U=https://trip-api.svorobovich.com/api/collections/items/records
curl -s "$U?perPage=500&filter=done=true&fields=id" | jq -r '.items[].id' | while read id; do
  curl -s -X PATCH -H "X-Trip-Key: $K" -H 'Content-Type: application/json' \
    -d '{"done":false,"done_by":"","done_at":""}' "$U/$id" >/dev/null
done
```

## Выгрузка расходов

Админка `/_/` → `expenses` → выделить записи → Export. Или напрямую (чтение
публичное):

```sh
curl -s 'https://trip-api.svorobovich.com/api/collections/expenses/records?perPage=500&expand=paid_by,split_between' | jq
```

## Бэкапы

PocketBase делает бэкап каждый день в 03:30 UTC и хранит последние 7 в
`/opt/trip/pb_data/backups`. Восстановить или скачать: админка → Settings →
Backups. Копии лежат на той же VM, так что перед чем-то рискованным скачайте
свежий бэкап.

## Переходный период

VM ещё раздаёт старую копию на https://89-168-118-89.sslip.io через общий с
Flatsy Caddy (`/etc/caddy/root.caddy` + `sites.d/trip.caddy` + drop-in
`20-sites.conf`). Перечитывать его только `sudo systemctl reload caddy`, не
`caddy reload --config /etc/caddy/Caddyfile`. Когда все перейдут на ссылку
workers.dev, убрать:

```sh
sudo rm /etc/systemd/system/caddy.service.d/20-sites.conf /etc/caddy/root.caddy /etc/caddy/sites.d/trip.caddy
sudo systemctl daemon-reload && sudo systemctl restart caddy
curl -fsS https://api.flatsy.svorobovich.com/health   # Flatsy жив
```
