import type { BasisPoints } from "./money";

// GST 2.0, effective 22 Sep 2025. Most medicines 5%, notified life-saving drugs 0%,
// some pharma inputs and non-medicine items (cosmetics, devices) 18%.
// The database rejects any other rate (migration 002).
export const GST_RATES_BP = [0, 500, 1800] as const;
export type GstRateBp = (typeof GST_RATES_BP)[number];
export const DEFAULT_GST_BP: GstRateBp = 500;

export function isValidGst(bp: number): bp is GstRateBp {
  return (GST_RATES_BP as readonly number[]).includes(bp);
}

export function gstLabel(bp: BasisPoints): string {
  return `${bp / 100}%`;
}

export interface GstParse {
  bp: GstRateBp | null;
  /** Set when the value was understood but changed, e.g. an old 12% rate. */
  note?: "OLD_12_TO_5";
}

/**
 * Read a GST value as it appears in old reports: "5", "5%", "0.05", "12", "GST 12%".
 * Old 12% medicine rates become 5% (the GST 2.0 rate for medicines), flagged with a note.
 */
export function parseGst(raw: unknown): GstParse {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { bp: null };
  const m = String(raw).replace(/,/g, ".").match(/-?\d+(\.\d+)?/);
  if (!m) return { bp: null };
  let pct = Number(m[0]);
  if (pct > 0 && pct < 1) pct = pct * 100; // 0.05 → 5
  pct = Math.round(pct * 100) / 100;
  if (pct === 12) return { bp: 500, note: "OLD_12_TO_5" };
  const bp = Math.round(pct * 100);
  return isValidGst(bp) ? { bp } : { bp: null };
}
