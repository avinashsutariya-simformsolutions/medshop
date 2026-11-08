// Opening stock / medicine list import.
// validateStock: records from the sheet → clean rows + issues (pure, tested).
// planStock:     clean rows → one transaction of SQL statements (pure, tested against SQLite).

import { Batch } from "../../db/batch";
import type { Schedule } from "../../db/types";
import { DEFAULT_GST_BP, parseGst, type GstRateBp } from "../gst";
import type { FieldId } from "./fields";
import { ERROR_CODES as ERROR_SET, type Issue } from "./issues";
import type { Cell } from "./mapping";
import * as v from "./values";

export interface StockRow {
  rowNo: number;
  name: string;
  company: string | null;
  salt: string | null;
  packSize: number;
  unit: string;
  hsn: string | null;
  gstBp: GstRateBp;
  schedule: Schedule;
  rack: string | null;
  barcode: string | null;
  batch: {
    batchNo: string;
    expiry: string;
    mrpPaise: number;
    purchasePaise: number;
    salePaise: number;
    qtyUnits: number;
  } | null;
}

export interface StockValidation {
  rows: StockRow[];
  issues: Issue[];
  /** Data rows read from the sheet (after the header, excluding blank and total rows). */
  total: number;
  skipped: number;
}

type Rec = { rowNo: number; values: Partial<Record<FieldId, Cell>> };

const MAX = { name: 120, batch: 30, text: 200 };

export function itemKey(r: Pick<StockRow, "name" | "company" | "packSize">): string {
  return `${r.name.toLowerCase()}|${(r.company ?? "").toLowerCase()}|${r.packSize}`;
}

function batchKey(r: StockRow): string {
  const b = r.batch!;
  return `${itemKey(r)}|${b.batchNo.toLowerCase()}|${b.expiry}|${b.mrpPaise}`;
}

export function validateStock(records: Rec[], today: string): StockValidation {
  const issues: Issue[] = [];
  const rows: StockRow[] = [];
  const byBatch = new Map<string, StockRow>();
  const barcodeOwner = new Map<string, string>();
  let total = 0;
  let skipped = 0;

  for (const { rowNo, values: c } of records) {
    const name = v.text(c.name);
    // Report footers like "Total" / "Grand Total" are not medicines.
    if (name && /^(grand\s*)?total\b/i.test(name)) continue;
    total++;
    const rowIssues: Issue[] = [];
    const add = (code: Issue["code"], field?: FieldId, value?: Cell) =>
      rowIssues.push({ rowNo, code, field, value: value === undefined || value === null ? undefined : String(value) });

    if (!name) add("NAME_MISSING", "name");
    else if (name.length > MAX.name) add("TOO_LONG", "name", name.slice(0, 40));

    // Pack size and unit
    let packSize = 1;
    let unit: string | null = v.unit(c.unit);
    const p = v.pack(c.pack);
    if (p === null) add("PACK_DEFAULTED", "pack");
    else if ("error" in p) add("PACK_INVALID", "pack", c.pack);
    else {
      packSize = p.value.packSize;
      unit = unit ?? p.value.unit;
    }
    unit = unit ?? (packSize > 1 ? "TAB" : "PCS");

    // GST
    let gstBp: GstRateBp = DEFAULT_GST_BP;
    if (v.isBlank(c.gst)) add("GST_DEFAULTED", "gst");
    else {
      const g = parseGst(c.gst);
      if (g.bp === null) add("GST_INVALID", "gst", c.gst);
      else {
        gstBp = g.bp;
        if (g.note === "OLD_12_TO_5") add("GST_OLD_12", "gst");
      }
    }

    // Schedule
    let schedule: Schedule = "OTC";
    const s = v.schedule(c.schedule);
    if (s && "error" in s) add("SCHEDULE_UNKNOWN", "schedule", c.schedule);
    else if (s) schedule = s.value;

    // Barcode
    let barcode: string | null = null;
    const bc = v.barcode(c.barcode);
    if (bc && "error" in bc) add("BARCODE_BAD", "barcode", c.barcode);
    else if (bc) barcode = bc.value;

    // Batch: only when any batch column has a value
    let batch: StockRow["batch"] = null;
    const hasBatch = !v.isBlank(c.batch) || !v.isBlank(c.expiry) || !v.isBlank(c.qty) || !v.isBlank(c.loose);
    if (hasBatch) {
      const batchNo = v.text(c.batch);
      const exp = v.expiry(c.expiry);
      const mrp = v.money(c.mrp);
      const pr = v.money(c.purchaseRate);
      const sr = v.money(c.saleRate);
      const q = v.qtyUnits(c.qty, packSize, c.loose);

      if (!batchNo || !exp) add("BATCH_INCOMPLETE", !batchNo ? "batch" : "expiry");
      if (batchNo && batchNo.length > MAX.batch) add("TOO_LONG", "batch", batchNo.slice(0, 40));
      if (exp && "error" in exp) add("EXPIRY_INVALID", "expiry", c.expiry);
      if (!mrp) add("MRP_MISSING", "mrp");
      else if ("error" in mrp || mrp.value <= 0) add("NUMBER_INVALID", "mrp", c.mrp);
      if (pr && "error" in pr) add("NUMBER_INVALID", "purchaseRate", c.purchaseRate);
      if (sr && "error" in sr) add("NUMBER_INVALID", "saleRate", c.saleRate);
      if (q && "error" in q) add("QTY_INVALID", "qty", c.qty);
      else if (q && q.value < 0) add("QTY_NEGATIVE", "qty", c.qty);

      const ready =
        batchNo && exp && !("error" in exp) && mrp && !("error" in mrp) && mrp.value > 0 &&
        !(pr && "error" in pr) && !(sr && "error" in sr) && !(q && "error" in q);
      if (ready) {
        const mrpPaise = mrp.value;
        const purchasePaise = pr ? pr.value : 0;
        const salePaise = sr ? sr.value : mrpPaise;
        const qtyUnits = q ? q.value : 0;
        if (salePaise > mrpPaise) add("SALE_ABOVE_MRP", "saleRate", c.saleRate);
        if (purchasePaise > mrpPaise) add("PRATE_ABOVE_MRP", "purchaseRate", c.purchaseRate);
        if (exp.value < today) add("EXPIRED", "expiry", c.expiry);
        if (qtyUnits === 0) add("QTY_ZERO", "qty");
        batch = { batchNo: batchNo.toUpperCase(), expiry: exp.value, mrpPaise, purchasePaise, salePaise, qtyUnits };
      }
    }

    issues.push(...rowIssues);
    if (rowIssues.some((i) => ERROR_SET.has(i.code)) || !name) {
      skipped++;
      continue;
    }

    const row: StockRow = {
      rowNo,
      name,
      company: v.text(c.company)?.slice(0, MAX.text) ?? null,
      salt: v.text(c.salt)?.slice(0, MAX.text) ?? null,
      packSize,
      unit,
      hsn: v.text(c.hsn)?.replace(/\D/g, "").slice(0, 8) || null,
      gstBp,
      schedule,
      rack: v.text(c.rack)?.slice(0, 30) ?? null,
      barcode,
      batch,
    };

    if (row.barcode) {
      const owner = barcodeOwner.get(row.barcode);
      if (owner && owner !== itemKey(row)) {
        issues.push({ rowNo, code: "BARCODE_DUP", field: "barcode", value: row.barcode });
        row.barcode = null;
      } else barcodeOwner.set(row.barcode, itemKey(row));
    }

    // Same item + batch twice in the file (e.g. two racks) → one batch, quantities added.
    if (row.batch) {
      const k = batchKey(row);
      const prev = byBatch.get(k);
      if (prev?.batch) {
        prev.batch.qtyUnits += row.batch.qtyUnits;
        issues.push({ rowNo, code: "DUP_MERGED" });
        continue;
      }
      byBatch.set(k, row);
    }
    rows.push(row);
  }
  return { rows, issues, total, skipped };
}


// ---------- SQL ----------

const ITEM_ID = `(SELECT id FROM items
   WHERE name = $1 AND pack_size = $3
     AND IFNULL(company_id, -1) = IFNULL((SELECT id FROM companies WHERE name = $2), -1)
   ORDER BY id LIMIT 1)`;

export const STOCK_SQL = {
  company: `INSERT OR IGNORE INTO companies (name) VALUES ($1)`,
  // New medicines only: an existing item (same name + company + pack) keeps its details.
  item: `INSERT INTO items (name, company_id, pack_size, salt, unit, hsn, gst_rate_bp, schedule, rack, barcode)
    SELECT $1, (SELECT id FROM companies WHERE name = $2), $3, $4, $5, $6, $7, $8, $9,
           CASE WHEN $10 IS NULL OR EXISTS (SELECT 1 FROM items WHERE barcode = $10) THEN NULL ELSE $10 END
    WHERE ${ITEM_ID} IS NULL`,
  batch: `INSERT OR IGNORE INTO batches (item_id, batch_no, expiry, mrp_paise, purchase_rate_paise, sale_rate_paise)
    VALUES (${ITEM_ID}, $4, $5, $6, $7, $8)`,
  move: `INSERT INTO stock_moves (batch_id, qty_units, reason, note)
    SELECT b.id, $7, 'OPENING', $8 FROM batches b
    WHERE b.item_id = ${ITEM_ID} AND b.batch_no = $4 AND b.expiry = $5 AND b.mrp_paise = $6`,
  log: `INSERT INTO import_log (kind, file_name, rows_total, rows_imported, rows_skipped) VALUES ($1, $2, $3, $4, $5)`,
  mapping: `INSERT INTO import_mappings (kind, signature, mapping) VALUES ($1, $2, $3)
    ON CONFLICT (kind, signature) DO UPDATE SET mapping = excluded.mapping, updated_at = datetime('now','localtime')`,
};

export interface PlanMeta {
  fileName: string;
  total: number;
  skipped: number;
  signature: string;
  mappingJson: string;
}

/** Step indexes let the caller count what was really created (rows_affected per step). */
export interface StockPlan {
  batch: Batch;
  itemSteps: number[];
  batchSteps: number[];
  moveSteps: number[];
}

export function planStock(rows: StockRow[], meta: PlanMeta): StockPlan {
  const b = new Batch();
  const plan: StockPlan = { batch: b, itemSteps: [], batchSteps: [], moveSteps: [] };
  const companies = new Set<string>();
  const items = new Set<string>();

  for (const r of rows) {
    if (r.company && !companies.has(r.company.toLowerCase())) {
      companies.add(r.company.toLowerCase());
      b.add(STOCK_SQL.company, [r.company]);
    }
    const key = itemKey(r);
    if (!items.has(key)) {
      items.add(key);
      plan.itemSteps.push(b.size);
      b.add(STOCK_SQL.item, [r.name, r.company, r.packSize, r.salt, r.unit, r.hsn, r.gstBp, r.schedule, r.rack, r.barcode]);
    }
    if (r.batch) {
      const k = [r.name, r.company, r.packSize, r.batch.batchNo, r.batch.expiry, r.batch.mrpPaise];
      plan.batchSteps.push(b.size);
      b.add(STOCK_SQL.batch, [...k, r.batch.purchasePaise, r.batch.salePaise]);
      if (r.batch.qtyUnits > 0) {
        plan.moveSteps.push(b.size);
        b.add(STOCK_SQL.move, [...k, r.batch.qtyUnits, `Import: ${meta.fileName} row ${r.rowNo}`]);
      }
    }
  }
  b.add(STOCK_SQL.log, ["STOCK", meta.fileName, meta.total, rows.length, meta.skipped]);
  b.add(STOCK_SQL.mapping, ["STOCK", meta.signature, meta.mappingJson]);
  return plan;
}

export function stockTotals(rows: StockRow[]) {
  let units = 0;
  let mrpValue = 0;
  let purchaseValue = 0;
  for (const r of rows) {
    if (!r.batch) continue;
    units += r.batch.qtyUnits;
    mrpValue += Math.round((r.batch.mrpPaise * r.batch.qtyUnits) / r.packSize);
    purchaseValue += Math.round((r.batch.purchasePaise * r.batch.qtyUnits) / r.packSize);
  }
  return {
    items: new Set(rows.map(itemKey)).size,
    batches: rows.filter((r) => r.batch).length,
    units,
    mrpValue,
    purchaseValue,
  };
}
