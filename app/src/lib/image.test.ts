import { describe, expect, it } from "vitest";
import { fitSize, isPdf, jpegName, keepAsIs, SCANNABLE_NAME, SCANNABLE_TYPE } from "./image";

describe("receipt image resize", () => {
  it("fits the longer side into 1600 px, keeping the aspect ratio", () => {
    expect(fitSize(4032, 3024)).toEqual({ w: 1600, h: 1200, k: 1600 / 4032 });
    expect(fitSize(3024, 4032)).toMatchObject({ w: 1200, h: 1600 });
    expect(fitSize(1000, 9000)).toMatchObject({ w: 178, h: 1600 });
  });
  it("never upscales", () => {
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600, k: 1 });
    expect(fitSize(1600, 1600)).toEqual({ w: 1600, h: 1600, k: 1 });
  });
  it("handles degenerate sizes", () => {
    expect(fitSize(0, 100)).toEqual({ w: 0, h: 0, k: 1 });
    expect(fitSize(20000, 1)).toMatchObject({ w: 1600, h: 1 });
  });
  it("keeps small JPEGs that already fit, re-encodes everything else", () => {
    expect(keepAsIs("image/jpeg", 300_000, 1200, 1600)).toBe(true);
    expect(keepAsIs("image/jpeg", 2_000_000, 1200, 1600)).toBe(false);
    expect(keepAsIs("image/jpeg", 300_000, 1200, 1700)).toBe(false);
    expect(keepAsIs("image/heic", 300_000, 800, 600)).toBe(false);
    expect(keepAsIs("image/png", 300_000, 800, 600)).toBe(false);
  });
  it("names and formats", () => {
    expect(jpegName("IMG_0001.HEIC")).toBe("IMG_0001.jpg");
    expect(jpegName("")).toBe("receipt.jpg");
    expect(SCANNABLE_TYPE.test("image/webp")).toBe(true);
    expect(SCANNABLE_TYPE.test("image/heic")).toBe(false);
    expect(SCANNABLE_NAME.test("receipt_abc.JPG")).toBe(true);
    expect(SCANNABLE_NAME.test("receipt_abc.pdf")).toBe(false);
    expect(isPdf("application/pdf")).toBe(true);
    expect(isPdf("scan_x.pdf")).toBe(true);
  });
});
