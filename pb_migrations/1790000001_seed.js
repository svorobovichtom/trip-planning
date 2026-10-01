/// <reference path="../pb_data/types.d.ts" />

// Seed: 9 placeholder people (renamed in the app) and the shopping list from
// the original static page, in the same order.

// [section, [[key, name (ru), name (pl), qty], ...]]
const DATA = [
  ["Мясо и рыба", [
    ["shea","Свиная шея","karkówka","3 кг"],
    ["kurica","Куриные бёдра без кости","filet z uda kurczaka","1,5 кг"],
    ["kolbaski","Колбаски на гриль","kiełbasa na grilla","1,5 кг"],
    ["losos","Лосось филе с кожей","łosoś filet","2,5 кг"],
    ["losos-kopch","Копчёный лосось к завтракам","łosoś wędzony","300 г"],
    ["narezka","Мясная нарезка","szynka, salami w plastrach","800 г"]]],
  ["Молочка и яйца", [
    ["yaica","Яйца","jajka","40 шт"],
    ["tvorog","Творог сухой, в брикетах","twaróg półtłusty","1,5 кг"],
    ["maslo","Сливочное масло","masło","3 × 200 г"],
    ["moloko","Молоко","mleko","3 л"],
    ["smetana","Сметана 18%","śmietana","2 × 400 г"],
    ["syr","Твёрдый сыр","ser żółty","1 кг"],
    ["yogurt","Натуральный йогурт","jogurt naturalny","2 кг"]]],
  ["Овощи и зелень", [
    ["kartofel","Картофель","ziemniaki","5 кг"],
    ["ogurcy","Огурцы","ogórki","2 кг"],
    ["pomidory","Помидоры","pomidory","2 кг"],
    ["cherri","Черри","pomidorki koktajlowe","1 кг"],
    ["perec","Болгарский перец","papryka","6 шт"],
    ["kabachki","Кабачки на гриль","cukinia","3 шт"],
    ["salat","Салатные листья","sałata","3 уп"],
    ["zelen","Укроп, петрушка, зелёный лук","koperek, pietruszka, szczypiorek","по 2 пучка"],
    ["luk","Красный лук","cebula czerwona","1 кг"],
    ["chesnok","Чеснок","czosnek","2 головки"],
    ["limony","Лимоны","cytryny","4 шт"],
    ["morkov","Морковь для перекуса","marchew","1 кг"]]],
  ["Фрукты", [
    ["banany","Бананы","banany","2 кг"],
    ["kiwi","Киви","kiwi","12 шт"],
    ["yabloki","Яблоки","jabłka","2 кг"],
    ["vinograd","Виноград или мандарины","winogrona / mandarynki","1 кг"]]],
  ["Бакалея", [
    ["hleb","Хлеб","chleb","4 буханки"],
    ["granola","Гранола или мюсли","granola / musli","2 уп"],
    ["bagety","Багеты","bagietki","2 шт"],
    ["ovsyanka","Овсянка","płatki owsiane","1 кг"],
    ["muka","Мука","mąka","1 кг"],
    ["sahar","Сахар + ванильный сахар","cukier, cukier wanilinowy","1 кг + 2 пак"],
    ["kofe","Кофе молотый","kawa mielona","2 × 500 г"],
    ["chai","Чай пакетированный","herbata","1 уп"],
    ["maslo-rast","Растительное масло","olej","1 л"],
    ["olivkovoe","Оливковое масло","oliwa z oliwek","0,5 л"],
    ["med","Мёд или варенье","miód / dżem","1 банка"],
    ["sousy","Кетчуп, горчица, майонез, BBQ, чесночный","sosy","по 1"]]],
  ["Снеки", [
    ["chipsy","Чипсы","chipsy","5 больших"],
    ["krekery","Крекеры","krakersy","3 пачки"],
    ["orehi","Орешки","orzeszki","2 пачки"]]],
  ["Гриль и быт", [
    ["ugol","Уголь или брикеты","węgiel drzewny / brykiet","2 мешка"],
    ["rozzhig","Розжиг","podpałka","1 уп"],
    ["folga","Фольга","folia aluminiowa","1 рулон"],
    ["lotki","Лотки для гриля","tacki do grilla","1 уп"],
    ["polotenca","Бумажные полотенца","ręczniki papierowe","2 рулона"],
    ["pakety","Мусорные пакеты","worki na śmieci","1 рулон"],
    ["salfetki","Салфетки","serwetki","1 уп"]]],
];

migrate((app) => {
  const people = app.findCollectionByNameOrId("people");
  for (let i = 1; i <= 9; i++) {
    const r = new Record(people);
    r.set("name", `Человек ${i}`);
    r.set("sort", i);
    app.save(r);
  }

  // Sections step by 100 so custom items can slot in after a section's last row.
  const items = app.findCollectionByNameOrId("items");
  DATA.forEach(([section, rows], s) => {
    rows.forEach(([key, name, pl, qty], i) => {
      const r = new Record(items);
      r.set("key", key);
      r.set("section", section);
      r.set("name", name);
      r.set("pl", pl);
      r.set("qty", qty);
      r.set("sort", (s + 1) * 100 + i);
      r.set("done", false);
      app.save(r);
    });
  });
}, (app) => {
  app.db().newQuery("DELETE FROM items").execute();
  app.db().newQuery("DELETE FROM people").execute();
});
