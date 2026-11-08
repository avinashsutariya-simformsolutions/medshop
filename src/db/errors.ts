import type { StringKey } from "../i18n/strings";

/**
 * Turn a raw SQLite / trigger error into a message key the user can understand.
 * Unknown errors fall back to the generic message plus the raw text.
 */
export function dbErrorKey(e: unknown): { key: StringKey; raw: string } {
  const raw = e instanceof Error ? e.message : String(e);
  const rules: [RegExp, StringKey][] = [
    [/STOCK_NEGATIVE/, "errStockNegative"],
    [/GST_RATE_INVALID/, "errGstInvalid"],
    [/SALE_RATE_ABOVE_MRP/, "errSaleAboveMrp"],
    [/UNIQUE constraint failed: items\.barcode/, "errBarcodeUsed"],
    [/UNIQUE constraint failed: companies\.name/, "errCompanyExists"],
    [/UNIQUE constraint failed/, "errDuplicate"],
    [/FOREIGN KEY constraint failed/, "errInUse"],
    [/database is locked|SQLITE_BUSY/, "errBusy"],
  ];
  for (const [re, key] of rules) if (re.test(raw)) return { key, raw };
  return { key: "errUnknown", raw };
}
