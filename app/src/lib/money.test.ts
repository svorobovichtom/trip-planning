import { describe, expect, it } from "vitest";
import { fmtG, fmtG0, fmtMinus, fmtSigned, grosze, parseAmount } from "./money";
import { plural } from "./plural";

const nb = (s: string) => s.replace(/[  ]/g, " ");

describe("money", () => {
  it("grosze rounds PLN floats", () => {
    expect(grosze(123.45)).toBe(12345);
    expect(grosze(0.1 + 0.2)).toBe(30);
    expect(grosze("12.5")).toBe(1250);
    expect(grosze(null)).toBe(0);
    expect(grosze("x")).toBe(0);
  });
  it("formats", () => {
    expect(nb(fmtG(12345))).toBe("123,45 zł");
    expect(nb(fmtG(123456))).toBe("1 234,56 zł");
    expect(nb(fmtG0(12355))).toBe("124 zł");
    expect(nb(fmtSigned(-100))).toBe("−1,00 zł");
    expect(nb(fmtSigned(100))).toBe("+1,00 zł");
    expect(nb(fmtMinus(-250))).toBe("−2,50 zł");
    expect(nb(fmtMinus(250))).toBe("2,50 zł");
  });
  it("parses amounts", () => {
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount("1 234,56 zł")).toBe(1234.56);
    expect(parseAmount("0.999")).toBe(1);
    expect(Number.isNaN(parseAmount(""))).toBe(true);
    expect(Number.isNaN(parseAmount("12a"))).toBe(true);
    expect(Number.isNaN(parseAmount("."))).toBe(true);
  });
});

describe("plural", () => {
  it.each([
    [1, "чек"], [2, "чека"], [4, "чека"], [5, "чеков"], [11, "чеков"], [12, "чеков"],
    [14, "чеков"], [21, "чек"], [22, "чека"], [25, "чеков"], [101, "чек"], [111, "чеков"], [0, "чеков"],
  ])("%i -> %s", (n, w) => {
    expect(plural(n, "чек", "чека", "чеков")).toBe(w);
  });
});
