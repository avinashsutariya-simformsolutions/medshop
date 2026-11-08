import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Batch } from "../../db/batch";
import { parseGst } from "../gst";
import { detectHeaderRow, extractRecords, guessMapping, headerSignature, missingRequired } from "./mapping";
import { planParties, validateParties } from "./partyImport";
import { parseCsvText } from "./read";
import { planStock, stockTotals, validateStock } from "./stockImport";
import * as v from "./values";

const root = new URL("../../../", import.meta.url);
const file = (p: string) => readFileSync(new URL(p, root), "utf8");
const TODAY = "2026-11-07";

/** Fresh database with the real migrations, like a new install. */
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(file("src-tauri/migrations/001_init.sql"));
  db.exec(file("src-tauri/migrations/002_gst2_and_imports.sql"));
  return db;
}

/** Same behaviour as run_batch in Rust: one transaction, all or nothing. */
function runBatch(db: DatabaseSync, batch: Batch): number[] {
  const affected: number[] = [];
  db.exec("BEGIN");
  try {
    for (const { sql, params } of batch.toList()) {
      // sqlx reads $1 as parameter 1; node:sqlite needs ?1 for the same meaning.
      const r = db.prepare(sql.replace(/\$(\d+)/g, "?$1")).run(...params);
      affected.push(Number(r.changes));
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return affected;
}

function one<T>(db: DatabaseSync, sql: string, ...params: (string | number)[]): T {
  return db.prepare(sql).get(...params) as T;
}

describe("value parsers", () => {
  it.each([
    ["08/27", "2027-08-31"],
    ["8/2027", "2027-08-31"],
    ["08-27", "2027-08-31"],
    ["0628", "2028-06-30"],
    ["Jan-28", "2028-01-31"],
    ["AUG 2027", "2027-08-31"],
    ["september/27", "2027-09-30"],
    ["31/08/2027", "2027-08-31"],
    ["2027-05-31", "2027-05-31"],
    ["2/2028", "2028-02-29"],
    ["12-Mar-2027", "2027-03-31"],
  ])("expiry %s → %s", (input, out) => {
    expect(v.expiry(input)).toEqual({ value: out });
  });

  it("reads Excel dates and serial numbers as expiry", () => {
    expect(v.expiry(new Date(Date.UTC(2027, 7, 1)))).toEqual({ value: "2027-08-31" });
    expect(v.expiry(46600)).toEqual({ value: "2027-08-31" }); // Excel serial 46600 = 2027-08-01
  });

  it("rejects bad expiry", () => {
    expect(v.expiry("13/27")).toEqual({ error: true });
    expect(v.expiry("soon")).toEqual({ error: true });
    expect(v.expiry("")).toBeNull();
  });

  it.each([
    ["15's", 15, null],
    ["1x15", 15, null],
    ["10X10", 10, null],
    ["15 TAB", 15, "TAB"],
    ["20 CAP", 20, "CAP"],
    ["150ML", 1, "BTL"],
    ["30 GM", 1, "PCS"],
  ])("pack %s → %i %s", (input, size, unit) => {
    expect(v.pack(input)).toEqual({ value: { packSize: size, unit } });
  });

  it("reads quantities in packs, half strips and packs:loose", () => {
    expect(v.qtyUnits(3, 15)).toEqual({ value: 45 });
    expect(v.qtyUnits("2:5", 15)).toEqual({ value: 35 });
    expect(v.qtyUnits(2.5, 10)).toEqual({ value: 25 });
    expect(v.qtyUnits(2.5, 15)).toEqual({ error: true }); // 37.5 tablets is not possible
    expect(v.qtyUnits(1, 10, 4)).toEqual({ value: 14 });
  });

  it("reads money in Indian formats", () => {
    expect(v.money("₹1,234.50")).toEqual({ value: 123450 });
    expect(v.money("Rs. 34.10/-")).toEqual({ value: 3410 });
    expect(v.money("abc")).toEqual({ error: true });
  });

  it("maps old GST rates to GST 2.0", () => {
    expect(parseGst("12")).toEqual({ bp: 500, note: "OLD_12_TO_5" });
    expect(parseGst("5%")).toEqual({ bp: 500 });
    expect(parseGst(0.18)).toEqual({ bp: 1800 });
    expect(parseGst("0")).toEqual({ bp: 0 });
    expect(parseGst("28")).toEqual({ bp: null });
  });

  it("reads schedules and keeps barcodes intact", () => {
    expect(v.schedule("Sch. H1")).toEqual({ value: "H1" });
    expect(v.schedule("SCHEDULE H")).toEqual({ value: "H" });
    expect(v.schedule("")).toBeNull();
    expect(v.schedule("weird")).toEqual({ error: true });
    expect(v.barcode(8901234567890)).toEqual({ value: "8901234567890" });
    expect(v.barcode("8.90123E+12")).toEqual({ error: true });
  });

  it("cleans phone numbers and checks GSTIN", () => {
    expect(v.phone("+91 98220 11223")).toBe("9822011223");
    expect(v.phone("09850012345")).toBe("9850012345");
    expect(v.phone("020-24456677")).toBe("02024456677");
    expect(v.gstin("27aaacs1234f1z5")).toEqual({ value: "27AAACS1234F1Z5" });
    expect(v.gstin("27INVALID")).toEqual({ error: true });
  });
});

describe("column mapping", () => {
  const grid = parseCsvText(file("templates/sample-opening-stock.csv"));

  it("finds the header below the report title", () => {
    expect(detectHeaderRow(grid, "STOCK")).toBe(3);
  });

  it("guesses every column of a typical stock report", () => {
    const m = guessMapping(grid[3], "STOCK");
    expect(Object.values(m).sort()).toEqual(
      ["batch", "company", "expiry", "gst", "mrp", "name", "pack", "purchaseRate", "qty", "rack", "schedule"].sort(),
    );
    expect(missingRequired(m, "STOCK")).toEqual([]);
    expect(headerSignature(grid[3])).toContain("batchno|exp|mrp");
  });
});

describe("stock import, end to end", () => {
  const grid = parseCsvText(file("templates/sample-opening-stock.csv"));
  const h = detectHeaderRow(grid, "STOCK");
  const mapping = guessMapping(grid[h], "STOCK");
  const result = validateStock(extractRecords(grid, h, mapping), TODAY);
  const codes = (code: string) => result.issues.filter((i) => i.code === code).map((i) => i.rowNo);

  it("skips bad rows and explains why", () => {
    expect(result.total).toBe(29); // the "Total" footer is not counted
    expect(codes("EXPIRY_INVALID")).toEqual([23]); // LIMCEE 13/27
    expect(codes("MRP_MISSING")).toEqual([24]); // NEUROBION
    expect(result.skipped).toBe(2);
  });

  it("warns without skipping", () => {
    expect(codes("GST_OLD_12")).toEqual([5]);
    expect(codes("EXPIRED")).toEqual([15]); // ECOSPRIN 10/26
    expect(codes("DUP_MERGED")).toEqual([13]); // second TELMA row
  });

  it("writes items, batches and stock in one transaction", () => {
    const db = freshDb();
    const plan = planStock(result.rows, { fileName: "sample.csv", total: result.total, skipped: result.skipped, signature: "sig", mappingJson: "{}" });
    const affected = runBatch(db, plan.batch);

    const items = plan.itemSteps.filter((i) => affected[i] === 1).length;
    expect(items).toBe(25); // 29 rows − 2 skipped − 1 merged = 26 batches; DOLO has 2 batches
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM items").n).toBe(25);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM batches").n).toBe(26);

    const telma = one<{ q: number }>(db, "SELECT qty_units q FROM batches WHERE batch_no = 'TL8812'");
    expect(telma.q).toBe(300); // (6 + 4) strips × 30
    const atarax = one<{ q: number }>(db, "SELECT qty_units q FROM batches WHERE batch_no = 'AT1121'");
    expect(atarax.q).toBe(35); // 2:5 → 2 strips of 15 + 5
    const dolo = one<{ g: number }>(db, "SELECT gst_rate_bp g FROM items WHERE name = 'DOLO 650 TAB'");
    expect(dolo.g).toBe(500);
    const syrup = one<{ p: number; u: string }>(db, "SELECT pack_size p, unit u FROM items WHERE name = 'BENADRYL COUGH SYP'");
    expect(syrup).toEqual({ p: 1, u: "BTL" });

    // Search finds imported items by salt-less name prefix and by company
    const hits = db.prepare(`SELECT rowid FROM items_fts WHERE items_fts MATCH '"glen"*'`).all();
    expect(hits.length).toBe(1);

    const totals = stockTotals(result.rows);
    const ledger = one<{ u: number }>(db, "SELECT SUM(qty_units) u FROM stock_moves WHERE reason = 'OPENING'");
    expect(ledger.u).toBe(totals.units);
  });

  it("importing the same file again adds stock but no duplicate items or batches", () => {
    const db = freshDb();
    const meta = { fileName: "s.csv", total: result.total, skipped: result.skipped, signature: "sig", mappingJson: "{}" };
    runBatch(db, planStock(result.rows, meta).batch);
    const second = planStock(result.rows, meta);
    const affected = runBatch(db, second.batch);
    expect(second.itemSteps.filter((i) => affected[i] === 1).length).toBe(0);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM batches").n).toBe(26);
    // This is why the import screen warns before a second opening-stock import.
    expect(one<{ q: number }>(db, "SELECT qty_units q FROM batches WHERE batch_no = 'AT1121'").q).toBe(70);
  });

  it("rolls back everything when one statement fails", () => {
    const db = freshDb();
    const plan = planStock(result.rows, { fileName: "s.csv", total: 1, skipped: 0, signature: "s", mappingJson: "{}" });
    plan.batch.add("INSERT INTO stock_moves (batch_id, qty_units, reason) VALUES (1, -99999, 'ADJUSTMENT')");
    expect(() => runBatch(db, plan.batch)).toThrow(/STOCK_NEGATIVE/);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM items").n).toBe(0);
  });
});

describe("supplier import", () => {
  it("validates, skips duplicates and saves", () => {
    const grid = parseCsvText(file("templates/sample-suppliers.csv"));
    const h = detectHeaderRow(grid, "SUPPLIERS");
    const mapping = guessMapping(grid[h], "SUPPLIERS");
    expect(Object.values(mapping).sort()).toEqual(["address", "dlNo", "gstin", "name", "openingBalance", "phone"].sort());
    const r = validateParties(extractRecords(grid, h, mapping));
    expect(r.rows.map((x) => x.name)).toEqual(["Shree Ganesh Pharma Distributors", "Mahalaxmi Medical Agencies", "Om Sai Pharma"]);
    expect(r.issues.map((i) => i.code).sort()).toEqual(["DUP_NAME", "GSTIN_INVALID"]);
    expect(r.rows[0]).toMatchObject({ phone: "9822011223", openingPaise: 1542050 });
    expect(r.rows[1].phone).toBe("02024456677"); // landline keeps its STD code

    const db = freshDb();
    runBatch(db, planParties("SUPPLIERS", r.rows, { fileName: "s.csv", total: r.total, skipped: r.skipped, signature: "x", mappingJson: "{}" }).batch);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM suppliers").n).toBe(3);
  });
});
