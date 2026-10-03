/// <reference path="../pb_data/types.d.ts" />

// «Рассчитываемся вместе»: a pair or a family settles as one.
//
// people:
//   wallet   the person who transfers and receives for this one — the head of
//            their group (empty = themselves). Stored flat: members point at
//            the head, the head's is empty (app/src/lib/groups.ts).
// Shares and balances stay per person; the app adds a group's balances up
// into its head and suggests transfers only between groups
// (app/src/lib/ledger.ts, groupHeads / gbal). A deleted head simply drops out:
// the reference is cleared, and a dangling id counts as «alone» anyway.
// Rules are unchanged (the existing key rule on people).

migrate((app) => {
  const people = app.findCollectionByNameOrId("people");
  people.fields.add(new RelationField({ name: "wallet", collectionId: people.id, maxSelect: 1, cascadeDelete: false }));
  app.save(people);
}, (app) => {
  const people = app.findCollectionByNameOrId("people");
  people.fields.removeByName("wallet");
  app.save(people);
});
