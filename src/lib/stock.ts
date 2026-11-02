// Pure helpers for quantities and expiry dates. No database access here,
// so everything in this file is easy to unit-test.

/** Split units into full packs + loose units: 33 tablets, strip of 15 → 2 strips + 3. */
export function toPacks(units: number, packSize: number): { packs: number; loose: number } {
  const size = Math.max(1, packSize);
  const sign = units < 0 ? -1 : 1;
  const abs = Math.abs(units);
  return { packs: sign * Math.floor(abs / size), loose: sign * (abs % size) };
}

export function formatQty(units: number, packSize: number, unitLabel = "tab"): string {
  if (packSize <= 1) return `${units}`;
  const { packs, loose } = toPacks(units, packSize);
  if (loose === 0) return `${packs}×${packSize}`;
  if (packs === 0) return `${loose} ${unitLabel}`;
  return `${packs}×${packSize} + ${loose} ${unitLabel}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar date as 'YYYY-MM-DD' (not UTC). */
export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Parse what is printed on a strip ("08/27", "8/2027", "08-27") into the
 * last day of that month. Medicines are usable until the end of the expiry month.
 */
export function parseExpiry(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})\s*[/\-.]\s*(\d{2}|\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  let year = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (year < 100) year += 2000;
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${pad2(month)}-${pad2(lastDay)}`;
}

/** '2027-08-31' → '08/27', the way it is printed on bills. */
export function formatExpiry(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

export type ExpiryStatus = "EXPIRED" | "NEAR" | "OK";

export function expiryStatus(expiryIso: string, todayIso: string, nearDays: number): ExpiryStatus {
  if (expiryIso < todayIso) return "EXPIRED";
  const days = (Date.parse(expiryIso) - Date.parse(todayIso)) / 86_400_000;
  return days <= nearDays ? "NEAR" : "OK";
}
