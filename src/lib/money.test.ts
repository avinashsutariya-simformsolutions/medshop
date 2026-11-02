import { describe, expect, it } from "vitest";
import {
  addExclusive,
  computeSaleLine,
  formatPaise,
  roundOffBill,
  rupeesToPaise,
  splitCgstSgst,
  splitInclusive,
} from "./money";
import { expiryStatus, formatExpiry, formatQty, parseExpiry, toPacks } from "./stock";

describe("money", () => {
  it("converts rupees to paise without float drift", () => {
    expect(rupeesToPaise("34.10")).toBe(3410);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    expect(rupeesToPaise("1,234.5")).toBe(123450);
  });

  it("formats with Indian grouping", () => {
    expect(formatPaise(12345678)).toBe("₹1,23,456.78");
  });

  it("splits a GST-inclusive MRP", () => {
    // ₹112 at 12% → ₹100 taxable + ₹12 GST
    expect(splitInclusive(11200, 1200)).toEqual({ taxable: 10000, gst: 1200 });
    // parts always add back to the amount
    const s = splitInclusive(3410, 1200);
    expect(s.taxable + s.gst).toBe(3410);
  });

  it("adds GST to a purchase rate", () => {
    expect(addExclusive(10000, 500)).toEqual({ gst: 500, total: 10500 });
  });

  it("splits CGST/SGST with the odd paisa on SGST", () => {
    expect(splitCgstSgst(365)).toEqual({ cgst: 182, sgst: 183 });
  });

  it("prices loose tablets pro-rata from the strip", () => {
    // Strip of 15 at ₹34.10; 5 tablets, no discount
    const l = computeSaleLine({ qtyUnits: 5, packSize: 15, ratePerPack: 3410, discount: 0, gstRate: 1200 });
    expect(l.gross).toBe(1137);
    expect(l.amount).toBe(1137);
    expect(l.taxable + l.gst).toBe(l.amount);
  });

  it("applies line discount", () => {
    const l = computeSaleLine({ qtyUnits: 30, packSize: 15, ratePerPack: 3410, discount: 1000, gstRate: 1200 });
    expect(l.gross).toBe(6820);
    expect(l.discount).toBe(682);
    expect(l.amount).toBe(6138);
  });

  it("rejects bad quantities", () => {
    expect(() => computeSaleLine({ qtyUnits: 0, packSize: 10, ratePerPack: 100, discount: 0, gstRate: 0 })).toThrow();
  });

  it("rounds a bill to the nearest rupee", () => {
    expect(roundOffBill(12349)).toEqual({ roundOff: -49, payable: 12300 });
    expect(roundOffBill(12350)).toEqual({ roundOff: 50, payable: 12400 });
  });
});

describe("stock", () => {
  it("splits units into packs", () => {
    expect(toPacks(33, 15)).toEqual({ packs: 2, loose: 3 });
    expect(formatQty(33, 15)).toBe("2×15 + 3 tab");
    expect(formatQty(30, 15)).toBe("2×15");
  });

  it("parses expiry as end of month", () => {
    expect(parseExpiry("08/27")).toBe("2027-08-31");
    expect(parseExpiry("2/2028")).toBe("2028-02-29");
    expect(parseExpiry("13/27")).toBeNull();
    expect(formatExpiry("2027-08-31")).toBe("08/27");
  });

  it("classifies expiry", () => {
    expect(expiryStatus("2026-10-31", "2026-11-02", 90)).toBe("EXPIRED");
    expect(expiryStatus("2026-12-31", "2026-11-02", 90)).toBe("NEAR");
    expect(expiryStatus("2027-08-31", "2026-11-02", 90)).toBe("OK");
  });
});
