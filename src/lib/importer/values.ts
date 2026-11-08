// Turn messy cell values from other software into clean values.
// Each parser returns null when the cell is empty and throws nothing:
// invalid input comes back as { error } so the importer can report the row.

import type { Cell } from "./mapping";
import type { Schedule } from "../../db/types";

export function isBlank(c: Cell): boolean {
  return c === null || c === undefined || String(c).trim() === "";
}

/** Plain text: trimmed, inner spaces collapsed, Excel's "12345.0" for codes avoided. */
export function text(c: Cell): string | null {
  if (isBlank(c)) return null;
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  if (typeof c === "number") return Number.isInteger(c) ? String(c) : String(c);
  return String(c).replace(/\s+/g, " ").trim();
}

export type Parsed<T> = { value: T } | { error: true };
export const ok = <T>(value: T): Parsed<T> => ({ value });
export const bad = { error: true } as const;

/** "₹1,234.50", "Rs. 34", "34.10/-", 34.1 → 34.1 */
export function number(c: Cell): Parsed<number> | null {
  if (isBlank(c)) return null;
  if (typeof c === "number") return Number.isFinite(c) ? ok(c) : bad;
  if (typeof c === "boolean" || c instanceof Date) return bad;
  const s = String(c)
    .replace(/₹|rs\.?|inr/gi, "")
    .replace(/\/-$/, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return bad;
  return ok(Number(s));
}

/** Rupees → integer paise. */
export function money(c: Cell): Parsed<number> | null {
  const n = number(c);
  if (!n || "error" in n) return n;
  return ok(Math.round(n.value * 100));
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function endOfMonth(year: number, month: number): string | null {
  if (month < 1 || month > 12 || year < 2000 || year > 2099) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad2(month)}-${pad2(last)}`;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function year4(y: string): number {
  const n = Number(y);
  return y.length <= 2 ? 2000 + n : n;
}

/**
 * Expiry as printed or exported anywhere → last day of the expiry month.
 * Medicines are good until the end of the month printed on the pack.
 * Handles: 08/27, 8/2027, 08-27, 0827, Aug-27, AUG 2027, August 2027,
 * 31/08/2027, 2027-08-31, 2027-08, Excel dates and Excel serial numbers.
 */
export function expiry(c: Cell): Parsed<string> | null {
  if (isBlank(c)) return null;
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return bad;
    const r = endOfMonth(c.getUTCFullYear(), c.getUTCMonth() + 1);
    return r ? ok(r) : bad;
  }
  if (typeof c === "number") {
    // Excel serial date (days since 1899-12-30)
    if (c > 30000 && c < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86_400_000);
      const r = endOfMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
      return r ? ok(r) : bad;
    }
    c = String(c);
  }
  const s = String(c).trim().toLowerCase().replace(/\s+/g, " ");
  let m: RegExpMatchArray | null;

  // 2027-08-31 / 2027/08 / 2027-8
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/))) return wrap(endOfMonth(+m[1], +m[2]));
  // 31/08/2027, 31-08-27 (day first, Indian style)
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) return wrap(endOfMonth(year4(m[3]), +m[2]));
  // 08/27, 8/2027, 08-27, 08.27, 08 27
  if ((m = s.match(/^(\d{1,2})\s*[-/. ]\s*(\d{2}|\d{4})$/))) return wrap(endOfMonth(year4(m[2]), +m[1]));
  // 0827 (MMYY) or 082027 (MMYYYY)
  if ((m = s.match(/^(\d{2})(\d{2}|\d{4})$/))) return wrap(endOfMonth(year4(m[2]), +m[1]));
  // Aug-27, AUG 2027, august/2027, 31-Aug-2027
  if ((m = s.match(/^(?:\d{1,2}[-/ ])?([a-z]{3,9})\.?[-/ ,']*(\d{2}|\d{4})$/))) {
    const mon = MONTHS[m[1].slice(0, 4)] ?? MONTHS[m[1].slice(0, 3)];
    return mon ? wrap(endOfMonth(year4(m[2]), mon)) : bad;
  }
  return bad;
}

function wrap(v: string | null): Parsed<string> {
  return v ? ok(v) : bad;
}

export interface PackInfo {
  packSize: number;
  unit: string | null;
}

/**
 * "10", "10's", "10 TAB", "1x15", "1*10", "STRIP OF 10", "200ML", "30 GM".
 * Liquids and creams are sold as a whole bottle/tube, so "200ML" = pack of 1 PCS.
 * "10x10" (box of 10 strips) → 10 per strip, the unit the shop sells.
 */
export function pack(c: Cell): Parsed<PackInfo> | null {
  if (isBlank(c)) return null;
  if (typeof c === "number") return Number.isInteger(c) && c > 0 && c <= 1000 ? ok({ packSize: c, unit: null }) : bad;
  const s = String(c).trim().toUpperCase();
  if (/\d\s*(ML|L|LTR|GM|G|GMS|KG|MG\b)/.test(s) && !/TAB|CAP/.test(s)) {
    if (/ML|L\b|LTR/.test(s)) return ok({ packSize: 1, unit: "BTL" });
    return ok({ packSize: 1, unit: "PCS" });
  }
  let n: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/(\d+)\s*[X*×]\s*(\d+)/))) n = Number(m[2]);
  else if ((m = s.match(/(\d+)/))) n = Number(m[1]);
  if (n === null || n <= 0 || n > 1000) return bad;
  const unit = /CAP/.test(s) ? "CAP" : /TAB/.test(s) ? "TAB" : /AMP/.test(s) ? "AMP" : /VIAL/.test(s) ? "VIAL" : null;
  return ok({ packSize: n, unit });
}

const UNITS = ["TAB", "CAP", "ML", "GM", "PCS", "BTL", "TUBE", "AMP", "VIAL", "SACHET", "STRIP", "BOX", "KIT"];

export function unit(c: Cell): string | null {
  const t = text(c)?.toUpperCase().replace(/[^A-Z]/g, "");
  if (!t) return null;
  const alias: Record<string, string> = { TABS: "TAB", TABLET: "TAB", TABLETS: "TAB", CAPS: "CAP", CAPSULE: "CAP", CAPSULES: "CAP", NOS: "PCS", NO: "PCS", PC: "PCS", PIECE: "PCS", BOTTLE: "BTL", GMS: "GM", G: "GM" };
  const u = alias[t] ?? t;
  return UNITS.includes(u) ? u : null;
}

/**
 * Quantity in packs → units. Accepts 3 (packs), 2.5 (half strip, when exact),
 * and "2:5" (2 packs + 5 loose), the way some software prints closing stock.
 */
export function qtyUnits(c: Cell, packSize: number, looseCell?: Cell): Parsed<number> | null {
  const loose = looseCell === undefined ? null : number(looseCell);
  if (loose && "error" in loose) return bad;
  const looseUnits = loose ? loose.value : 0;

  if (isBlank(c)) return loose ? (Number.isInteger(looseUnits) ? ok(looseUnits) : bad) : null;
  const colon = typeof c === "string" ? c.trim().match(/^(\d+)\s*:\s*(\d+)$/) : null;
  let units: number;
  if (colon) units = Number(colon[1]) * packSize + Number(colon[2]);
  else {
    const n = number(c);
    if (!n || "error" in n) return bad;
    units = n.value * packSize;
  }
  units += looseUnits;
  const rounded = Math.round(units);
  if (Math.abs(units - rounded) > 1e-6) return bad; // e.g. 2.5 strips of 15 = 37.5 tablets
  return ok(rounded);
}

/** "H1", "Sch. H1", "SCHEDULE H", "Rx", "NRX", "X", "OTC", "" → schedule code. */
export function schedule(c: Cell): Parsed<Schedule> | null {
  if (isBlank(c)) return null;
  const s = String(c).toUpperCase().replace(/SCHEDULE|SCH\.?|DRUG/g, "").replace(/[^A-Z0-9]/g, "");
  if (s === "") return ok("OTC");
  if (s === "H1") return ok("H1");
  if (s === "H" || s === "RX" || s === "PRESCRIPTION") return ok("H");
  if (s === "X") return ok("X");
  if (s === "NDPS" || s === "NRX" || s === "NARCOTIC" || s === "N") return ok("NDPS");
  if (s === "OTC" || s === "G" || s === "NONE" || s === "GENERAL" || s === "NA" || s === "NO") return ok("OTC");
  return bad;
}

/** Indian GSTIN: 2-digit state, PAN, entity no., Z, checksum. */
export function gstin(c: Cell): Parsed<string> | null {
  const t = text(c)?.toUpperCase().replace(/\s/g, "");
  if (!t) return null;
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(t) ? ok(t) : bad;
}

/** Keep digits; drop a leading +91 or 0 from 10-digit Indian mobiles. */
export function phone(c: Cell): string | null {
  const d = text(c)?.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  // 0 + 10-digit mobile → mobile. Landlines keep their STD code (020-2445… stays 02024…).
  if (d.length === 11 && /^0[6-9]/.test(d)) return d.slice(1);
  return d;
}

/** Barcodes must stay text. Excel often turns 8901234567890 into "8.90123E+12", which is lost. */
export function barcode(c: Cell): Parsed<string> | null {
  if (isBlank(c)) return null;
  if (typeof c === "number") return Number.isInteger(c) ? ok(String(c)) : bad;
  const t = String(c).trim();
  if (/e\+/i.test(t)) return bad;
  return /^[0-9A-Za-z-]{4,32}$/.test(t) ? ok(t) : bad;
}
