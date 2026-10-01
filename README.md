# trip-planning

Общая страница для поездки на выходные (9 человек): список покупок с отметками
«куплено» в реальном времени и учёт расходов с чеками. Логина нет: читать может
любой, писать — только тот, у кого есть ссылка с ключом.

- Сайт: https://trip-planning.svorobovichtom.workers.dev/
- Ссылка для участников: `https://trip-planning.svorobovichtom.workers.dev/#<TRIP_KEY>` (старый вид `#k=<TRIP_KEY>` тоже работает). Часть после `#` браузер никуда не отправляет — её читает только сама страница и запоминает ключ в телефоне; без неё страница только для просмотра.
  (ключ в `deploy/.secrets` и `/opt/trip/trip.env`). Страница сохраняет ключ в
  `localStorage` и дальше шлёт его в заголовке `X-Trip-Key`.
- API: https://trip-api.svorobovich.com
- Админка: только через SSH — `./admin.sh` открывает http://localhost:8091/_/ (из интернета `/_/` и вход суперюзера закрыты в туннеле). Логин в `deploy/.secrets`.
  (логин и пароль в `deploy/.secrets`).

## Архитектура

```
браузер ── статика ──► Cloudflare Workers (app/ → dist/, собирается из GitHub)
   │
   │  REST + realtime (SSE), записи с заголовком X-Trip-Key
   ▼
trip-api.svorobovich.com ── Cloudflare Tunnel "trip" ──► VM Oracle
                            (trip-tunnel, исходящее        PocketBase 0.40.4
                             соединение, портов нет)       127.0.0.1:8090 (trip-pb)
```

Коллекции: `people` (участники; необязательные `revolut` — Revtag без `@` — и
`phone` — телефон для BLIK, их человек вводит сам в профиле, «Как тебе переводить»; читаются
всеми, как и имена), `items` (покупки), `expenses` (расходы, чек —
файл), `claims` («я брал эту строку чека»: `expense`, `line` — индекс в
`expenses.lines`, `person`; уникально по тройке, удаляются вместе с расходом),
`settlements` («переведено»: `from`, `to` — люди, `amount` — **в грошах**, целое ≥ 1,
в отличие от `expenses.amount` в злотых; `note`, `created`; не редактируются —
неверный удаляют и отмечают заново; в балансе считаются как платёж от `from` к `to`). Правила: `list`/`view` открыты, `create`/`update`/`delete` требуют
`@request.headers.x_trip_key = "<ключ>"`. Исключение — лист «Поездка»
(`1790000008_trip.js`): `house` (одна запись `house0000000001`: `address`,
`dates`, `wifi_name`, `wifi_pass`, `info`; только `update`), `meals` (`day`,
`meal`, `dish`, `order`) и `notes` (`text`, `author` → people, необязательно)
**читаются тоже только с ключом** (адрес и пароль Wi‑Fi); realtime-подписка на
них передаёт ключ в `options.headers` (`app/src/lib/sync.ts`). Ключ подставляется из переменной
окружения `TRIP_KEY` в момент миграции, поэтому в репозитории его нет.

На VM: `/opt/trip` (бинарник, `pb_data`, `pb_migrations`, `trip.env`; `pb_public` пустой),
сервис `trip-pb` от пользователя `trip` (лимиты 384M / 50% CPU) и сервис
`trip-tunnel` от пользователя `trip-tunnel`, конфиг в `/etc/trip-tunnel/`
(лимиты 128M / 25% CPU). Входящих портов у приложения нет.

С Flatsy общая только сама VM: отдельные пользователи, каталоги, порты и
systemd-лимиты. Caddy, порты 80/443 и сертификаты Flatsy приложение не трогает.

## Расходы: распознавание чека и деление

- **Фоновое распознавание** (`pb_hooks/scan.pb.js`, логика в `scan_lib.js`).
  Расход, созданный через API с чеком JPEG/PNG/WebP (или получивший новый чек),
  получает `scan_status = "pending"`; сумма может быть `0` («пока неизвестна»).
  Раз в минуту cron берёт до 2 таких расходов → `running` → Worker
  `POST /scan` (JSON `{image_url, items}`, заголовок `X-Trip-Key`, таймаут 100 с)
  → `done`: `lines`, `scanned_at`; `amount` ставится, только если был 0,
  `category` и `title` (магазин) — только если пустые. Деление, плательщик и
  отметки покупок не меняются. `lines_ok = false` → `scan_error = "lines_mismatch"`
  (строки не сходятся с итогом, деление «по чеку» не предлагается).
  Ошибка → `failed` + короткая причина в `scan_error`, одна автоматическая
  повторная попытка через ~5 мин. `running` дольше 5 мин → снова `pending`.
  Обычное редактирование старых расходов ничего не запускает.
  **Распознать вручную** (в т.ч. старый расход): `PATCH` с `{"scan_status":"pending"}`.
  Логи: `journalctl -u trip-pb | grep '\[scan\]'`.
- **Деление** (`split_mode`): `equal` (поровну между `split_between`, пусто =
  все), `amounts` (`split_amounts`: `{"<personId>": грош | null}`, `null` —
  поровну из остатка), `claims` (по строкам чека из `claims`).
- **Правила денег** (`app/src/lib/ledger.ts`, всё в грошах, проверяется
  `ledger.props.test.ts` на случайных поездках и `ledger.edge.test.ts`):
  доли каждого расхода в сумме дают ровно его сумму и не бывают
  отрицательными; лишние гроши — первым по порядку списка; балансы в сумме
  всегда 0; предложенные переводы обнуляют всех (не больше «людей − 1»).
  Сумма 0 (чек ещё читается) ни на кого не влияет; расход, чей плательщик
  удалён, — тоже. «Суммами»: если расписано больше суммы (чек подставил
  меньшую), доли уменьшаются пропорционально, «авто» — 0. «По чеку»: скидка
  под товаром — часть этой строки (как в списке); неотмеченные строки и
  разница «сумма − строки» — поровну между участниками; если отмеченное
  больше суммы — сумма делится пропорционально отмеченному. Ввод суммы
  («12,50», «12.5», «1 234,56») переводится в гроши точно, по цифрам.

## Итоги: перевод в один тап

В «Ты должен» у каждой строки: **Перевести** — если у получателя есть
`revolut`, ссылка `https://revolut.me/<revtag>?amount=<грош>&currency=PLN`
(сумма в **грошах**: 50,34 zł → `amount=5034`; так её читает revolut.me, см.
`app/src/lib/pay.ts`), на iOS это universal link в приложение Revolut, без
приложения — страница revolut.me; **BLIK** — если есть `phone`: лист с телефоном
и суммой для копирования (ссылки, открывающей перевод на телефон в банке, нет).
Вернулся на страницу в течение 10 минут — «Отметить перевод → Юля 50,34?»
(создаёт `settlements`). Без реквизитов — «Способ перевода не указан».

## Профиль

Кнопка в шапке — [аватар · имя]; если человек не выбран — «Кто ты?» (сразу на
шаг выбора). Профиль (`app/src/features/shell/ProfileSheet.tsx`): имя (тап —
переименовать), «Сменить» → «Кто ты?» (новое имя или «Уже заходил — выбери
себя»), баланс одной строкой (тап → «Итоги»), «Как тебе переводить» (Revolut и
BLIK правятся прямо в строках), «Дом, меню и заметки» (лист «Поездка»:
адрес → Карты, даты, Wi‑Fi с копированием пароля, меню по дням, общие заметки;
правят все, у кого есть ключ — `app/src/features/trip/`) и «Участники» (вложенные листы),
ссылка для группы, CSV, «Снять все отметки» (с подтверждением), номер сборки.
Без ключа — только просмотр.

Аватары — [boring-avatars](https://boringavatars.com/) (MIT), вариант «beam»,
палитра `#2B2A28 #C9541F #E8B07A #7C8B6F #EFE6D8` (`app/src/ui/Avatar.tsx`).
Строятся из `id` человека, поэтому одинаковы на всех телефонах и не меняются
при переименовании; на сервере ничего не хранится.

## Структура репозитория

| Путь | Что это |
|---|---|
| `app/` | приложение (Vite + React 19 + TypeScript + Base UI + torph + boring-avatars), раздаётся на `/`; `npm test`, `npm run typecheck` |
| `package.json`, `scripts/assemble.mjs` | сборка: `npm run build` собирает `app/` в `dist/`, пишет `_headers` и `_redirects` (старые адреса `/next/`, `/old/`, `/lab` → `/`); service worker генерируется в `app/vite.config.ts` (`/sw.js`, scope `/`) |
| `wrangler.jsonc` | Worker `trip-planning`: раздаёт `dist/` как статику (`build.command` = `npm run build`) |
| `pb_migrations/` | схема, сид, настройки (batch, бэкапы) |
| `pb_hooks/` | JS-хуки PocketBase: фоновое распознавание чеков |
| `deploy.sh` | выкладка миграций, хуков и юнита на VM + перезапуск PocketBase |
| `deploy/setup.sh` | идемпотентная настройка PocketBase на VM (от root) |
| `deploy/tunnel-setup.sh` | разовая настройка туннеля |
| `deploy/trip-pb.service`, `trip-tunnel.service`, `trip-tunnel.yml` | systemd-юниты и конфиг cloudflared |

## Фронтенд

Cloudflare Workers Builds подключён к GitHub: каждый push в `main` ставит
зависимости (`npm ci`, workspaces: `app`), `npx wrangler deploy` запускает
`npm run build` и публикует `dist/` (около 1–2 минут). Preview-сборки выключены. GitHub Pages выключен.
Проверить сборку локально: `npx wrangler deploy --dry-run --outdir /tmp/wout`.

Новое приложение (`app/`) читает те же ключи `localStorage` (`trip.key`,
`trip.me`, `trip.pending`, `trip.got`, `trip.tab`), так что люди переходят без
повторного входа; снимок данных — `trip.next.snap`. Разработка:
`npm run dev` (http://127.0.0.1:5196/, `/api` проксируется на локальный
PocketBase `PB_URL`, по умолчанию http://127.0.0.1:8096).
`SERVER` в `app/src/lib/pb.ts` указывает на `https://trip-api.svorobovich.com`
(переопределяется `VITE_PB_URL`); на localhost приложение ходит в свой origin.

Если push по SSH не проходит: один раз `gh auth setup-git` и пушить по HTTPS
(`origin` уже HTTPS).

## Бэкенд

Миграции выкладываются вручную, с ноутбука:

```sh
./deploy.sh  # pb_migrations/, pb_hooks/, юнит на VM + перезапуск trip-pb (страницы переподключатся сами)
```

Новые миграции применяются, а хуки читаются при старте PocketBase
(`--hooksWatch=false`), поэтому скрипт его перезапускает. Автоматизации нет намеренно: SSH-ключ с sudo на VM, где живёт
Flatsy, не должен лежать в GitHub.

Первая установка (PocketBase, затем туннель):

```sh
rsync -az -e "ssh -i ~/.ssh/flatsy_oracle" --exclude .git --exclude deploy/.secrets \
  ./ ubuntu@89.168.118.89:~/trip-src/
ssh -i ~/.ssh/flatsy_oracle ubuntu@89.168.118.89
cd ~/trip-src && sudo TRIP_KEY=... bash deploy/setup.sh
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
  --migrationsDir pb_migrations --hooksDir pb_hooks --publicDir web
```

Хук распознавания по умолчанию ходит в боевой Worker и отдаёт ему ссылку на
`https://trip-api.svorobovich.com`; локально их можно подменить через
`TRIP_SCAN_URL=http://.../scan` и `TRIP_API_URL=http://127.0.0.1:8099`.

Бинарник `pocketbase` и `pb_data` в `.gitignore`. Страница на
http://127.0.0.1:8099/#<ключ> работает с тем же origin.

## Ключ и его смена

1. На VM: `sudo nano /opt/trip/trip.env` и заменить `TRIP_KEY=` (нужно для
   будущих миграций и повторного `setup.sh`). Обновить `deploy/.secrets`.
2. Админка (`./admin.sh`) → Collections → `people` → ⚙ →
   API Rules: в Create, Update и Delete заменить ключ в
   `@request.headers.x_trip_key = "..."`. Повторить для `items`, `expenses` и
   `claims` (у `claims` только Create и Delete) и `settlements` (Create — там ещё
   `&& @request.body.from != @request.body.to`, — и Delete). У `meals` и `notes`
   ключ во всех пяти правилах (List и View тоже), у `house` — List, View, Update.
3. Разослать новую ссылку `https://trip-planning.svorobovichtom.workers.dev/#<новый ключ>`.
   Старая ссылка продолжит читать, но записывать уже не сможет.

Альтернатива п. 2: новая миграция, которая читает `$os.getenv("TRIP_KEY")` и
переставляет правила коллекций (`people`, `items`, `expenses`, `claims`) (как `writeRule()` в `1790000000_init.js`),
затем `./deploy.sh`.

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
