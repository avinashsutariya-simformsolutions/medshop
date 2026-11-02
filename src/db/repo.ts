import { execute, query, queryOne } from "./index";
import type { DashboardCounts, ItemSearchRow, SettingKey, Settings } from "./types";
import { isoDate } from "../lib/stock";

// ---------- Settings ----------

export async function getSettings(): Promise<Settings> {
  const rows = await query<{ key: SettingKey; value: string }>("SELECT key, value FROM settings");
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Settings;
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  await execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

// ---------- Item search ----------

/**
 * Turn what the user typed into a safe FTS5 query: every word becomes a
 * prefix match, so "dol 65" finds "Dolo 650". Quotes are stripped so user
 * input can never break the query syntax.
 */
export function toFtsQuery(input: string): string {
  return input
    .replace(/["*^():]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => `"${w}"*`)
    .join(" ");
}

const SEARCH_SELECT = `
  SELECT i.id, i.name, i.salt, c.name AS company, i.pack_size, i.unit, i.schedule, i.rack,
         COALESCE(SUM(CASE WHEN b.expiry >= $2 THEN b.qty_units END), 0) AS stock_units,
         (SELECT b2.mrp_paise FROM batches b2
           WHERE b2.item_id = i.id AND b2.qty_units > 0 AND b2.expiry >= $2
           ORDER BY b2.expiry, b2.id LIMIT 1) AS mrp_paise,
         MIN(CASE WHEN b.qty_units > 0 AND b.expiry >= $2 THEN b.expiry END) AS nearest_expiry
`;

export async function searchItems(input: string, limit = 30): Promise<ItemSearchRow[]> {
  const text = input.trim();
  if (!text) return [];
  const today = isoDate();

  // A scanned barcode is all digits: try an exact match first.
  if (/^\d{8,14}$/.test(text)) {
    const exact = await query<ItemSearchRow>(
      `${SEARCH_SELECT}
       FROM items i
       LEFT JOIN companies c ON c.id = i.company_id
       LEFT JOIN batches b ON b.item_id = i.id
       WHERE i.barcode = $1 AND i.is_active = 1
       GROUP BY i.id`,
      [text, today],
    );
    if (exact.length) return exact;
  }

  const fts = toFtsQuery(text);
  if (!fts) return [];
  return query<ItemSearchRow>(
    `WITH hits AS (
       SELECT rowid AS id, bm25(items_fts, 10.0, 5.0, 2.0, 1.0) AS score
       FROM items_fts WHERE items_fts MATCH $1
       ORDER BY score LIMIT $3
     )
     ${SEARCH_SELECT}
     FROM hits h
     JOIN items i ON i.id = h.id
     LEFT JOIN companies c ON c.id = i.company_id
     LEFT JOIN batches b ON b.item_id = i.id
     WHERE i.is_active = 1
     GROUP BY i.id
     ORDER BY (stock_units > 0) DESC, MIN(h.score), i.name`,
    [fts, today, limit],
  );
}

// ---------- Home screen numbers ----------

export async function getDashboardCounts(nearDays: number): Promise<DashboardCounts> {
  const today = isoDate();
  const near = new Date();
  near.setDate(near.getDate() + nearDays);
  const row = await queryOne<DashboardCounts>(
    `SELECT
       (SELECT COALESCE(SUM(total_paise), 0) FROM sales WHERE bill_date = $1 AND status = 'ACTIVE') AS today_sale_paise,
       (SELECT COUNT(*) FROM sales WHERE bill_date = $1 AND status = 'ACTIVE') AS today_bills,
       (SELECT COUNT(*) FROM batches WHERE qty_units > 0 AND expiry >= $1 AND expiry <= $2) AS near_expiry_batches,
       (SELECT COUNT(*) FROM batches WHERE qty_units > 0 AND expiry < $1) AS expired_in_stock,
       (SELECT COUNT(*) FROM (
          SELECT i.id FROM items i
          LEFT JOIN batches b ON b.item_id = i.id AND b.expiry >= $1
          WHERE i.is_active = 1 AND i.reorder_level > 0
          GROUP BY i.id
          HAVING COALESCE(SUM(b.qty_units), 0) < i.reorder_level
       )) AS low_stock_items`,
    [today, isoDate(near)],
  );
  return (
    row ?? { today_sale_paise: 0, today_bills: 0, near_expiry_batches: 0, expired_in_stock: 0, low_stock_items: 0 }
  );
}
