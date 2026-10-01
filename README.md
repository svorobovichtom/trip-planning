# trip-planning

Общая страница для поездки на выходные (9 человек): список покупок с отметками
«куплено» в реальном времени и учёт расходов с чеками. Логина нет: читать может
любой, писать — только тот, у кого есть ссылка с ключом.

- Прод: https://89-168-118-89.sslip.io
- Зеркало на GitHub Pages: https://svorobovichtom.github.io/trip-planning/
- Ссылка для участников: `https://<домен>/#k=<TRIP_KEY>`. Страница сохраняет ключ
  в `localStorage` и дальше шлёт его в заголовке `X-Trip-Key`.

## Архитектура

```
браузер (index.html + vendor/pocketbase.umd.js)
   │  REST + realtime (SSE), записи с заголовком X-Trip-Key
   ▼
Caddy :443 (TLS, общий с Flatsy)  ──►  PocketBase 0.40.4 на 127.0.0.1:8090
                                         /opt/trip/pb_public    статика
                                         /opt/trip/pb_migrations схема и сид
                                         /opt/trip/pb_data      SQLite, файлы, бэкапы
```

Коллекции: `people` (участники), `items` (покупки), `expenses` (расходы, чек —
файл). Правила: `list`/`view` открыты, `create`/`update`/`delete` требуют
`@request.headers.x_trip_key = "<ключ>"`. Ключ подставляется из переменной
окружения `TRIP_KEY` в момент миграции, поэтому в репозитории его нет.

## Структура репозитория

| Путь | Что это |
|---|---|
| `index.html` | вся страница (HTML, CSS, JS в одном файле) |
| `vendor/pocketbase.umd.js` | JS SDK PocketBase |
| `pb_migrations/` | схема, сид (9 человек и список), настройки (batch, бэкапы) |
| `deploy.sh` | выкладка с ноутбука на VM |
| `deploy/setup.sh` | идемпотентная настройка сервера (запускать на VM от root) |
| `deploy/trip-pb.service` | systemd-юнит `trip-pb` |
| `deploy/Caddyfile`, `caddy-root.caddy`, `caddy-20-sites.conf` | конфиг Caddy |

Секреты лежат только в `/opt/trip/trip.env` (root, 600) и локально в
`deploy/.secrets` (в `.gitignore`).

## Первая установка сервера

```sh
rsync -az -e "ssh -i ~/.ssh/flatsy_oracle" --exclude .git --exclude deploy/.secrets \
  ./ ubuntu@89.168.118.89:~/trip-src/
ssh -i ~/.ssh/flatsy_oracle ubuntu@89.168.118.89
cd ~/trip-src && sudo TRIP_KEY=... TRIP_DOMAIN=89-168-118-89.sslip.io bash deploy/setup.sh
```

`TRIP_KEY` должен состоять из 12–64 символов `[A-Za-z0-9_-]`. Повторные запуски
`sudo bash deploy/setup.sh` читают значения из `/opt/trip/trip.env`.
Учётная запись администратора для `/_/`:
`sudo -u trip /opt/trip/pocketbase superuser upsert <email> <пароль> --dir=/opt/trip/pb_data`.

## Обычная выкладка

```sh
./deploy.sh            # только фронт: index.html и vendor/, без рестарта
./deploy.sh --restart  # ещё и pb_migrations/ + перезапуск trip-pb
```

Новые миграции применяются при старте PocketBase, поэтому для них нужен `--restart`.
Pages обновляется сам после `git push` в `main`.

## Ключ и его смена

1. На VM: `sudo nano /opt/trip/trip.env` и заменить `TRIP_KEY=` (нужно для
   будущих миграций и повторного `setup.sh`).
2. Админка https://89-168-118-89.sslip.io/_/ → Collections → `people` → ⚙ →
   API Rules: в Create, Update и Delete заменить ключ в
   `@request.headers.x_trip_key = "..."`. Повторить для `items` и `expenses`.
3. Разослать новую ссылку `https://<домен>/#k=<новый ключ>`. Старая ссылка
   продолжит читать, но записывать уже не сможет.

Альтернатива п. 2: новая миграция, которая читает `$os.getenv("TRIP_KEY")` и
переставляет правила трёх коллекций (как `writeRule()` в `1790000000_init.js`),
затем `./deploy.sh --restart`.

## Снять все отметки

Кнопка «Снять все отметки» на странице. Или в админке: `items` → фильтр
`done = true` → выделить всё и править вручную. Или curl:

```sh
K=...   # TRIP_KEY
U=https://89-168-118-89.sslip.io/api/collections/items/records
curl -s "$U?perPage=500&filter=done=true&fields=id" | jq -r '.items[].id' | while read id; do
  curl -s -X PATCH -H "X-Trip-Key: $K" -H 'Content-Type: application/json' \
    -d '{"done":false,"done_by":"","done_at":""}' "$U/$id" >/dev/null
done
```

## Выгрузка расходов

Админка `/_/` → `expenses` → выделить записи → Export. Или напрямую (чтение
публичное):

```sh
curl -s 'https://89-168-118-89.sslip.io/api/collections/expenses/records?perPage=500&expand=paid_by,split_between' | jq
```

## Бэкапы

PocketBase делает бэкап каждый день в 03:30 UTC и хранит последние 7 в
`/opt/trip/pb_data/backups`. Восстановить можно в админке: Settings →
Backups → Restore. Там же можно скачать архив. Копии лежат на той же VM, так что
перед чем-то рискованным скачайте свежий бэкап.

## GitHub Pages

Зеркало на `*.github.io` раздаёт ту же `index.html`, но API берёт с сервера
(`SERVER` в `index.html`). PocketBase отвечает с CORS `*`, поэтому это работает.
Ключ в `localStorage` у каждого origin свой, так что ссылка с `#k=` нужна для
каждого адреса отдельно.

## Caddy общий с Flatsy

Caddy запускается с `/etc/caddy/root.caddy`, который импортирует нетронутый
`/etc/caddy/Caddyfile` от Flatsy и `/etc/caddy/sites.d/*.caddy`. Перечитывать
конфиг только через `sudo systemctl reload caddy`. Не запускайте
`caddy reload --config /etc/caddy/Caddyfile` вручную: этот конфиг заменит
рабочий и сайт поездки пропадёт.
