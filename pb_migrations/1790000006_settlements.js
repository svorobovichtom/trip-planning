/// <reference path="../pb_data/types.d.ts" />

// Settle-up tracking («переведено»): one row per money transfer between two
// people, made outside the app (bank, BLIK, cash) and marked here.
//
// settlements:
//   from     who sent the money (people)
//   to       who received it (people)
//   amount   GROSZE, integer >= 1 (1 zł = 100), unlike expenses.amount (PLN)
//   note     optional
//   created  when it was marked
// In the ledger a transfer counts like a payment from `from` to `to`:
// bal[from] += amount, bal[to] -= amount (app/src/lib/ledger.ts).
// Rows are never edited: a wrong one is deleted («отменить») and marked again.
// People stay deletable only when nobody references them (no cascade), so a
// balance can't silently change.

function writeRule() {
  const key = $os.getenv("TRIP_KEY");
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(key)) {
    throw new Error("TRIP_KEY env var must be 12-64 chars of [A-Za-z0-9_-]");
  }
  return `@request.headers.x_trip_key = "${key}"`;
}

migrate((app) => {
  const W = writeRule();
  const people = app.findCollectionByNameOrId("people");
  const settlements = new Collection({
    type: "base",
    name: "settlements",
    listRule: "",
    viewRule: "",
    createRule: `${W} && @request.body.from != @request.body.to`,
    updateRule: null,
    deleteRule: W,
    fields: [
      { type: "relation", name: "from", required: true, collectionId: people.id, maxSelect: 1, cascadeDelete: false },
      { type: "relation", name: "to", required: true, collectionId: people.id, maxSelect: 1, cascadeDelete: false },
      { type: "number", name: "amount", required: true, onlyInt: true, min: 1, max: 100000000 },
      { type: "text", name: "note", max: 200 },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_settlements_created ON settlements (created)"],
  });
  app.save(settlements);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("settlements")); } catch (_) {}
});
