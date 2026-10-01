// Worker in front of the static site. Static files in web/ are served by the
// assets layer; only /scan (see run_worker_first in wrangler.jsonc) and paths
// with no matching file reach this code.
//
// POST /scan  (multipart/form-data, header X-Trip-Key)
//   image  JPEG/PNG/WebP, <= 6 MB
//   items  optional JSON [{id, name, pl}] of unchecked shopping-list items
// -> { provider, model, total, currency, store, date, category, lines, matched }
//
// Recognition runs on Workers AI. If the ANTHROPIC_API_KEY secret is set,
// Claude Haiku 4.5 is tried first and Workers AI is the fallback.

const API = "https://trip-api.svorobovich.com";
const KEYCHECK_URL = `${API}/api/collections/keycheck/records/keycheck0000001`;

const CATEGORIES = [
  "Мясо и рыба", "Молочка и яйца", "Овощи и зелень", "Фрукты", "Бакалея",
  "Снеки", "Гриль и быт", "Напитки и алкоголь", "Жильё",
  "Транспорт и бензин", "Другое",
];

// Tried in order; the second is a cheaper fallback if the first errors.
const WORKERS_AI_MODELS = ["@cf/qwen/qwen3.8-27b", "@cf/google/gemma-4-26b-a4b-it"];
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_ITEMS = 200;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const KEY_CACHE_MS = 10 * 60 * 1000;
const KEYCHECK_TIMEOUT_MS = 5000;
const MODEL_TIMEOUT_MS = 45000;

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

  const ctype = request.headers.get("Content-Type") || "";
  if (!ctype.toLowerCase().startsWith("multipart/form-data")) {
    return json({ error: "expected multipart/form-data" }, 415);
  }
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_IMAGE_BYTES + 512 * 1024) return json({ error: "image too large (max 6 MB)" }, 413);

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return json({ error: "bad multipart body" }, 400);
  }

  const image = form.get("image");
  if (!image || typeof image === "string") return json({ error: "missing image file" }, 400);
  if (image.size > MAX_IMAGE_BYTES) return json({ error: "image too large (max 6 MB)" }, 413);
  if (image.size === 0) return json({ error: "empty image" }, 400);
  const bytes = new Uint8Array(await image.arrayBuffer());
  const mime = sniffImage(bytes) || (image.type || "").toLowerCase();
  if (!IMAGE_TYPES.has(mime)) return json({ error: "image must be JPEG, PNG or WebP" }, 415);

  let items = [];
  const rawItems = form.get("items");
  if (typeof rawItems === "string" && rawItems.trim()) {
    try {
      items = parseItems(JSON.parse(rawItems));
    } catch (_) {
      return json({ error: "items must be a JSON array of {id, name, pl}" }, 400);
    }
  }

  const b64 = toBase64(bytes);
  const prompt = buildPrompt(items);
  const errors = [];

  if (env.ANTHROPIC_API_KEY) {
    try {
      const raw = await withTimeout(callAnthropic(env.ANTHROPIC_API_KEY, mime, b64, prompt), MODEL_TIMEOUT_MS);
      return json(finish(raw, items, "anthropic", ANTHROPIC_MODEL));
    } catch (e) {
      console.warn("anthropic failed, falling back", String(e));
      errors.push(`anthropic: ${e.message || e}`);
    }
  }

  for (const model of WORKERS_AI_MODELS) {
    try {
      const raw = await withTimeout(callWorkersAI(env.AI, model, mime, b64, prompt), MODEL_TIMEOUT_MS);
      return json(finish(raw, items, "workers-ai", model));
    } catch (e) {
      console.warn("workers-ai failed", model, String(e));
      errors.push(`${model}: ${e.message || e}`);
    }
  }

  return json({ error: "recognition failed", details: errors }, 502);
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

// ---------- prompt / schema ----------

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["store", "date", "lines", "total", "currency", "category", "matched"],
  properties: {
    store: nullable({ type: "string" }),
    date: nullable({ type: "string" }),
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "price"],
        properties: { text: { type: "string" }, price: nullable({ type: "number" }) },
      },
    },
    total: nullable({ type: "number" }),
    currency: nullable({ type: "string" }),
    category: nullable({ type: "string", enum: CATEGORIES }),
    matched: { type: "array", items: { type: "string" } },
  },
};

function buildPrompt(items) {
  const list = items.length
    ? items.map((i) => `${i.id} | ${i.name} | ${i.pl}`).join("\n")
    : "(empty)";
  return `You read a photo of a shop receipt (usually Polish: Auchan, Lidl, Biedronka, Orlen, Żabka...). Product names are abbreviated, e.g. "KARKOWKA WIEP" = pork neck, "FILET Z UDA KURCZ" = chicken thigh fillet, "POMIDOR LUZ" = loose tomatoes, "JAJKA L 30SZT" = eggs, "WEGIEL DRZEWNY" = charcoal.

Return one JSON object with these fields:
- store: shop/brand name as printed (e.g. "Auchan"), or null.
- date: purchase date as YYYY-MM-DD, or null if not readable.
- lines: every purchased product line in order: {"text": product name as printed (without quantity/unit price), "price": final line amount as a number, e.g. 59.64}. Discount lines (RABAT/OPUST) get a negative price. Do not include totals, tax (PTU/VAT), payment or change lines.
- total: the amount paid (SUMA / DO ZAPŁATY / RAZEM) as a number with a dot decimal separator, or null.
- currency: ISO code, normally "PLN".
- category: the one category that covers most of the money, exactly one of: ${CATEGORIES.map((c) => `"${c}"`).join(", ")}; null if unclear. Fuel stations -> "Транспорт и бензин".
- matched: ids from the shopping list below whose product clearly appears among the receipt lines. Each list row is "id | Russian name | Polish name". Only include an id when you are confident; similar but different products do not count (cherry tomatoes are not tomatoes). Use [] if nothing matches.

Shopping list:
${list}

Answer with the JSON object only.`;
}

// ---------- providers ----------

async function callWorkersAI(ai, model, mime, b64, prompt) {
  const messages = [{
    role: "user",
    content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
    ],
  }];
  const base = { messages, temperature: 0, max_tokens: 2000 };
  const attempts = [
    {
      ...base,
      response_format: { type: "json_schema", json_schema: { name: "receipt", schema: SCHEMA, strict: true } },
      chat_template_kwargs: { enable_thinking: false },
    },
    { ...base, chat_template_kwargs: { enable_thinking: false } },
    base,
  ];
  let lastErr;
  for (const input of attempts) {
    try {
      const out = await ai.run(model, input);
      const text = extractText(out);
      return parseJsonLoose(text);
    } catch (e) {
      lastErr = e;
      console.warn("workers-ai attempt failed", model, String(e).slice(0, 300));
    }
  }
  throw lastErr;
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

async function callAnthropic(apiKey, mime, b64, prompt) {
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
          { type: "text", text: prompt },
        ],
      }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  if (body.stop_reason === "refusal") throw new Error("refusal");
  if (body.stop_reason === "max_tokens") throw new Error("output truncated");
  const text = (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseJsonLoose(text);
}

// ---------- output ----------

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

function finish(raw, items, provider, model) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("model output is not an object");

  let total = toNumber(raw.total);
  total = total != null && total > 0 && total < 1e6 ? round2(total) : null;

  const lines = (Array.isArray(raw.lines) ? raw.lines : [])
    .filter((l) => l && typeof l === "object" && typeof l.text === "string" && l.text.trim())
    .slice(0, 100)
    .map((l) => {
      const p = toNumber(l.price);
      return { text: l.text.trim().slice(0, 120), price: p == null ? null : round2(p) };
    });

  const store = typeof raw.store === "string" && raw.store.trim() ? raw.store.trim().slice(0, 60) : null;
  const category = CATEGORIES.includes(raw.category) ? raw.category : null;

  const ids = new Set(items.map((i) => i.id));
  const byName = new Map(items.map((i) => [i.name.toLowerCase(), i.id]));
  const matched = [];
  for (const m of Array.isArray(raw.matched) ? raw.matched : []) {
    const s = String(m).trim();
    const id = ids.has(s) ? s : byName.get(s.toLowerCase());
    if (id && !matched.includes(id)) matched.push(id);
  }

  return {
    provider,
    model,
    total,
    currency: "PLN",
    store,
    date: cleanDate(raw.date),
    category,
    lines,
    matched,
  };
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
