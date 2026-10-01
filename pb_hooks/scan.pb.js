/// <reference path="../pb_data/types.d.ts" />

// Background receipt scan (logic in scan_lib.js).
//
// - API create/update of an expense with a new JPEG/PNG/WebP receipt (status
//   "" or "pending") -> scan_status "pending". Setting scan_status back to
//   "pending" re-queues. Other edits never queue, so old expenses stay as is.
// - Every minute: up to 2 pending expenses -> "running" -> Worker POST /scan
//   -> "done" (lines, scanned_at; amount/category/title only if empty) or
//   "failed" (one automatic retry ~5 min later). "running" > 5 min -> "pending".

onRecordCreateRequest((e) => {
  require(`${__hooks}/scan_lib.js`).queueOnRequest(e, true);
  e.next();
}, "expenses");

onRecordUpdateRequest((e) => {
  require(`${__hooks}/scan_lib.js`).queueOnRequest(e, false);
  e.next();
}, "expenses");

cronAdd("trip_receipt_scan", "* * * * *", () => {
  try {
    require(`${__hooks}/scan_lib.js`).tick($app);
  } catch (err) {
    console.log(`[scan] tick error: ${err}`);
  }
});
