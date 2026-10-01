import { describe, expect, it } from "vitest";
import { grosze, parseAmount } from "./money";
import { normPhone, normRevtag, phoneForCopy, revolutLink } from "./pay";

describe("normRevtag", () => {
  it("accepts a bare tag, @tag and revolut.me links", () => {
    expect(normRevtag("yulia")).toBe("yulia");
    expect(normRevtag("  @yulia ")).toBe("yulia");
    expect(normRevtag("@@yulia.k")).toBe("yulia.k");
    expect(normRevtag("revolut.me/yulia")).toBe("yulia");
    expect(normRevtag("https://revolut.me/yulia")).toBe("yulia");
    expect(normRevtag("https://www.revolut.me/yulia/")).toBe("yulia");
    expect(normRevtag("https://revolut.me/@yulia_99?amount=100&currency=PLN")).toBe("yulia_99");
    expect(normRevtag("http://Revolut.Me/Yulia-K#x")).toBe("Yulia-K");
    expect(normRevtag("https://revolut.me/%40yulia")).toBe("yulia");
  });
  it("empty -> '', junk -> null", () => {
    expect(normRevtag("")).toBe("");
    expect(normRevtag("   ")).toBe("");
    expect(normRevtag("@")).toBeNull();
    expect(normRevtag("y")).toBeNull();
    expect(normRevtag("yulia k")).toBeNull();
    expect(normRevtag("юля")).toBeNull();
    expect(normRevtag("https://example.com/yulia")).toBeNull();
    expect(normRevtag("a".repeat(41))).toBeNull();
  });
});

describe("normPhone", () => {
  it("formats Polish numbers", () => {
    expect(normPhone("512345678")).toBe("512 345 678");
    expect(normPhone("512-345-678")).toBe("512 345 678");
    expect(normPhone("+48512345678")).toBe("+48 512 345 678");
    expect(normPhone("(+48) 512 345 678")).toBe("+48 512 345 678");
    expect(normPhone("0048 512 345 678")).toBe("+48 512 345 678");
  });
  it("keeps other numbers as digits", () => {
    expect(normPhone("+380 67 123 45 67")).toBe("+380671234567");
    expect(normPhone("1234567")).toBe("1234567");
  });
  it("empty -> '', junk -> null", () => {
    expect(normPhone("")).toBe("");
    expect(normPhone("12a45678")).toBeNull();
    expect(normPhone("12345")).toBeNull();
    expect(normPhone("+1234567890123456")).toBeNull();
  });
  it("copies a Polish number without +48", () => {
    expect(phoneForCopy("+48 512 345 678")).toBe("512345678");
    expect(phoneForCopy("512 345 678")).toBe("512345678");
    expect(phoneForCopy("+380671234567")).toBe("+380671234567");
  });
});

describe("revolutLink", () => {
  it("puts the amount in grosze (minor units), PLN", () => {
    expect(revolutLink("yulia", grosze(50.34))).toBe("https://revolut.me/yulia?amount=5034&currency=PLN");
    expect(revolutLink("yulia", grosze(1234.5))).toBe("https://revolut.me/yulia?amount=123450&currency=PLN");
    expect(revolutLink("yulia", grosze(0.05))).toBe("https://revolut.me/yulia?amount=5&currency=PLN");
    expect(revolutLink("yulia", grosze(parseAmount("50,34")))).toBe("https://revolut.me/yulia?amount=5034&currency=PLN");
    expect(revolutLink("yulia", grosze(0.1 + 0.2))).toBe("https://revolut.me/yulia?amount=30&currency=PLN");
  });
  it("normalises the tag", () => {
    expect(revolutLink("@yulia", 100)).toBe("https://revolut.me/yulia?amount=100&currency=PLN");
    expect(revolutLink("https://revolut.me/yulia", 100)).toBe("https://revolut.me/yulia?amount=100&currency=PLN");
  });
  it("null for a bad tag or amount", () => {
    expect(revolutLink("", 100)).toBeNull();
    expect(revolutLink("y u", 100)).toBeNull();
    expect(revolutLink("yulia", 0)).toBeNull();
    expect(revolutLink("yulia", 12.5)).toBeNull();
    expect(revolutLink("yulia", Number.NaN)).toBeNull();
  });
});
