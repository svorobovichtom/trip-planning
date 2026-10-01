import { describe, expect, it } from "vitest";
import type { Meal } from "../../lib/types";
import { groupDays, mapsUrl, relTime } from "./logic";

const m = (id: string, day: string, order: number): Meal => ({ id, day, meal: "", dish: id, order });

describe("groupDays", () => {
  it("groups by day in the order of the first meal", () => {
    const d = groupDays([m("c", "Суббота", 30), m("a", "Пятница", 10), m("b", "суббота ", 20), m("x", "Пятница", 11)]);
    expect(d.map((x) => x.day)).toEqual(["Пятница", "суббота"]);
    expect(d[0]!.meals.map((x) => x.id)).toEqual(["a", "x"]);
    expect(d[1]!.meals.map((x) => x.id)).toEqual(["b", "c"]);
  });
});

describe("relTime", () => {
  const now = new Date(2026, 9, 3, 12, 0).getTime();
  const at = (d: Date) => d.toISOString().replace("T", " ");
  it("formats recent times", () => {
    expect(relTime(at(new Date(now - 20000)), now)).toBe("только что");
    expect(relTime(at(new Date(now - 5 * 60000)), now)).toBe("5 мин назад");
    expect(relTime(at(new Date(now - 3 * 3600000)), now)).toBe("3 ч назад");
    expect(relTime(at(new Date(2026, 9, 2, 22, 0)), now)).toBe("вчера");
    expect(relTime(at(new Date(2026, 8, 28, 10, 0)), now)).toMatch(/^28 сент/);
    expect(relTime("", now)).toBe("");
  });
});

it("mapsUrl encodes the address", () => {
  expect(mapsUrl(" ul. Leśna 5, Zakopane ")).toBe("https://maps.apple.com/?q=ul.%20Le%C5%9Bna%205%2C%20Zakopane");
});
