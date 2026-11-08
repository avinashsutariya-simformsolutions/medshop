-- MedShop schema v2
-- 1. GST 2.0 (effective 22 Sep 2025): medicines are now 0% / 5% / 18%; the 12% slab
--    no longer applies to medicines (28% is gone too). SQLite cannot change a CHECK constraint without
--    rebuilding the table, so the old CHECK stays and these triggers narrow it.
-- 2. Sale rate may be below MRP (old-MRP stock after the GST cut) but never above it.
-- 3. Saved column mappings and an import log for Excel/CSV imports.
--
-- Never edit 001_init.sql: it has already run on installed machines, and the
-- migration runner rejects a changed file. Every schema change gets a new file.

-- Existing items at the old 12% rate move to the new 5% rate.
UPDATE items SET gst_rate_bp = 500 WHERE gst_rate_bp = 1200;

CREATE TRIGGER trg_items_gst_insert BEFORE INSERT ON items
WHEN NEW.gst_rate_bp NOT IN (0, 500, 1800)
BEGIN
  SELECT RAISE(ABORT, 'GST_RATE_INVALID');
END;

CREATE TRIGGER trg_items_gst_update BEFORE UPDATE OF gst_rate_bp ON items
WHEN NEW.gst_rate_bp NOT IN (0, 500, 1800)
BEGIN
  SELECT RAISE(ABORT, 'GST_RATE_INVALID');
END;

-- The table default is still 1200, which these triggers reject, so the app must
-- always pass gst_rate_bp explicitly (src/lib/gst.ts has DEFAULT_GST_BP = 500).

CREATE TRIGGER trg_batches_sale_le_mrp_insert BEFORE INSERT ON batches
WHEN NEW.sale_rate_paise > NEW.mrp_paise
BEGIN
  SELECT RAISE(ABORT, 'SALE_RATE_ABOVE_MRP');
END;

CREATE TRIGGER trg_batches_sale_le_mrp_update BEFORE UPDATE OF sale_rate_paise, mrp_paise ON batches
WHEN NEW.sale_rate_paise > NEW.mrp_paise
BEGIN
  SELECT RAISE(ABORT, 'SALE_RATE_ABOVE_MRP');
END;

-- Remembered column mappings: the same distributor / report layout maps itself next time.
CREATE TABLE import_mappings (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,                 -- 'STOCK', 'SUPPLIERS', 'CUSTOMERS', later 'PURCHASE'
  signature   TEXT NOT NULL,                 -- normalised header names joined with '|'
  mapping     TEXT NOT NULL,                 -- JSON: { "<column index>": "<field>" }
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (kind, signature)
);

CREATE TABLE import_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  kind        TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  rows_total  INTEGER NOT NULL,
  rows_imported INTEGER NOT NULL,
  rows_skipped INTEGER NOT NULL,
  user_id     INTEGER REFERENCES users(id)
);

CREATE INDEX idx_items_name ON items(name);
CREATE INDEX idx_suppliers_name ON suppliers(name);
CREATE INDEX idx_customers_name ON customers(name);
