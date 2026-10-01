/// <reference path="../pb_data/types.d.ts" />

// Schema for the shared trip page.
//
// There is no login. Reads are public so realtime works without headers;
// writes need the shared trip key in the X-Trip-Key header. The key is not in
// this file: it comes from the TRIP_KEY environment variable (set in
// /opt/trip/trip.env on the server), so the repo can stay public.
// To rotate the key later, see README.md.

const CATEGORIES = [
  "Мясо и рыба", "Молочка и яйца", "Овощи и зелень", "Фрукты", "Бакалея",
  "Снеки", "Гриль и быт", "Напитки и алкоголь", "Жильё",
  "Транспорт и бензин", "Другое",
];

function writeRule() {
  const key = $os.getenv("TRIP_KEY");
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(key)) {
    throw new Error("TRIP_KEY env var must be 12-64 chars of [A-Za-z0-9_-]");
  }
  return `@request.headers.x_trip_key = "${key}"`;
}

function stamps() {
  return [
    { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
  ];
}

migrate((app) => {
  const W = writeRule();
  const rules = { listRule: "", viewRule: "", createRule: W, updateRule: W, deleteRule: W };

  const people = new Collection({
    type: "base",
    name: "people",
    ...rules,
    fields: [
      { type: "text", name: "name", required: true, max: 40, presentable: true },
      { type: "number", name: "sort", onlyInt: true },
      ...stamps(),
    ],
  });
  app.save(people);

  const items = new Collection({
    type: "base",
    name: "items",
    ...rules,
    fields: [
      { type: "text", name: "key", required: true, max: 60 },
      { type: "text", name: "section", required: true, max: 60 },
      { type: "text", name: "name", required: true, max: 120, presentable: true },
      { type: "text", name: "pl", max: 120 },
      { type: "text", name: "qty", max: 40 },
      { type: "number", name: "sort" },
      { type: "bool", name: "done" },
      { type: "relation", name: "done_by", collectionId: people.id, maxSelect: 1, cascadeDelete: false },
      { type: "date", name: "done_at" },
      ...stamps(),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_items_key ON items (key)",
      "CREATE INDEX idx_items_sort ON items (sort)",
    ],
  });
  app.save(items);

  const expenses = new Collection({
    type: "base",
    name: "expenses",
    ...rules,
    fields: [
      { type: "text", name: "title", max: 120, presentable: true },
      { type: "number", name: "amount", required: true, min: 0.01, max: 1000000 },
      { type: "text", name: "currency", max: 3, pattern: "^[A-Z]{3}$" },
      { type: "select", name: "category", required: true, maxSelect: 1, values: CATEGORIES },
      { type: "relation", name: "paid_by", required: true, collectionId: people.id, maxSelect: 1, cascadeDelete: false },
      { type: "relation", name: "split_between", collectionId: people.id, maxSelect: 50, cascadeDelete: false },
      {
        type: "file", name: "receipt", maxSelect: 1, maxSize: 10 * 1024 * 1024,
        mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"],
        thumbs: ["400x0"],
      },
      { type: "text", name: "note", max: 500 },
      { type: "date", name: "spent_at" },
      ...stamps(),
    ],
    indexes: ["CREATE INDEX idx_expenses_created ON expenses (created)"],
  });
  app.save(expenses);
}, (app) => {
  for (const name of ["expenses", "items", "people"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
});
