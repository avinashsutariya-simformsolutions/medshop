import type { FieldId } from "./fields";

/** Every problem the importer can report. Each has a message in i18n/strings.ts as `imp_<code>`. */
export type IssueCode =
  | "NAME_MISSING"
  | "TOO_LONG"
  | "BATCH_INCOMPLETE"
  | "EXPIRY_INVALID"
  | "MRP_MISSING"
  | "NUMBER_INVALID"
  | "QTY_INVALID"
  | "QTY_NEGATIVE"
  | "SALE_ABOVE_MRP"
  | "GST_INVALID"
  | "PACK_INVALID"
  | "GST_OLD_12"
  | "GST_DEFAULTED"
  | "PACK_DEFAULTED"
  | "EXPIRED"
  | "PRATE_ABOVE_MRP"
  | "DUP_MERGED"
  | "BARCODE_DUP"
  | "BARCODE_BAD"
  | "SCHEDULE_UNKNOWN"
  | "QTY_ZERO"
  | "GSTIN_INVALID"
  | "DUP_NAME";

export const ERROR_CODES: ReadonlySet<IssueCode> = new Set<IssueCode>([
  "NAME_MISSING",
  "TOO_LONG",
  "BATCH_INCOMPLETE",
  "EXPIRY_INVALID",
  "MRP_MISSING",
  "NUMBER_INVALID",
  "QTY_INVALID",
  "QTY_NEGATIVE",
  "SALE_ABOVE_MRP",
  "GST_INVALID",
  "PACK_INVALID",
]);

export interface Issue {
  rowNo: number;
  code: IssueCode;
  field?: FieldId;
  value?: string;
}

export function isError(i: Issue): boolean {
  return ERROR_CODES.has(i.code);
}

/** Group issues by code for a compact summary: "Expiry not understood — 12 rows (5, 9, 14 …)". */
export function groupIssues(issues: Issue[]): { code: IssueCode; error: boolean; rows: number[]; sample?: string }[] {
  const map = new Map<IssueCode, { rows: number[]; sample?: string }>();
  for (const i of issues) {
    const g = map.get(i.code) ?? { rows: [] };
    g.rows.push(i.rowNo);
    if (g.sample === undefined && i.value) g.sample = i.value;
    map.set(i.code, g);
  }
  return [...map.entries()]
    .map(([code, g]) => ({ code, error: ERROR_CODES.has(code), ...g }))
    .sort((a, b) => Number(b.error) - Number(a.error) || b.rows.length - a.rows.length);
}
