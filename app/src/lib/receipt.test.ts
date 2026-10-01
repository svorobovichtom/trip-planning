import { describe, expect, it } from "vitest";
import { actualQty, aggregateLines, lineQty } from "./receipt";
import type { Expense } from "./types";

const nb = (s: string) => s.replace(/[  ]/g, " ");

describe("receipt lines vs list", () => {
  const xs: Expense[] = [
    {
      id: "e1", amount: 50, paid_by: "a",
      lines: [
        { text: "KARKÓWKA", qty: 1.2, unit: "kg", price: 30, item_id: "shea" },
        { text: "KARKÓWKA", qty: 0.8, unit: "kg", price: 20, item_id: "shea" },
        { text: "PIWO", qty: 6, unit: "szt", price: 18, item_id: null },
        { text: "", price: 1 },
        { text: "GONE", price: 2, item_id: "deleted" },
      ],
    },
    { id: "e2", amount: 5, paid_by: "a", lines: null },
  ];
  it("groups matched lines by item and collects the rest", () => {
    const { byItem, extra } = aggregateLines(xs, (id) => id === "shea");
    expect(byItem.get("shea")).toMatchObject({ g: 5000 });
    expect(byItem.get("shea")!.lines).toHaveLength(2);
    expect(extra.map((r) => r.line.text)).toEqual(["PIWO", "GONE"]);
    expect(extra[0]).toMatchObject({ index: 2 });
  });
  it("actual qty sums same-unit lines, else planned", () => {
    const { byItem } = aggregateLines(xs, () => true);
    expect(nb(actualQty({ qty: "3 кг" }, byItem.get("shea")))).toBe("2 кг");
    expect(actualQty({ qty: "3 кг" }, undefined)).toBe("3 кг");
    expect(actualQty({ qty: "1 уп" }, { g: 1, lines: [{ text: "a", qty: 1, unit: "kg", price: 1 }, { text: "b", qty: 1, unit: "g", price: 1 }] })).toBe("1 уп");
  });
  it("line qty", () => {
    expect(nb(lineQty({ text: "a", qty: 1.25, unit: "kg" }))).toBe("1,25 кг");
    expect(lineQty({ text: "a", qty: 3 })).toBe("× 3");
    expect(lineQty({ text: "a", qty: 1 })).toBe("");
    expect(lineQty({ text: "a" })).toBe("");
  });
});
