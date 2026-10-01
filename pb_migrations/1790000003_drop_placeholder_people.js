/// <reference path="../pb_data/types.d.ts" />

// People now add themselves from the "Кто ты?" sheet, so the "Человек N"
// placeholders from the seed go away. A placeholder that anything points at
// (a checked item, an expense) is kept, so no check or payment loses its owner.

migrate((app) => {
  const refs = [
    ["items", "done_by"],
    ["expenses", "paid_by"],
    ["expenses", "split_between"],
  ];
  const people = app.findRecordsByFilter("people", "name ~ 'Человек'", "", 0, 0);
  for (const p of people) {
    if (!/^Человек \d+$/.test(p.getString("name"))) continue;
    const used = refs.some(([coll, field]) =>
      app.findRecordsByFilter(coll, `${field} ~ {:id}`, "", 1, 0, { id: p.id }).length > 0);
    if (!used) app.delete(p);
  }
}, () => {});
