/// <reference path="../pb_data/types.d.ts" />

// «Как тебе переводить»: how each person wants to be paid back, so «Ты
// должен» in Итоги can open a transfer in one tap.
//
// people:
//   revolut  Revtag / revolut.me username, stored without "@"
//            (the app opens https://revolut.me/<revolut>?amount=<grosze>&currency=PLN)
//   phone    phone number for a BLIK transfer («przelew na telefon»), as typed:
//            digits, "+" and spaces
// Both optional. Reads stay public (like names), so the app says that
// whatever is entered here is visible to everyone who opens the page.
// Rules are unchanged (the existing key rule on people).

migrate((app) => {
  const people = app.findCollectionByNameOrId("people");
  people.fields.add(new TextField({ name: "revolut", max: 40, pattern: "^[A-Za-z0-9._-]{2,40}$" }));
  people.fields.add(new TextField({ name: "phone", max: 20, pattern: "^\\+?[0-9 ]{6,20}$" }));
  app.save(people);
}, (app) => {
  const people = app.findCollectionByNameOrId("people");
  people.fields.removeByName("revolut");
  people.fields.removeByName("phone");
  app.save(people);
});
