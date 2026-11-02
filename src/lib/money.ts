// All money is integer paise. All GST / discount rates are integer basis points
// (12% = 1200). Keeping everything in integers avoids floating-point drift.

export type Paise = number;
export type BasisPoints = number;

const BP = 10_000;

/** Round half away from zero, like a calculator. */
export function roundHalf(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

export function rupeesToPaise(rupees: number | string): Paise {
  const n = typeof rupees === "string" ? Number(rupees.replace(/,/g, "")) : rupees;
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${rupees}`);
  return roundHalf(n * 100);
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 123456 → "₹1,234.56" (Indian digit grouping). */
export function formatPaise(p: Paise): string {
  return inr.format(p / 100);
}

/**
 * Split a GST-inclusive amount into taxable value + GST.
 * Medicines are sold at MRP, which already includes GST.
 */
export function splitInclusive(amount: Paise, gstRate: BasisPoints): { taxable: Paise; gst: Paise } {
  const taxable = roundHalf((amount * BP) / (BP + gstRate));
  return { taxable, gst: amount - taxable };
}

/** GST on top of a taxable (exclusive) amount, e.g. a supplier's purchase rate. */
export function addExclusive(taxable: Paise, gstRate: BasisPoints): { gst: Paise; total: Paise } {
  const gst = roundHalf((taxable * gstRate) / BP);
  return { gst, total: taxable + gst };
}

/** Intra-state sale: GST is split equally into CGST and SGST; any odd paisa goes to SGST. */
export function splitCgstSgst(gst: Paise): { cgst: Paise; sgst: Paise } {
  const cgst = Math.floor(gst / 2);
  return { cgst, sgst: gst - cgst };
}

export interface SaleLineInput {
  /** Quantity in the smallest unit (tablets / ml / pieces). */
  qtyUnits: number;
  /** Units per pack (e.g. 15 tablets in a strip). */
  packSize: number;
  /** Selling rate per PACK, GST inclusive. */
  ratePerPack: Paise;
  discount: BasisPoints;
  gstRate: BasisPoints;
}

export interface SaleLineAmounts {
  gross: Paise;
  discount: Paise;
  amount: Paise;
  taxable: Paise;
  gst: Paise;
}

/** One bill line: loose tablets are priced pro-rata from the strip rate. */
export function computeSaleLine(l: SaleLineInput): SaleLineAmounts {
  if (!Number.isInteger(l.qtyUnits) || l.qtyUnits <= 0) throw new Error("qtyUnits must be a positive integer");
  if (!Number.isInteger(l.packSize) || l.packSize <= 0) throw new Error("packSize must be a positive integer");
  const gross = roundHalf((l.ratePerPack * l.qtyUnits) / l.packSize);
  const discount = roundHalf((gross * l.discount) / BP);
  const amount = gross - discount;
  const { taxable, gst } = splitInclusive(amount, l.gstRate);
  return { gross, discount, amount, taxable, gst };
}

/** Round a bill total to the nearest rupee. Returns the round-off and the payable amount. */
export function roundOffBill(total: Paise): { roundOff: Paise; payable: Paise } {
  const payable = roundHalf(total / 100) * 100;
  return { roundOff: payable - total, payable };
}
