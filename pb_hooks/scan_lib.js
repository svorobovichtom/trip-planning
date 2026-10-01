/// <reference path="../pb_data/types.d.ts" />

// Background receipt scan, used by scan.pb.js. Loaded with require() inside
// each handler (PocketBase runs handlers in isolated runtimes, so top-level
// code of scan.pb.js is not visible to them).
//
// Flow: an API create/update that brings a receipt image (or sets
// scan_status = "pending") queues the expense; the cron job sends the
// receipt's public URL to the Worker's POST /scan and writes the result back.

const SCAN_URL = $os.getenv("TRIP_SCAN_URL") || "https://trip-planning.svorobovichtom.workers.dev/scan";
const API_URL = ($os.getenv("TRIP_API_URL") || "https://trip-api.svorobovich.com").replace(/\/+$/, "");
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const BATCH = 2;              // expenses per cron tick
const TIMEOUT_S = 100;        // Worker call
const STUCK_MS = 5 * 60e3;    // "running" longer than this -> back to "pending"
const RETRY_MS = 5 * 60e3;    // one automatic retry this long after a failure
const MAX_ATTEMPTS = 2;

function log(msg) {
  console.log(`[scan] ${msg}`);
}

// PocketBase stores dates as "2006-01-02 15:04:05.000Z".
function pbDate(ms) {
  return new Date(ms).toISOString().replace("T", " ");
}

// Request hooks: decide whether this create/update queues a scan. Runs before
// the save, so the response and the realtime event already say "pending".
function queueOnRequest(e, isCreate) {
  const r = e.record;
  const status = r.getString("scan_status");
  const fresh = r.getUnsavedFiles("receipt").filter(Boolean);
  const newName = fresh.length ? fresh[fresh.length - 1].name : "";
  const receipt = newName || r.getString("receipt");
  const isImage = IMAGE_RE.test(receipt);

  let queue = false;
  if (isCreate) {
    queue = receipt !== "" && (status === "" || status === "pending");
  } else {
    const before = r.original().getString("scan_status");
    // A new receipt file, or an explicit (re)request. Plain edits of old
    // expenses (title, split, ...) never queue anything.
    queue = (newName !== "" && status !== "done" && status !== "running")
      || (newName !== "" && status === before)
      || (status === "pending" && before !== "pending");
  }

  if (!receipt) {
    if (status === "pending" || status === "running") r.set("scan_status", "");
    return;
  }
  if (!queue) return;
  r.set("scan_attempts", 0);
  if (!isImage) {
    r.set("scan_status", status === "pending" ? "failed" : "");
    r.set("scan_error", status === "pending" ? "unsupported_format" : "");
    return;
  }
  r.set("scan_status", "pending");
  r.set("scan_error", "");
}

// Cron: recover stuck jobs, re-queue the single retry, then scan up to BATCH.
function tick(app) {
  const now = Date.now();

  const stuck = app.findRecordsByFilter("expenses",
    "scan_status = 'running' && updated < {:t}", "", 20, 0, { t: pbDate(now - STUCK_MS) });
  for (const r of stuck) {
    r.set("scan_status", "pending");
    app.save(r);
    log(`${r.id}: stuck in running, re-queued`);
  }

  const retry = app.findRecordsByFilter("expenses",
    "scan_status = 'failed' && scan_attempts > 0 && scan_attempts < {:max} && scan_error != 'unsupported_format' && receipt != '' && updated < {:t}",
    "", 20, 0, { max: MAX_ATTEMPTS, t: pbDate(now - RETRY_MS) });
  for (const r of retry) {
    r.set("scan_status", "pending");
    app.save(r);
    log(`${r.id}: automatic retry queued`);
  }

  const pending = app.findRecordsByFilter("expenses",
    "scan_status = 'pending' && receipt != ''", "updated", BATCH, 0);
  if (!pending.length) return;

  let items = null;
  for (const p of pending) {
    // Re-read: an earlier scan in this tick took a while.
    let r;
    try { r = app.findRecordById("expenses", p.id); } catch (_) { continue; }
    if (r.getString("scan_status") !== "pending") continue;
    const receipt = r.getString("receipt");
    if (!IMAGE_RE.test(receipt)) {
      finishFailed(app, r, "unsupported_format", true);
      continue;
    }
    if (items === null) {
      items = app.findAllRecords("items").map((i) => ({
        id: i.id, name: i.getString("name"), pl: i.getString("pl"),
      }));
    }
    r.set("scan_status", "running");
    r.set("scan_attempts", r.getInt("scan_attempts") + 1);
    app.save(r);
    scanOne(app, r.id, r.collection().id, receipt, items);
  }
}

function scanOne(app, id, collectionId, receipt, items) {
  const imageUrl = `${API_URL}/api/files/${collectionId}/${id}/${receipt}`;
  const t0 = Date.now();
  let res = null, err = "";
  try {
    res = $http.send({
      method: "POST",
      url: SCAN_URL,
      headers: { "Content-Type": "application/json", "X-Trip-Key": $os.getenv("TRIP_KEY") },
      body: JSON.stringify({ image_url: imageUrl, items }),
      timeout: TIMEOUT_S,
    });
  } catch (e) {
    err = `request: ${String(e && e.message || e)}`;
  }
  const ms = Date.now() - t0;
  let data = null;
  if (res) {
    data = res.json;
    if (res.statusCode !== 200) {
      const msg = data && data.error ? String(data.error) : "";
      err = `http ${res.statusCode}${msg ? ": " + msg : ""}`;
    } else if (!data || !Array.isArray(data.lines)) {
      err = "bad response";
    }
  }

  // Re-read: someone may have edited the expense (or replaced the receipt)
  // while the Worker was busy.
  let r;
  try { r = app.findRecordById("expenses", id); } catch (_) { log(`${id}: deleted during scan`); return; }
  if (r.getString("scan_status") !== "running" || r.getString("receipt") !== receipt) {
    log(`${id}: changed during scan, result dropped`);
    return;
  }
  if (err) {
    finishFailed(app, r, err.slice(0, 200), false);
    log(`${id}: failed in ${ms} ms (attempt ${r.getInt("scan_attempts")}): ${err.slice(0, 200)}`);
    return;
  }

  // JSON from $http is a plain JS value; round-trip it so it stores cleanly.
  const lines = JSON.parse(JSON.stringify(data.lines));
  r.set("lines", lines);
  r.set("scanned_at", new DateTime());
  r.set("scan_status", "done");
  r.set("scan_error", data.lines_ok === false ? "lines_mismatch" : "");

  const total = Number(data.total);
  if (r.getFloat("amount") === 0 && isFinite(total) && total > 0 && total <= 1000000) {
    r.set("amount", Math.round(total * 100) / 100);
  }
  const cat = typeof data.category === "string" ? data.category : "";
  if (!r.getString("category") && cat) {
    const allowed = r.collection().fields.getByName("category").values;
    if (allowed.indexOf(cat) >= 0) r.set("category", cat);
  }
  const store = typeof data.store === "string" ? data.store.trim().slice(0, 120) : "";
  if (!r.getString("title") && store) r.set("title", store);

  try {
    app.save(r);
  } catch (e) {
    const reason = `save: ${String(e && e.message || e)}`.slice(0, 200);
    log(`${id}: ${reason}`);
    try {
      const again = app.findRecordById("expenses", id);
      finishFailed(app, again, reason, true);
    } catch (_) {}
    return;
  }
  log(`${id}: done in ${ms} ms, ${lines.length} lines, total ${data.total}, lines_ok ${data.lines_ok}`);
}

function finishFailed(app, r, reason, final) {
  r.set("scan_status", "failed");
  r.set("scan_error", reason);
  if (final) r.set("scan_attempts", MAX_ATTEMPTS);
  app.save(r);
}

module.exports = { queueOnRequest, tick };
