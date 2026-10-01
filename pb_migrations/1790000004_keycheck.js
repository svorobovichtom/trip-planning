/// <reference path="../pb_data/types.d.ts" />

// One-record collection the Worker uses to check a trip key without writing
// anything: GET /api/collections/keycheck/records/keycheck0000001 with
// X-Trip-Key returns 200 for the right key and 404 otherwise.

const ID = "keycheck0000001";

migrate((app) => {
  const key = $os.getenv("TRIP_KEY");
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(key)) {
    throw new Error("TRIP_KEY env var must be 12-64 chars of [A-Za-z0-9_-]");
  }

  const col = new Collection({
    type: "base",
    name: "keycheck",
    listRule: null,
    viewRule: `@request.headers.x_trip_key = "${key}"`,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [{ type: "text", name: "note", max: 40 }],
  });
  app.save(col);

  const rec = new Record(col);
  rec.set("id", ID);
  rec.set("note", "ok");
  app.save(rec);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("keycheck")); } catch (_) {}
});
