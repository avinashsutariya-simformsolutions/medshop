// Reads and writes for the master lists: medicines, companies, suppliers, customers.
import { isoDate } from "../lib/stock";
import { Batch } from "./batch";
import { query, queryOne } from "./index";
import { SEARCH_SELECT, searchItems } from "./repo";
import type { ItemSearchRow, Schedule } from "./types";

// ---------- Medicines ----------

export async function listItems(q: string, limit = 200): Promise<ItemSearchRow[]> {
  if (q.trim()) return searchItems(q, limit);
  return query<ItemSearchRow>(
    `${SEARCH_SELECT}
     FROM (SELECT * FROM items WHERE is_active = 1 ORDER BY name LIMIT $1) i
     LEFT JOIN companies c ON c.id = i.company_id
     LEFT JOIN batches b ON b.item_id = i.id
     GROUP BY i.id
     ORDER BY i.name`,
    [limit, isoDate()],
  );
}

export async function countItems(): Promise<number> {
  const r = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE is_active = 1");
  return r?.n ?? 0;
}

export interface ItemForm {
  name: string;
  company: string;
  salt: string;
  unit: string;
  packSize: number;
  hsn: string;
  gstBp: number;
  schedule: Schedule;
  rack: string;
  barcode: string;
  /** In packs on screen; stored in units. */
  reorderPacks: number;
}

export interface ItemRecord extends ItemForm {
  id: number;
}

export async function getItem(id: number): Promise<ItemRecord | null> {
  const r = await queryOne<{
    id: number; name: string; company: string | null; salt: string | null; unit: string; pack_size: number;
    hsn: string | null; gst_rate_bp: number; schedule: Schedule; rack: string | null; barcode: string | null; reorder_level: number;
  }>(
    `SELECT i.id, i.name, c.name AS company, i.salt, i.unit, i.pack_size, i.hsn, i.gst_rate_bp, i.schedule,
            i.rack, i.barcode, i.reorder_level
     FROM items i LEFT JOIN companies c ON c.id = i.company_id WHERE i.id = $1`,
    [id],
  );
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    company: r.company ?? "",
    salt: r.salt ?? "",
    unit: r.unit,
    packSize: r.pack_size,
    hsn: r.hsn ?? "",
    gstBp: r.gst_rate_bp,
    schedule: r.schedule,
    rack: r.rack ?? "",
    barcode: r.barcode ?? "",
    reorderPacks: Math.round(r.reorder_level / Math.max(1, r.pack_size)),
  };
}

const nul = (s: string) => (s.trim() === "" ? null : s.trim());

/** Insert or update a medicine; creates the company if it is new. Returns the item id. */
export async function saveItem(f: ItemForm, id?: number): Promise<number> {
  const b = new Batch();
  const company = nul(f.company);
  if (company) b.add("INSERT OR IGNORE INTO companies (name) VALUES ($1)", [company]);
  const params = [
    f.name.trim(),
    company,
    nul(f.salt),
    f.unit,
    f.packSize,
    nul(f.hsn),
    f.gstBp,
    f.schedule,
    nul(f.rack),
    nul(f.barcode),
    f.reorderPacks * f.packSize,
  ];
  if (id) {
    b.add(
      `UPDATE items SET name = $1, company_id = (SELECT id FROM companies WHERE name = $2), salt = $3, unit = $4,
         pack_size = $5, hsn = $6, gst_rate_bp = $7, schedule = $8, rack = $9, barcode = $10, reorder_level = $11,
         updated_at = datetime('now','localtime')
       WHERE id = $12`,
      [...params, id],
    );
    await b.run();
    return id;
  }
  b.add(
    `INSERT INTO items (name, company_id, salt, unit, pack_size, hsn, gst_rate_bp, schedule, rack, barcode, reorder_level)
     VALUES ($1, (SELECT id FROM companies WHERE name = $2), $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    params,
  );
  const res = await b.run();
  return res.last_ids[res.last_ids.length - 1];
}

/** Medicines with the same name, to warn before creating a duplicate. */
export async function findSameName(name: string, excludeId?: number) {
  if (!name.trim()) return [];
  return query<{ id: number; name: string; company: string | null; pack_size: number }>(
    `SELECT i.id, i.name, c.name AS company, i.pack_size FROM items i
     LEFT JOIN companies c ON c.id = i.company_id
     WHERE i.name = $1 AND i.id <> $2 LIMIT 5`,
    [name.trim(), excludeId ?? 0],
  );
}

export async function listCompanyNames(): Promise<string[]> {
  const rows = await query<{ name: string }>("SELECT name FROM companies ORDER BY name LIMIT 3000");
  return rows.map((r) => r.name);
}

export interface BatchRow {
  id: number;
  batch_no: string;
  expiry: string;
  mrp_paise: number;
  purchase_rate_paise: number;
  sale_rate_paise: number;
  qty_units: number;
}

export async function getBatches(itemId: number): Promise<BatchRow[]> {
  return query<BatchRow>(
    `SELECT id, batch_no, expiry, mrp_paise, purchase_rate_paise, sale_rate_paise, qty_units
     FROM batches WHERE item_id = $1 ORDER BY (qty_units > 0) DESC, expiry`,
    [itemId],
  );
}

// ---------- Suppliers and customers ----------

export type PartyTable = "suppliers" | "customers";

export interface Party {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  dl_no?: string | null;
  credit_limit_paise?: number;
  opening_balance_paise: number;
}

export async function listParties(table: PartyTable, q: string): Promise<Party[]> {
  const like = `%${q.trim()}%`;
  return query<Party>(
    `SELECT * FROM ${table}
     WHERE $1 = '%%' OR name LIKE $1 OR phone LIKE $1 OR gstin LIKE $1
     ORDER BY name LIMIT 500`,
    [like],
  );
}

export interface PartyForm {
  name: string;
  phone: string;
  address: string;
  gstin: string;
  dlNo: string;
  openingRupees: string;
  creditLimitRupees: string;
}

export async function saveParty(table: PartyTable, f: PartyForm, id?: number): Promise<number> {
  const paise = (s: string) => Math.round((Number(s.replace(/,/g, "")) || 0) * 100);
  const common = [f.name.trim(), nul(f.phone), nul(f.address), nul(f.gstin.toUpperCase()), paise(f.openingRupees)];
  const extra = table === "suppliers" ? nul(f.dlNo) : paise(f.creditLimitRupees);
  const extraCol = table === "suppliers" ? "dl_no" : "credit_limit_paise";
  const b = new Batch();
  if (id) {
    b.add(
      `UPDATE ${table} SET name = $1, phone = $2, address = $3, gstin = $4, opening_balance_paise = $5, ${extraCol} = $6 WHERE id = $7`,
      [...common, extra, id],
    );
    await b.run();
    return id;
  }
  b.add(
    `INSERT INTO ${table} (name, phone, address, gstin, opening_balance_paise, ${extraCol}) VALUES ($1, $2, $3, $4, $5, $6)`,
    [...common, extra],
  );
  const r = await b.run();
  return r.last_ids[0];
}

// ---------- Import helpers ----------

export async function loadSavedMapping(kind: string, signature: string): Promise<Record<number, string> | null> {
  const r = await queryOne<{ mapping: string }>(
    "SELECT mapping FROM import_mappings WHERE kind = $1 AND signature = $2",
    [kind, signature],
  );
  if (!r) return null;
  try {
    return JSON.parse(r.mapping);
  } catch {
    return null;
  }
}

export async function openingStockEntries(): Promise<number> {
  const r = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM stock_moves WHERE reason = 'OPENING'");
  return r?.n ?? 0;
}
