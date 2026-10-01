/// <reference path="../pb_data/types.d.ts" />

// Payments: receipts are read in the background (pb_hooks/scan.pb.js), an
// expense can be split equally, by amounts or by receipt lines ("claims").
//
// expenses:
//   amount         0 = not known yet (the background scan fills it)
//   category       optional, new value "Кафе и рестораны"
//   lines          [{text, qty, unit, price, category, item_id}] from the scan
//   scan_status    "" | pending | running | done | failed
//   scan_error     short reason ("lines_mismatch" = lines don't add up)
//   scanned_at     when the scan finished
//   scan_attempts  hidden, used by the hook for its single automatic retry
//   split_mode     "" | equal | amounts | claims
//   split_amounts  {"<personId>": <grosze int> | null}  (null = equal share of the rest)
// claims: one row per (expense, line index, person) — "I had this line".

const CATEGORIES = [
  "Мясо и рыба", "Молочка и яйца", "Овощи и зелень", "Фрукты", "Бакалея",
  "Снеки", "Гриль и быт", "Напитки и алкоголь", "Жильё",
  "Транспорт и бензин", "Кафе и рестораны", "Другое",
];
const OLD_CATEGORIES = CATEGORIES.filter((c) => c !== "Кафе и рестораны");

const NEW_FIELDS = [
  "lines", "scan_status", "scan_error", "scanned_at", "scan_attempts",
  "split_mode", "split_amounts",
];

function writeRule() {
  const key = $os.getenv("TRIP_KEY");
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(key)) {
    throw new Error("TRIP_KEY env var must be 12-64 chars of [A-Za-z0-9_-]");
  }
  return `@request.headers.x_trip_key = "${key}"`;
}

migrate((app) => {
  const W = writeRule();
  const expenses = app.findCollectionByNameOrId("expenses");

  const amount = expenses.fields.getByName("amount");
  amount.required = false;
  amount.min = 0;

  const category = expenses.fields.getByName("category");
  category.required = false;
  category.values = CATEGORIES;

  expenses.fields.add(new JSONField({ name: "lines", maxSize: 200000 }));
  expenses.fields.add(new TextField({ name: "scan_status", max: 10, pattern: "^(pending|running|done|failed)$" }));
  expenses.fields.add(new TextField({ name: "scan_error", max: 300 }));
  expenses.fields.add(new DateField({ name: "scanned_at" }));
  expenses.fields.add(new NumberField({ name: "scan_attempts", onlyInt: true, min: 0, hidden: true }));
  expenses.fields.add(new TextField({ name: "split_mode", max: 10, pattern: "^(equal|amounts|claims)$" }));
  expenses.fields.add(new JSONField({ name: "split_amounts", maxSize: 20000 }));
  expenses.indexes.push("CREATE INDEX idx_expenses_scan_status ON expenses (scan_status)");
  app.save(expenses);

  const people = app.findCollectionByNameOrId("people");
  const claims = new Collection({
    type: "base",
    name: "claims",
    listRule: "",
    viewRule: "",
    createRule: W,
    updateRule: null,
    deleteRule: W,
    fields: [
      { type: "relation", name: "expense", required: true, collectionId: expenses.id, maxSelect: 1, cascadeDelete: true },
      // Not "required": PocketBase treats 0 as blank for numbers, and 0 is a valid line index.
      { type: "number", name: "line", onlyInt: true, min: 0, max: 10000 },
      { type: "relation", name: "person", required: true, collectionId: people.id, maxSelect: 1, cascadeDelete: true },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_claims_unique ON claims (expense, line, person)"],
  });
  app.save(claims);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("claims")); } catch (_) {}

  const expenses = app.findCollectionByNameOrId("expenses");
  for (const name of NEW_FIELDS) expenses.fields.removeByName(name);
  expenses.indexes = expenses.indexes.filter((i) => !i.includes("idx_expenses_scan_status"));

  // Amount and category become required again; fill gaps so old rows stay valid.
  app.db().newQuery("UPDATE expenses SET amount = 0.01 WHERE amount < 0.01").execute();
  app.db().newQuery("UPDATE expenses SET category = 'Другое' WHERE category = '' OR category = 'Кафе и рестораны'").execute();
  const amount = expenses.fields.getByName("amount");
  amount.required = true;
  amount.min = 0.01;
  const category = expenses.fields.getByName("category");
  category.required = true;
  category.values = OLD_CATEGORIES;
  app.save(expenses);
});
