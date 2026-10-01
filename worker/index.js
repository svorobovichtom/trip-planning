// Worker in front of the static site. Static files in web/ are served by the
// assets layer; only /scan (see run_worker_first in wrangler.jsonc) and paths
// with no matching file reach this code.
//
// POST /scan  (header X-Trip-Key), either
//  multipart/form-data (the app):
//   image        JPEG/PNG/WebP, <= 6 MB
//   items        optional JSON [{id, name, pl}] of unchecked shopping-list items
//   model        optional: pins one allow-listed vision model (step 1)
//   match_model  optional: pins one allow-listed text model (step 2)
//  or application/json (server-side hook):
//   {"image_url": "https://trip-api.svorobovich.com/api/files/...", "items"?, "model"?, "match_model"?}
//   The Worker fetches the image itself: that prefix only, no redirects,
//   10 s timeout, same size and format checks.
// -> { provider, model, total, currency, store, date, category,
//      lines: [{text, qty, unit, price, category, item_id}],
//      lines_sum, lines_ok, matched, timings: {vision_ms, match_ms},
//      match_model, neurons (estimate), fallback?, notes?, match_error? }
//
// Two steps, both on Workers AI (~400 neurons for a 31-line receipt):
//  1. Vision: the photo alone (no shopping list, so nothing to "find") ->
//     store, date, total and printed rows [name, qty, unit, amount], with
//     discount rows as their own negative rows. Code folds each discount into
//     its product, so a line's price is what was actually paid for it.
//  2. Text: the folded lines + shopping list -> category and list item per
//     line. Fast and cheap; if it fails the step-1 data is still returned.
// If the ANTHROPIC_API_KEY secret is set, Claude Haiku 4.5 is tried first for
// step 1.

const API = "https://trip-api.svorobovich.com";
const KEYCHECK_URL = `${API}/api/collections/keycheck/records/keycheck0000001`;

const CATEGORIES = [
  "Мясо и рыба", "Молочка и яйца", "Овощи и зелень", "Фрукты", "Бакалея",
  "Снеки", "Гриль и быт", "Напитки и алкоголь", "Жильё",
  "Транспорт и бензин", "Другое",
];
const CATEGORY_HINTS = [
  "meat, fish, sausages, cold cuts", "milk, cheese, yoghurt, butter, eggs",
  "vegetables, potatoes, salad, herbs, mushrooms", "fruit",
  "dry goods: bread, sugar, flour, oil, cereal, granola, coffee, tea, sauces, spices",
  "chips, crisps, nuts, crackers, sweets, chocolate", "charcoal, lighter fluid, foil, trays, paper towels, bin bags, napkins, cleaning, hygiene",
  "water, juice, soda, beer, wine, spirits", "accommodation", "fuel, parking, tolls, transport",
  "anything else",
];
// Short keys the step-2 model answers with (index-aligned with CATEGORIES);
// words, not numbers, so they can't be mixed up with list numbers.
const CATEGORY_KEYS = ["meat", "dairy", "veg", "fruit", "grocery", "snacks", "household", "drinks", "stay", "transport", "other"];
const UNITS = new Set(["kg", "g", "l", "ml", "szt"]);

// Step 1, tried in parallel: the first is the main model; the second is a
// fast fallback that is only used if the main one fails or its lines are
// clearly worse.
const VISION_MODELS = ["@cf/qwen/qwen3.8-27b", "@cf/google/gemma-4-26b-a4b-it"];
// Step 2 (text only). The first is the default (best matches in tests), the
// second a faster retry if it errors; any of them can be pinned.
const MATCH_MODELS = [
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/zai-org/glm-4.7-flash",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/qwen/qwen3.8-27b",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
];
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

// Neurons per million tokens [input, output] (developers.cloudflare.com/workers-ai/platform/pricing).
const NEURONS = {
  "@cf/qwen/qwen3.8-27b": [40909, 290909],
  "@cf/google/gemma-4-26b-a4b-it": [9091, 27273],
  "@cf/zai-org/glm-4.7-flash": [5500, 36400],
  "@cf/qwen/qwen3-30b-a3b-fp8": [4625, 30475],
  "@cf/meta/llama-4-scout-17b-16e-instruct": [24545, 77273],
};

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_JSON_BYTES = 256 * 1024;
const IMAGE_URL_HOST = "trip-api.svorobovich.com";
const IMAGE_URL_PREFIX = `https://${IMAGE_URL_HOST}/api/files/`;
const IMAGE_FETCH_TIMEOUT_MS = 10000;
const MAX_ITEMS = 200;
const MAX_LINES = 100;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const KEY_CACHE_MS = 10 * 60 * 1000;
const KEYCHECK_TIMEOUT_MS = 5000;
const VISION_TIMEOUT_MS = 50000;   // main model; a 31-line receipt takes ~25-30 s
const PINNED_TIMEOUT_MS = 75000;   // a pinned model has no fallback, so wait longer
const MATCH_TIMEOUT_MS = 15000;
const HEDGE_MS = 30000;            // start the fallback vision model if the main one is this slow

const validKeys = new Map(); // key -> expiry (ms), per isolate

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/scan" || url.pathname === "/scan/") {
      try {
        return await handleScan(request, env);
      } catch (e) {
        console.error("scan failed", e && e.stack || e);
        return json({ error: "internal error" }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleScan(request, env) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, { Allow: "POST" });
  }

  const key = request.headers.get("X-Trip-Key") || "";
  if (!(await keyIsValid(key))) return json({ error: "invalid trip key" }, 401);

  const ctype = (request.headers.get("Content-Type") || "").toLowerCase();
  const input = ctype.startsWith("multipart/form-data") ? await readMultipart(request)
    : ctype.startsWith("application/json") ? await readJsonBody(request)
    : { error: json({ error: "expected multipart/form-data or application/json" }, 415) };
  if (input.error) return input.error;
  const { bytes, mime, items, pinned, matchPinned } = input;

  // ---- step 1: vision ----
  const t0 = Date.now();
  const v = await recognise(env, mime, toBase64(bytes), VISION_MODELS.includes(pinned) ? pinned : null);
  const visionMs = Date.now() - t0;
  if (!v.ok) return json({ error: "recognition failed", details: v.errors }, 502);
  const r = v.result;

  // ---- step 2: categories + shopping-list matches ----
  const t1 = Date.now();
  let match = null, matchError = null, matchModel = null;
  // Default model, then the next one if the first errors early; one shared
  // deadline so a slow step 2 never holds the step-1 result for long.
  const matchModels = MATCH_MODELS.includes(matchPinned) ? [matchPinned] : MATCH_MODELS.slice(0, 2);
  for (const m of r.lines.length ? matchModels : []) {
    const left = MATCH_TIMEOUT_MS - (Date.now() - t1);
    if (left < 3000) break;
    try {
      match = await withTimeout(matchLines(env.AI, m, r.lines, items), left);
      matchModel = m;
      break;
    } catch (e) {
      matchError = `${m}: ${String(e.message || e).slice(0, 200)}`;
      console.warn("match failed", matchError);
    }
  }
  if (match) matchError = null;
  const matchMs = Date.now() - t1;

  const lines = r.lines.map((l, i) => ({
    text: l.text, qty: l.qty, unit: l.unit, price: l.price,
    category: match ? match.cats[i] : null,
    item_id: match ? match.ids[i] : null,
  }));

  // Top-level category: the one holding the most money.
  const bySum = new Map();
  for (const l of lines) if (l.category && l.price > 0) bySum.set(l.category, (bySum.get(l.category) || 0) + l.price);
  let category = null, best = 0;
  for (const [c, s] of bySum) if (s > best) { best = s; category = c; }

  const matched = [...new Set(lines.map((l) => l.item_id).filter(Boolean))];

  const usage = { vision: v.usage };
  if (match) usage.match = match.usage;
  const out = {
    provider: r.provider,
    model: r.model,
    total: r.total,
    currency: "PLN",
    store: r.store,
    date: r.date,
    category,
    lines,
    // Sanity check for per-line splitting: models sometimes drop or repeat
    // lines on long receipts even when the total is right.
    lines_sum: r.lines_sum,
    lines_ok: r.lines_ok,
    matched,
    match_model: match ? matchModel : null,
    timings: { vision_ms: visionMs, match_ms: matchMs },
    neurons: Math.round(neuronsOf(v.usage) + (match ? neuronsOf([match.usage]) : 0)),
  };
  if (v.fallback) out.fallback = v.fallback;
  if (r.notes.length) out.notes = r.notes;
  if (matchError) out.match_error = matchError;
  return json(out);
}

// ---------- input modes ----------

// Multipart: image file + optional items/model/match_model fields (the app).
async function readMultipart(request) {
  const fail = (body, status) => ({ error: json(body, status) });
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_IMAGE_BYTES + 512 * 1024) return fail({ error: "image too large (max 6 MB)" }, 413);

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return fail({ error: "bad multipart body" }, 400);
  }

  const image = form.get("image");
  if (!image || typeof image === "string") return fail({ error: "missing image file" }, 400);
  if (image.size > MAX_IMAGE_BYTES) return fail({ error: "image too large (max 6 MB)" }, 413);
  if (image.size === 0) return fail({ error: "empty image" }, 400);
  const bytes = new Uint8Array(await image.arrayBuffer());
  const mime = sniffImage(bytes) || (image.type || "").toLowerCase();
  if (!IMAGE_TYPES.has(mime)) return fail({ error: "image must be JPEG, PNG or WebP" }, 415);

  let items = [];
  const rawItems = form.get("items");
  if (typeof rawItems === "string" && rawItems.trim()) {
    try {
      items = parseItems(JSON.parse(rawItems));
    } catch (_) {
      return fail({ error: "items must be a JSON array of {id, name, pl}" }, 400);
    }
  }
  return { bytes, mime, items, pinned: form.get("model"), matchPinned: form.get("match_model") };
}

// JSON: {"image_url", "items"?, "model"?, "match_model"?} (the server-side
// cron hook). The image is fetched from PocketBase's file API only.
async function readJsonBody(request) {
  const fail = (body, status) => ({ error: json(body, status) });
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_JSON_BYTES) return fail({ error: "body too large" }, 413);
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_JSON_BYTES) return fail({ error: "body too large" }, 413);
    body = JSON.parse(text);
  } catch (_) {
    return fail({ error: "bad JSON body" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail({ error: "bad JSON body" }, 400);

  let items = [];
  if (body.items != null) {
    try {
      items = parseItems(body.items);
    } catch (_) {
      return fail({ error: "items must be a JSON array of {id, name, pl}" }, 400);
    }
  }

  const url = imageUrlAllowed(body.image_url);
  if (!url) return fail({ error: `image_url must start with ${IMAGE_URL_PREFIX}` }, 400);
  const got = await fetchImage(url);
  if (got.error) return fail({ error: got.error }, got.status);
  return {
    bytes: got.bytes, mime: got.mime, items,
    pinned: typeof body.model === "string" ? body.model : null,
    matchPinned: typeof body.match_model === "string" ? body.match_model : null,
  };
}

// Parsed-URL check against the one allowed origin and path prefix (dot
// segments and %2e are resolved by the parser before the check).
function imageUrlAllowed(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let u;
  try {
    u = new URL(raw);
  } catch (_) {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  if (u.hostname !== IMAGE_URL_HOST || !u.pathname.startsWith("/api/files/")) return null;
  u.hash = "";
  return u.href.startsWith(IMAGE_URL_PREFIX) ? u.href : null;
}

async function fetchImage(url) {
  let res;
  try {
    res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
  } catch (e) {
    return { error: `could not fetch image: ${String(e.message || e).slice(0, 100)}`, status: 502 };
  }
  if (res.status >= 300 && res.status < 400) return { error: "image_url redirects (not allowed)", status: 400 };
  if (res.status === 404) return { error: "image not found", status: 404 };
  if (!res.ok) return { error: `could not fetch image: HTTP ${res.status}`, status: 502 };
  if (Number(res.headers.get("Content-Length") || 0) > MAX_IMAGE_BYTES) {
    res.body && res.body.cancel();
    return { error: "image too large (max 6 MB)", status: 413 };
  }
  // Read with a hard cap: Content-Length may be missing.
  const chunks = [];
  let size = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_IMAGE_BYTES) {
        reader.cancel();
        return { error: "image too large (max 6 MB)", status: 413 };
      }
      chunks.push(value);
    }
  } catch (e) {
    return { error: `could not fetch image: ${String(e.message || e).slice(0, 100)}`, status: 502 };
  }
  if (!size) return { error: "empty image", status: 400 };
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  const mime = sniffImage(bytes);
  if (!mime) return { error: "image must be JPEG, PNG or WebP", status: 415 };
  return { bytes, mime };
}

// ---------- step 1: vision ----------

// Runs the vision models (in parallel) and picks the best result.
async function recognise(env, mime, b64, pinned) {
  const errors = [];
  const usage = [];

  if (env.ANTHROPIC_API_KEY && !pinned) {
    try {
      const raw = await withTimeout(callAnthropic(env.ANTHROPIC_API_KEY, mime, b64), VISION_TIMEOUT_MS);
      return { ok: true, result: normalise(raw.json, "anthropic", ANTHROPIC_MODEL), usage, errors };
    } catch (e) {
      console.warn("anthropic failed, falling back", String(e));
      errors.push(`anthropic: ${e.message || e}`);
    }
  }

  const models = pinned ? [pinned] : VISION_MODELS;
  const timeout = pinned ? PINNED_TIMEOUT_MS : VISION_TIMEOUT_MS;
  const run = (model) =>
    withTimeout(callVision(env.AI, model, mime, b64), timeout)
      .then((raw) => {
        usage.push({ model, ...raw.usage });
        return normalise(raw.json, "workers-ai", model);
      })
      .catch((e) => {
        console.warn("vision failed", model, String(e).slice(0, 300));
        errors.push(`${model}: ${e.message || e}`);
        return null;
      });

  // The main model reads names, prices and totals best; the fallback is much
  // weaker on long receipts. It is started only as a hedge: when the main
  // model errors, or hasn't answered after HEDGE_MS (so a hung call still
  // ends in time). Normal scans pay for one model.
  const mainP = run(models[0]);
  let altP = null, timer;
  if (models[1]) {
    const hedge = new Promise((res) => { timer = setTimeout(() => res("hedge"), HEDGE_MS); });
    if (await Promise.race([mainP, hedge]) === "hedge") altP = run(models[1]);
    clearTimeout(timer);
  }
  const main = await mainP;
  if (main && main.lines_ok) return { ok: true, result: main, usage, errors };
  if (!main && models[1] && !altP) altP = run(models[1]);
  const alt = altP ? await altP : null;

  if (!main) {
    if (!alt) return { ok: false, errors, usage };
    return { ok: true, result: alt, usage, errors, fallback: `${models[0]} failed` };
  }
  if (!alt) return { ok: true, result: main, usage, errors };

  const total = main.total ?? alt.total;
  if (total == null) return { ok: true, result: main, usage, errors };
  // 1) Cross-check: a price or row where the two readings disagree and the
  //    fallback's version makes the main lines add up (a misread digit, a
  //    dropped or doubled row).
  const fixed = crossFix(main.lines, alt.lines, total);
  if (fixed) {
    const lines = fixed.lines;
    return {
      ok: true, usage, errors,
      result: { ...main, total, lines, lines_sum: sumPrices(lines), lines_ok: true, notes: [...main.notes, ...fixed.notes] },
    };
  }
  // 2) The fallback's lines add up and the main ones don't: take its lines.
  const mainOff = main.lines_sum == null ? Infinity : Math.abs(main.lines_sum - total);
  if (alt.lines_sum != null && withinTolerance(alt.lines_sum, total) && Math.abs(alt.lines_sum - total) < mainOff) {
    return {
      ok: true, usage, errors,
      result: { ...alt, total, store: main.store || alt.store, date: main.date || alt.date, lines_ok: true },
      fallback: `${models[0]} lines off by ${round2(main.lines_sum == null ? total : main.lines_sum - total)}`,
    };
  }
  return { ok: true, result: main, usage, errors };
}

// Aligns two readings of the same receipt by name and looks for one or two
// differences (price changed, row only in one reading) whose fallback
// version makes `lines` sum to `total` within 2 grosze. Returns
// {lines, notes} or null.
function crossFix(lines, other, total) {
  const sum = sumPrices(lines);
  if (sum == null) return null;
  const need = round2(total - sum);
  const used = new Set(), pairOf = new Map(); // main index -> other index
  for (let i = 0; i < lines.length; i++) {
    let best = null;
    for (let j = 0; j < other.length; j++) {
      if (used.has(j)) continue;
      const s = similarity(lines[i].text, other[j].text) - Math.abs(i / lines.length - j / other.length) * 0.3;
      if (s >= 0.5 && (!best || s > best.s)) best = { s, j };
    }
    if (best) { used.add(best.j); pairOf.set(i, best.j); }
  }
  const cands = [];
  for (const [i, j] of pairOf) {
    const a = lines[i].price, b = other[j].price;
    if (a != null && b != null && a !== b) cands.push({ kind: "price", i, j, delta: round2(b - a) });
  }
  for (let i = 0; i < lines.length; i++) {
    if (!pairOf.has(i) && lines[i].price != null) cands.push({ kind: "drop", i, delta: -lines[i].price });
  }
  for (let j = 0; j < other.length; j++) {
    if (!used.has(j) && other[j].price != null) cands.push({ kind: "add", j, delta: other[j].price });
  }
  // Few differences only: with many, some combination would hit the total
  // by chance (and the readings are too different to trust either way).
  if (cands.length > 15) return null;
  const single = cands.find((c) => Math.abs(c.delta - need) <= 0.02);
  let pick = single ? [single] : null;
  if (!pick && cands.length <= 6) {
    outer: for (let x = 0; x < cands.length; x++) {
      for (let y = x + 1; y < cands.length; y++) {
        const a = cands[x], b = cands[y];
        if (a.i != null && a.i === b.i) continue;
        if (Math.abs(a.delta + b.delta - need) <= 0.02) { pick = [a, b]; break outer; }
      }
    }
  }
  if (!pick) return null;

  const out = lines.map((l) => ({ ...l }));
  const notes = [];
  const drop = new Set(), adds = [];
  for (const c of pick) {
    if (c.kind === "price") {
      notes.push(`price of "${out[c.i].text}" ${out[c.i].price} -> ${other[c.j].price} (second reading)`);
      out[c.i].price = other[c.j].price;
      if (out[c.i].qty == null) out[c.i].qty = other[c.j].qty;
      if (out[c.i].unit == null) out[c.i].unit = other[c.j].unit;
    } else if (c.kind === "drop") {
      notes.push(`dropped "${out[c.i].text}" ${out[c.i].price} (not in second reading)`);
      drop.add(c.i);
    } else {
      notes.push(`added "${other[c.j].text}" ${other[c.j].price} (from second reading)`);
      // Insert after the main row paired with the nearest earlier other row.
      let at = 0;
      for (const [i, j] of pairOf) if (j < c.j && i + 1 > at) at = i + 1;
      adds.push({ at, line: { ...other[c.j] } });
    }
  }
  const res = [];
  for (let i = 0; i <= out.length; i++) {
    for (const a of adds) if (a.at === i) res.push(a.line);
    if (i < out.length && !drop.has(i)) res.push(out[i]);
  }
  return { lines: res, notes };
}

// Dice coefficient on character bigrams of the normalised names.
function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map();
  for (let i = 0; i < x.length - 1; i++) { const g = x.slice(i, i + 2); grams.set(g, (grams.get(g) || 0) + 1); }
  let hit = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2), n = grams.get(g);
    if (n) { hit++; grams.set(g, n - 1); }
  }
  return (2 * hit) / (x.length + y.length - 2);
}

const VISION_PROMPT = `You read a photo of a shop receipt (usually Polish: Lidl, Auchan, Biedronka, Kaufland, Orlen, Żabka...).

Return one JSON object:
{"s": shop name (from the logo, header or company line, e.g. "Lidl", "Auchan") or null, "d": purchase date "YYYY-MM-DD" or null, "t": amount paid (SUMA / DO ZAPŁATY / RAZEM) as a number or null, "l": rows}

"l" lists every product row of the receipt exactly once, top to bottom. Each row is an array [name, qty, unit, unit_price, amount]:
- name: product name as printed, without the quantity and prices, e.g. "Banany luz".
- qty: the quantity as a number (weight for weighed goods, e.g. 2.476; piece count otherwise, e.g. 2), or null.
- unit: "kg", "g", "l", "ml", "szt", or null.
- unit_price: the price per kg or per piece printed next to the quantity ("2,476 * 3,76"), or null.
- amount: the row amount (the right-hand number) as a number, e.g. 9.31.
A discount row (OPUST, RABAT, PROMOCJA, Lidl Plus, upust...) is its own row with a negative amount, e.g. ["OPUST", null, null, null, -2.5]. If the same product is printed twice, list it twice; never repeat a row that is printed once.
Do not include totals, subtotals, tax (PTU/VAT), payment, card or change rows.

Example: {"s":"Lidl","d":"2026-09-30","t":24.79,"l":[["Banany luz",2.476,"kg",3.76,9.31],["Kiwi szt.",3,"szt",2.49,7.47],["OPUST",null,null,null,-1.5],["Folia alu.",1,"szt",9.51,9.51]]}

Answer with the JSON object only.`;

const CELL = { anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }] };
const VISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["s", "d", "t", "l"],
  properties: {
    s: { anyOf: [{ type: "string" }, { type: "null" }] },
    d: { anyOf: [{ type: "string" }, { type: "null" }] },
    t: { anyOf: [{ type: "number" }, { type: "null" }] },
    l: { type: "array", items: { type: "array", items: CELL, minItems: 5, maxItems: 5 } },
  },
};

async function callVision(ai, model, mime, b64) {
  const messages = [{
    role: "user",
    content: [
      { type: "text", text: VISION_PROMPT },
      { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
    ],
  }];
  return runJson(ai, model, { messages, temperature: 0, max_tokens: 3000 }, VISION_SCHEMA, "receipt");
}

async function callAnthropic(apiKey, mime, b64) {
  const { minItems, maxItems, ...rowSchema } = VISION_SCHEMA.properties.l.items;
  const schema = { ...VISION_SCHEMA, properties: { ...VISION_SCHEMA.properties, l: { type: "array", items: rowSchema } } };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
          { type: "text", text: VISION_PROMPT },
        ],
      }],
      output_config: { format: { type: "json_schema", schema } },
    }),
    signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  if (body.stop_reason === "refusal") throw new Error("refusal");
  if (body.stop_reason === "max_tokens") throw new Error("output truncated");
  const text = (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return { json: parseJsonLoose(text) };
}

const DISCOUNT_RE = /^\s*(opust|rabat|upust|promocja|promo\b|zni[zż]ka|obni[zż]ka|lidl\s*plus|kupon|bonus|taniej)/i;
const NOT_A_PRODUCT_RE = /^\s*(suma|razem|do\s+zap[lł]aty|sprzeda[zż]\s+opodatk|ptu|vat\b|kwota\s+ptu|karta|got[oó]wka|reszta|p[lł]atno[sś][cć])/i;

// Raw step-1 output -> {store, date, total, lines:[{text, qty, unit, price}],
// lines_sum, lines_ok, notes}. Discount rows are folded into their product.
function normalise(raw, provider, model) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("model output is not an object");
  const notes = [];

  let total = toNumber(raw.t ?? raw.total);
  total = total != null && total > 0 && total < 1e6 ? round2(total) : null;

  const rows = [];
  for (const r of (Array.isArray(raw.l) ? raw.l : Array.isArray(raw.lines) ? raw.lines : []).slice(0, MAX_LINES * 2)) {
    let name, qty, unit, each, price;
    if (Array.isArray(r)) [name, qty, unit, each, price] = r.length >= 5 ? r : [r[0], r[1], r[2], null, r[3]];
    else if (r && typeof r === "object") ({ text: name, qty, unit, price } = r);
    if (typeof name !== "string" || !name.trim()) continue;
    name = name.trim().slice(0, 120);
    if (NOT_A_PRODUCT_RE.test(name)) continue;
    price = toNumber(price);
    if (price != null) price = round2(price);
    qty = cleanQty(qty);
    each = toNumber(each);
    // qty x unit price is a second reading of the amount; kept to repair a
    // misread amount when the lines don't add up.
    const calc = qty != null && each != null && each > 0 ? round2(qty * each) : null;
    const discount = DISCOUNT_RE.test(name) || (price != null && price < 0);
    if (price == null && calc != null && !discount) price = calc;
    rows.push({
      text: name, qty, unit: cleanUnit(unit), price, discount,
      calc: !discount && calc != null && price != null && Math.abs(calc - price) > 0.02 ? calc : null,
    });
  }

  // Fold each discount into the nearest preceding product (one whose name the
  // discount row mentions, if any); a discount with nothing before it goes to
  // the next product.
  const lines = [];
  let pending = 0;
  for (const r of rows) {
    if (!r.discount) {
      const l = { text: r.text, qty: r.qty, unit: r.unit, price: r.price, calc: r.calc };
      if (pending && l.price != null) {
        l.price = round2(l.price + pending);
        if (l.calc != null) l.calc = round2(l.calc + pending);
        pending = 0;
      }
      lines.push(l);
      continue;
    }
    if (r.price == null) continue;
    const amount = -Math.abs(r.price);
    const rest = norm(r.text.replace(DISCOUNT_RE, ""));
    let target = null;
    if (rest.length >= 3) {
      for (let i = lines.length - 1; i >= 0 && i >= lines.length - 8; i--) {
        const n = norm(lines[i].text);
        if (lines[i].price != null && n && (rest.includes(n) || n.includes(rest))) { target = lines[i]; break; }
      }
    }
    if (!target) for (let i = lines.length - 1; i >= 0; i--) if (lines[i].price != null) { target = lines[i]; break; }
    if (target) {
      target.price = round2(target.price + amount);
      if (target.calc != null) target.calc = round2(target.calc + amount);
    }
    else pending = round2(pending + amount);
  }
  if (lines.length > MAX_LINES) lines.length = MAX_LINES;

  let linesSum = sumPrices(lines);
  if (total != null && linesSum != null && !withinTolerance(linesSum, total)) {
    // A misread amount: qty x unit price disagrees with it, and using the
    // product instead makes the lines add up.
    const byCalc = useCalc(lines, total);
    // Long receipts sometimes come back with a row (or a run of rows)
    // repeated: drop repeats only when that makes the sum match exactly.
    const fixed = byCalc ? null : dropRepeats(lines, total);
    if (byCalc) {
      for (const i of byCalc) {
        notes.push(`amount of "${lines[i].text}" ${lines[i].price} -> ${lines[i].calc} (qty x unit price)`);
        lines[i].price = lines[i].calc;
      }
      linesSum = sumPrices(lines);
    } else if (fixed) {
      notes.push(`dropped ${lines.length - fixed.length} repeated row(s)`);
      lines.length = 0;
      lines.push(...fixed);
      linesSum = sumPrices(lines);
    }
  }
  for (const l of lines) delete l.calc;

  const store = typeof (raw.s ?? raw.store) === "string" && (raw.s ?? raw.store).trim()
    ? (raw.s ?? raw.store).trim().slice(0, 60) : null;

  return {
    provider, model, total, store,
    date: cleanDate(raw.d ?? raw.date),
    lines,
    lines_sum: linesSum,
    lines_ok: total != null && linesSum != null && withinTolerance(linesSum, total),
    notes,
  };
}

// Indexes of rows whose qty x unit price should replace the printed amount
// so the sum lands within tolerance of the total (fewest changes, then
// closest), or null.
function useCalc(lines, total) {
  const idx = lines.map((l, i) => (l.calc != null && l.price != null ? i : -1)).filter((i) => i >= 0);
  if (!idx.length || idx.length > 8) return null;
  const sum = sumPrices(lines);
  let best = null;
  for (let mask = 1; mask < 1 << idx.length; mask++) {
    const pick = idx.filter((_, k) => mask & (1 << k));
    const s = round2(sum + pick.reduce((t, i) => t + lines[i].calc - lines[i].price, 0));
    if (!withinTolerance(s, total)) continue;
    const off = Math.abs(s - total);
    if (!best || pick.length < best.pick.length || (pick.length === best.pick.length && off < best.off)) best = { pick, off };
  }
  return best && best.off < Math.abs(sum - total) ? best.pick : null;
}

function sumPrices(lines) {
  const priced = lines.filter((l) => l.price != null);
  return priced.length ? round2(priced.reduce((t, l) => t + l.price, 0)) : null;
}

function withinTolerance(sum, total) {
  return Math.abs(sum - total) <= Math.max(0.05, total * 0.005) + 1e-9;
}

// Finds blocks of 1..8 rows that are immediately repeated (same text and
// price) and drops the set of repeats that makes the sum match the total
// (within 2 grosze), preferring the fewest dropped rows. null if none works.
function dropRepeats(lines, total) {
  const same = (a, b) => a.text === b.text && a.price === b.price;
  const cands = [];
  for (let len = 1; len <= 8; len++) {
    for (let i = 0; i + 2 * len <= lines.length; i++) {
      let ok = true;
      for (let k = 0; k < len && ok; k++) ok = same(lines[i + k], lines[i + len + k]);
      if (!ok) continue;
      const amount = lines.slice(i + len, i + 2 * len).reduce((t, l) => t + (l.price || 0), 0);
      cands.push({ start: i + len, len, amount });
    }
  }
  if (!cands.length || cands.length > 14) return null;
  const sum = sumPrices(lines);
  let best = null;
  for (let mask = 1; mask < 1 << cands.length; mask++) {
    const chosen = cands.filter((_, j) => mask & (1 << j));
    const drop = new Set();
    let overlap = false;
    for (const c of chosen) for (let k = c.start; k < c.start + c.len; k++) { if (drop.has(k)) overlap = true; drop.add(k); }
    if (overlap) continue;
    const s = round2(sum - chosen.reduce((t, c) => t + c.amount, 0));
    if (Math.abs(s - total) > 0.02) continue;
    if (!best || drop.size < best.size) best = drop;
  }
  return best ? lines.filter((_, i) => !best.has(i)) : null;
}

// ---------- step 2: categories and shopping-list matches ----------

const MATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["r"],
  properties: {
    r: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["i", "c", "m"],
        properties: {
          i: { type: "integer" },
          c: { type: "string", enum: CATEGORY_KEYS },
          m: { anyOf: [{ type: "integer" }, { type: "null" }] },
        },
      },
    },
  },
};

function matchPrompt(lines, items) {
  const cats = CATEGORY_KEYS.map((k, i) => `${k}: ${CATEGORY_HINTS[i]}`).join("\n");
  const list = items.length ? items.map((it, i) => `${i + 1}: ${it.name} / ${it.pl}`).join("\n") : "(empty)";
  const rows = lines.map((l, i) => `${i}: ${l.text}`).join("\n");
  return `Rows from a Polish shop receipt (names are abbreviated, e.g. "Ziem." = ziemniaczane, "grunt." = gruntowe, "luz" = loose) must be matched to a shopping list (Russian name / Polish name) and given a spending category.

Categories:
${cats}

Shopping list:
${list}

Receipt rows:
${rows}

Return {"r":[{"i": row number, "c": category key, "m": shopping-list number or null}, ...]} with one entry per receipt row, in order. "c" is always one of the category keys above.

Rules for "m":
- Use a list number only when the row is clearly that same product. Another size, variety, brand or the plural is fine ("Pomidory kiść 500g" is Помидоры, "Lay's Chipsy" is Чипсы, "Szczypiorek" is the herbs item when the list item mentions szczypiorek).
- A different product is not a match even if related: cherry tomatoes are not Помидоры, potato chips are not Картофель, carrots are not Огурцы. When unsure, use null.
- Names may have OCR errors (a wrong first letter, missing Polish accents). Check that the size fits the product: a non-drink row with litres ("60l", "35l") is bags, e.g. "Morki z tasma 60l" is "Worki z taśmą 60l" (bin bags), not carrots.
- Several rows may match the same list number. Most rows match nothing; never pick a list item just because it is similar in category.

Answer with the JSON object only.`;
}

async function matchLines(ai, model, lines, items) {
  const prompt = matchPrompt(lines, items);
  const raw = await runJson(ai, model, {
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 40 + lines.length * 30,
  }, MATCH_SCHEMA, "matches");
  const cats = lines.map(() => null), ids = lines.map(() => null);
  const rows = Array.isArray(raw.json && raw.json.r) ? raw.json.r : Array.isArray(raw.json) ? raw.json : [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const i = toInt(r.i);
    if (i == null || i < 0 || i >= lines.length) continue;
    const c = CATEGORY_KEYS.indexOf(String(r.c ?? "").trim().toLowerCase());
    if (c >= 0) cats[i] = CATEGORIES[c];
    const m = toInt(r.m);
    if (m != null && m >= 1 && m <= items.length) ids[i] = items[m - 1].id;
  }
  return { cats, ids, usage: { model, ...raw.usage } };
}

// ---------- Workers AI ----------

// Structured output first; plain JSON-by-prompt if the model rejects it.
async function runJson(ai, model, base, schema, name) {
  const attempts = [
    {
      ...base,
      response_format: { type: "json_schema", json_schema: { name, schema, strict: true } },
      chat_template_kwargs: { enable_thinking: false },
    },
    { ...base, chat_template_kwargs: { enable_thinking: false } },
  ];
  let lastErr;
  for (const input of attempts) {
    try {
      const out = await ai.run(model, input);
      const u = out && out.usage || {};
      return {
        json: parseJsonLoose(extractText(out)),
        usage: { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 },
      };
    } catch (e) {
      lastErr = e;
      console.warn("workers-ai attempt failed", model, String(e).slice(0, 300));
    }
  }
  throw lastErr;
}

function neuronsOf(usages) {
  let n = 0;
  for (const u of usages || []) {
    const r = NEURONS[u.model];
    if (r) n += (u.in * r[0] + u.out * r[1]) / 1e6;
  }
  return n;
}

function extractText(out) {
  if (out == null) throw new Error("empty model output");
  if (typeof out === "string") return out;
  if (typeof out.response === "string") return out.response;
  if (out.response && typeof out.response === "object") return JSON.stringify(out.response);
  const msg = out.choices && out.choices[0] && out.choices[0].message;
  if (msg) {
    if (typeof msg.content === "string" && msg.content.trim()) return msg.content;
    if (Array.isArray(msg.content)) return msg.content.map((p) => p.text || "").join("");
  }
  throw new Error("unrecognised model output shape");
}

// ---------- auth ----------

async function keyIsValid(key) {
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(key)) return false;
  const exp = validKeys.get(key);
  if (exp && exp > Date.now()) return true;
  let res;
  try {
    res = await fetch(KEYCHECK_URL, {
      headers: { "X-Trip-Key": key },
      signal: AbortSignal.timeout(KEYCHECK_TIMEOUT_MS),
    });
  } catch (e) {
    console.warn("keycheck unreachable", String(e));
    return false;
  }
  if (res.status === 200) {
    validKeys.set(key, Date.now() + KEY_CACHE_MS);
    return true;
  }
  return false;
}

// ---------- input ----------

function parseItems(arr) {
  if (!Array.isArray(arr)) throw new Error("not an array");
  const out = [];
  for (const it of arr.slice(0, MAX_ITEMS)) {
    if (!it || typeof it !== "object") continue;
    const id = String(it.id ?? "").trim();
    if (!id || id.length > 40) continue;
    out.push({
      id,
      name: String(it.name ?? "").slice(0, 120),
      pl: String(it.pl ?? "").slice(0, 120),
    });
  }
  return out;
}

function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

function toBase64(bytes) {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

// ---------- output helpers ----------

function parseJsonLoose(text) {
  let t = String(text).replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(t);
  } catch (_) {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("model did not return JSON");
  }
}

function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/\s/g, "").replace(/(PLN|zł|zl)$/i, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

function toInt(v) {
  const n = toNumber(v);
  return n != null && Number.isInteger(n) ? n : null;
}

function cleanQty(v) {
  const n = toNumber(v);
  return n != null && n > 0 && n < 10000 ? Math.round(n * 1000) / 1000 : null;
}

function cleanUnit(v) {
  if (typeof v !== "string") return null;
  const u = v.trim().toLowerCase().replace(/\.$/, "");
  return UNITS.has(u) ? u : u === "szt." || u === "pcs" || u === "st" ? "szt" : null;
}

const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

const round2 = (n) => Math.round(n * 100) / 100;

function cleanDate(v) {
  if (typeof v !== "string") return null;
  let m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    const p = v.trim().match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})/);
    if (p) m = [null, p[3], p[2], p[1]];
  }
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  if (+m[1] < 2000 || +m[1] > 2100) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// ---------- utils ----------

function withTimeout(promise, ms) {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout after ${ms} ms`)), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
