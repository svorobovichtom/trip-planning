import { describe, expect, it } from "vitest";
import { displayAmount } from "./AmountInput";

const nn = (s: string) => s.replace(/ /g, " ");

describe("displayAmount", () => {
  it("groups thousands with a narrow no-break space", () => {
    expect(nn(displayAmount("1234"))).toBe("1 234");
    expect(nn(displayAmount("1234567,5"))).toBe("1 234 567,5");
    expect(displayAmount("123")).toBe("123");
  });
  it("shows the decimal comma and drops typed spaces", () => {
    expect(displayAmount("12.5")).toBe("12,5");
    expect(nn(displayAmount("1 234,56"))).toBe("1 234,56");
    expect(displayAmount("12,")).toBe("12,");
    expect(displayAmount(",5")).toBe(",5");
    expect(displayAmount("")).toBe("");
  });
});
