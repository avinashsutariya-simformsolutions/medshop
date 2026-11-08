// Supplier / customer list import.

import { Batch } from "../../db/batch";
import type { FieldId } from "./fields";
import { ERROR_CODES, type Issue } from "./issues";
import type { Cell } from "./mapping";
import * as v from "./values";

export type PartyKind = "SUPPLIERS" | "CUSTOMERS";

export interface PartyRow {
  rowNo: number;
  name: string;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  dlNo: string | null;
  openingPaise: number;
  creditLimitPaise: number;
}

type Rec = { rowNo: number; values: Partial<Record<FieldId, Cell>> };

export function validateParties(records: Rec[]): { rows: PartyRow[]; issues: Issue[]; total: number; skipped: number } {
  const rows: PartyRow[] = [];
  const issues: Issue[] = [];
  const seen = new Map<string, number>();
  let total = 0;
  let skipped = 0;

  for (const { rowNo, values: c } of records) {
    const name = v.text(c.name);
    if (name && /^(grand\s*)?total\b/i.test(name)) continue;
    total++;
    const rowIssues: Issue[] = [];
    const add = (code: Issue["code"], field?: FieldId, value?: Cell) =>
      rowIssues.push({ rowNo, code, field, value: value == null ? undefined : String(value) });

    if (!name) add("NAME_MISSING", "name");
    else if (name.length > 120) add("TOO_LONG", "name", name.slice(0, 40));

    const opening = v.money(c.openingBalance);
    if (opening && "error" in opening) add("NUMBER_INVALID", "openingBalance", c.openingBalance);
    const limit = v.money(c.creditLimit);
    if (limit && "error" in limit) add("NUMBER_INVALID", "creditLimit", c.creditLimit);

    let gstin: string | null = null;
    const g = v.gstin(c.gstin);
    if (g && "error" in g) add("GSTIN_INVALID", "gstin", c.gstin);
    else if (g) gstin = g.value;

    if (name && seen.has(name.toLowerCase())) add("DUP_NAME", "name");

    issues.push(...rowIssues);
    if (!name || rowIssues.some((i) => ERROR_CODES.has(i.code) || i.code === "DUP_NAME")) {
      skipped++;
      continue;
    }
    seen.set(name.toLowerCase(), rowNo);
    rows.push({
      rowNo,
      name,
      phone: v.phone(c.phone),
      address: v.text(c.address)?.slice(0, 300) ?? null,
      gstin,
      dlNo: v.text(c.dlNo)?.slice(0, 60) ?? null,
      openingPaise: opening && !("error" in opening) ? opening.value : 0,
      creditLimitPaise: limit && !("error" in limit) ? limit.value : 0,
    });
  }
  return { rows, issues, total, skipped };
}

export const PARTY_SQL = {
  SUPPLIERS: `INSERT INTO suppliers (name, phone, address, gstin, dl_no, opening_balance_paise)
    SELECT $1, $2, $3, $4, $5, $6 WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = $1)`,
  CUSTOMERS: `INSERT INTO customers (name, phone, address, gstin, opening_balance_paise, credit_limit_paise)
    SELECT $1, $2, $3, $4, $5, $6 WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name = $1)`,
};

export function planParties(
  kind: PartyKind,
  rows: PartyRow[],
  meta: { fileName: string; total: number; skipped: number; signature: string; mappingJson: string },
): { batch: Batch; partySteps: number[] } {
  const b = new Batch();
  const partySteps: number[] = [];
  for (const r of rows) {
    partySteps.push(b.size);
    if (kind === "SUPPLIERS") b.add(PARTY_SQL.SUPPLIERS, [r.name, r.phone, r.address, r.gstin, r.dlNo, r.openingPaise]);
    else b.add(PARTY_SQL.CUSTOMERS, [r.name, r.phone, r.address, r.gstin, r.openingPaise, r.creditLimitPaise]);
  }
  b.add(`INSERT INTO import_log (kind, file_name, rows_total, rows_imported, rows_skipped) VALUES ($1, $2, $3, $4, $5)`, [
    kind,
    meta.fileName,
    meta.total,
    rows.length,
    meta.skipped,
  ]);
  b.add(
    `INSERT INTO import_mappings (kind, signature, mapping) VALUES ($1, $2, $3)
     ON CONFLICT (kind, signature) DO UPDATE SET mapping = excluded.mapping, updated_at = datetime('now','localtime')`,
    [kind, meta.signature, meta.mappingJson],
  );
  return { batch: b, partySteps };
}
