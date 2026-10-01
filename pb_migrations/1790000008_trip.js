/// <reference path="../pb_data/types.d.ts" />

// «Поездка» sheet: the house, the meal plan and shared notes. Unlike the
// other collections these are private to the group: list/view AND writes need
// the trip key (X-Trip-Key), so the address and the Wi-Fi password are not
// readable by anyone who just knows the API URL. Realtime: the app passes the
// key as a subscription header (options.headers), see app/src/lib/sync.ts.
//
// house  one record, id HOUSE_ID: address, dates (check-in etc., free text),
//        wifi_name, wifi_pass, info (door code, host, rules). Only updated.
// meals  day («Пятница»), meal («ужин»), dish, order (sort; days are ordered
//        by their first meal)
// notes  text, author (people, optional)
//
// Idempotent: creates only what is missing, seeds only empty collections.
// Existing collections and data are not touched.

const HOUSE_ID = "house0000000001";

const MEALS = [
  ["Пятница", "ужин", "Гриль: шея, курица, колбаски, картошка, салат. Для одного: лосось"],
  ["Суббота", "завтрак", "Сырники со сметаной, яйца, хлеб, сыр, нарезка, овощи"],
  ["Суббота", "обед", "Лёгкий перекус перед выездом: бутерброды, овощи, фрукты"],
  ["Суббота", "ужин", "Лосось на гриле, немного шеи, пюре, овощи гриль, салат"],
  ["Воскресенье", "завтрак", "Без готовки: йогурт с гранолой и фруктами, бутерброды, кофе"],
];

const NOTE =
  "Один человек ест рыбу без мяса: ему лосось в пятницу и копчёный лосось к завтракам. " +
  "Соль, перец и специи сначала проверить в доме. Напитки и алкоголь не включены.";

function keyRule() {
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

function has(app, name) {
  try {
    app.findCollectionByNameOrId(name);
    return true;
  } catch (_) {
    return false;
  }
}

migrate((app) => {
  const K = keyRule();
  const people = app.findCollectionByNameOrId("people");

  if (!has(app, "house")) {
    app.save(new Collection({
      type: "base",
      name: "house",
      listRule: K,
      viewRule: K,
      createRule: null,
      updateRule: K,
      deleteRule: null,
      fields: [
        { type: "text", name: "address", max: 200 },
        { type: "text", name: "dates", max: 120 },
        { type: "text", name: "wifi_name", max: 64 },
        { type: "text", name: "wifi_pass", max: 64 },
        { type: "text", name: "info", max: 2000 },
        ...stamps(),
      ],
    }));
  }
  if (!has(app, "meals")) {
    app.save(new Collection({
      type: "base",
      name: "meals",
      listRule: K,
      viewRule: K,
      createRule: K,
      updateRule: K,
      deleteRule: K,
      fields: [
        { type: "text", name: "day", required: true, max: 30 },
        { type: "text", name: "meal", max: 30 },
        { type: "text", name: "dish", required: true, max: 300, presentable: true },
        { type: "number", name: "order" },
        ...stamps(),
      ],
    }));
  }
  if (!has(app, "notes")) {
    app.save(new Collection({
      type: "base",
      name: "notes",
      listRule: K,
      viewRule: K,
      createRule: K,
      updateRule: K,
      deleteRule: K,
      fields: [
        { type: "text", name: "text", required: true, max: 1000, presentable: true },
        { type: "relation", name: "author", collectionId: people.id, maxSelect: 1, cascadeDelete: false },
        ...stamps(),
      ],
    }));
  }

  const house = app.findCollectionByNameOrId("house");
  try {
    app.findRecordById(house, HOUSE_ID);
  } catch (_) {
    const r = new Record(house);
    r.set("id", HOUSE_ID);
    app.save(r);
  }

  const meals = app.findCollectionByNameOrId("meals");
  if (app.countRecords(meals) === 0) {
    MEALS.forEach(([day, meal, dish], i) => {
      const r = new Record(meals);
      r.set("day", day);
      r.set("meal", meal);
      r.set("dish", dish);
      r.set("order", (i + 1) * 10);
      app.save(r);
    });
  }

  const notes = app.findCollectionByNameOrId("notes");
  if (app.countRecords(notes) === 0) {
    const r = new Record(notes);
    r.set("text", NOTE);
    app.save(r);
  }
}, (app) => {
  for (const name of ["notes", "meals", "house"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
});
