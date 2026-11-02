-- MedShop schema v1
-- Conventions:
--   * Money is stored as INTEGER paise (₹1 = 100). Never use REAL for money.
--   * Quantity is stored as INTEGER in the smallest unit (tablet / ml / piece).
--     A strip of 10 tablets = 10 units. Strips are only a display concept.
--   * GST rate is stored in basis points (12% = 1200).
--   * Dates are ISO text: 'YYYY-MM-DD'; timestamps are 'YYYY-MM-DD HH:MM:SS' (local).
--   * Rows that matter for compliance are never deleted; they are cancelled.

-- ---------- Settings (shop profile, GSTIN, drug licence, printer…) ----------
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------- Masters ----------
CREATE TABLE companies (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE items (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL COLLATE NOCASE,
  salt           TEXT COLLATE NOCASE,              -- composition, e.g. "Paracetamol 650mg"
  company_id     INTEGER REFERENCES companies(id),
  unit           TEXT NOT NULL DEFAULT 'TAB',      -- TAB, CAP, ML, PCS, GM
  pack_size      INTEGER NOT NULL DEFAULT 1 CHECK (pack_size > 0), -- units per strip/pack
  hsn            TEXT,
  gst_rate_bp    INTEGER NOT NULL DEFAULT 1200 CHECK (gst_rate_bp IN (0,500,1200,1800,2800)),
  schedule       TEXT NOT NULL DEFAULT 'OTC' CHECK (schedule IN ('OTC','H','H1','X','NDPS')),
  rack           TEXT,
  barcode        TEXT UNIQUE,
  reorder_level  INTEGER NOT NULL DEFAULT 0,       -- in units
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_items_company ON items(company_id);

CREATE TABLE batches (
  id                 INTEGER PRIMARY KEY,
  item_id            INTEGER NOT NULL REFERENCES items(id),
  batch_no           TEXT NOT NULL COLLATE NOCASE,
  expiry             TEXT NOT NULL,               -- last day of expiry month, 'YYYY-MM-DD'
  mrp_paise          INTEGER NOT NULL CHECK (mrp_paise >= 0),        -- per PACK
  purchase_rate_paise INTEGER NOT NULL DEFAULT 0, -- per PACK, before GST
  sale_rate_paise    INTEGER NOT NULL DEFAULT 0,  -- per PACK, GST inclusive (usually = MRP)
  qty_units          INTEGER NOT NULL DEFAULT 0,  -- cached current stock; source of truth is stock_moves
  created_at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (item_id, batch_no, expiry, mrp_paise)
);
CREATE INDEX idx_batches_item_expiry ON batches(item_id, expiry);
CREATE INDEX idx_batches_expiry ON batches(expiry);

CREATE TABLE suppliers (
  id                   INTEGER PRIMARY KEY,
  name                 TEXT NOT NULL COLLATE NOCASE,
  gstin                TEXT,
  dl_no                TEXT,                       -- drug licence number
  phone                TEXT,
  address              TEXT,
  opening_balance_paise INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE customers (
  id                   INTEGER PRIMARY KEY,
  name                 TEXT NOT NULL COLLATE NOCASE,
  phone                TEXT,
  address              TEXT,
  gstin                TEXT,
  credit_limit_paise   INTEGER NOT NULL DEFAULT 0,
  opening_balance_paise INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_customers_phone ON customers(phone);

CREATE TABLE doctors (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL COLLATE NOCASE,
  reg_no       TEXT,
  address      TEXT,
  phone        TEXT
);

-- ---------- Users & audit ----------
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('OWNER','PHARMACIST','STAFF')),
  pin_hash      TEXT,                              -- filled in Sprint 7
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,                        -- e.g. 'SALE_CANCEL', 'ITEM_RATE_CHANGE'
  entity     TEXT NOT NULL,
  entity_id  INTEGER,
  old_value  TEXT,                                 -- JSON
  new_value  TEXT                                  -- JSON
);

-- ---------- Purchases ----------
CREATE TABLE purchases (
  id               INTEGER PRIMARY KEY,
  supplier_id      INTEGER NOT NULL REFERENCES suppliers(id),
  supplier_bill_no TEXT NOT NULL,
  bill_date        TEXT NOT NULL,
  entry_date       TEXT NOT NULL DEFAULT (date('now','localtime')),
  taxable_paise    INTEGER NOT NULL DEFAULT 0,
  gst_paise        INTEGER NOT NULL DEFAULT 0,
  total_paise      INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  user_id          INTEGER REFERENCES users(id),
  UNIQUE (supplier_id, supplier_bill_no)
);

CREATE TABLE purchase_lines (
  id               INTEGER PRIMARY KEY,
  purchase_id      INTEGER NOT NULL REFERENCES purchases(id),
  batch_id         INTEGER NOT NULL REFERENCES batches(id),
  qty_units        INTEGER NOT NULL CHECK (qty_units >= 0),
  free_units       INTEGER NOT NULL DEFAULT 0,
  rate_paise       INTEGER NOT NULL,              -- per PACK, before GST
  discount_bp      INTEGER NOT NULL DEFAULT 0,
  gst_rate_bp      INTEGER NOT NULL,
  taxable_paise    INTEGER NOT NULL,
  gst_paise        INTEGER NOT NULL
);

-- ---------- Sales ----------
CREATE TABLE sales (
  id               INTEGER PRIMARY KEY,
  bill_no          TEXT NOT NULL UNIQUE,          -- e.g. 'S/2026-27/000123'
  bill_date        TEXT NOT NULL DEFAULT (date('now','localtime')),
  bill_time        TEXT NOT NULL DEFAULT (time('now','localtime')),
  customer_id      INTEGER REFERENCES customers(id),
  customer_name    TEXT,                          -- walk-in name, if no customer row
  doctor_id        INTEGER REFERENCES doctors(id),
  payment_mode     TEXT NOT NULL DEFAULT 'CASH' CHECK (payment_mode IN ('CASH','UPI','CARD','CREDIT','SPLIT')),
  taxable_paise    INTEGER NOT NULL DEFAULT 0,
  gst_paise        INTEGER NOT NULL DEFAULT 0,
  discount_paise   INTEGER NOT NULL DEFAULT 0,
  round_off_paise  INTEGER NOT NULL DEFAULT 0,
  total_paise      INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  user_id          INTEGER REFERENCES users(id)
);
CREATE INDEX idx_sales_date ON sales(bill_date);

CREATE TABLE sale_lines (
  id               INTEGER PRIMARY KEY,
  sale_id          INTEGER NOT NULL REFERENCES sales(id),
  batch_id         INTEGER NOT NULL REFERENCES batches(id),
  qty_units        INTEGER NOT NULL CHECK (qty_units > 0),
  mrp_paise        INTEGER NOT NULL,              -- per PACK at time of sale
  rate_paise       INTEGER NOT NULL,              -- per PACK, GST inclusive
  discount_bp      INTEGER NOT NULL DEFAULT 0,
  gst_rate_bp      INTEGER NOT NULL,
  taxable_paise    INTEGER NOT NULL,
  gst_paise        INTEGER NOT NULL,
  amount_paise     INTEGER NOT NULL
);
CREATE INDEX idx_sale_lines_sale ON sale_lines(sale_id);

-- ---------- Returns ----------
CREATE TABLE returns (
  id          INTEGER PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('SALE_RETURN','PURCHASE_RETURN','EXPIRY_RETURN','BREAKAGE')),
  ref_sale_id INTEGER REFERENCES sales(id),
  ref_purchase_id INTEGER REFERENCES purchases(id),
  party_id    INTEGER,                             -- customer or supplier id depending on type
  return_date TEXT NOT NULL DEFAULT (date('now','localtime')),
  total_paise INTEGER NOT NULL DEFAULT 0,
  user_id     INTEGER REFERENCES users(id)
);

CREATE TABLE return_lines (
  id          INTEGER PRIMARY KEY,
  return_id   INTEGER NOT NULL REFERENCES returns(id),
  batch_id    INTEGER NOT NULL REFERENCES batches(id),
  qty_units   INTEGER NOT NULL CHECK (qty_units > 0),
  rate_paise  INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL
);

-- ---------- Stock ledger (every movement, + in / - out) ----------
CREATE TABLE stock_moves (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  batch_id   INTEGER NOT NULL REFERENCES batches(id),
  qty_units  INTEGER NOT NULL CHECK (qty_units <> 0),
  reason     TEXT NOT NULL CHECK (reason IN ('OPENING','PURCHASE','SALE','SALE_RETURN','PURCHASE_RETURN','EXPIRY_RETURN','BREAKAGE','ADJUSTMENT','SALE_CANCEL')),
  ref_id     INTEGER,                              -- purchase_lines.id / sale_lines.id / return_lines.id
  note       TEXT,
  user_id    INTEGER REFERENCES users(id)
);
CREATE INDEX idx_stock_moves_batch ON stock_moves(batch_id);

-- Keep batches.qty_units in sync with the ledger automatically.
CREATE TRIGGER trg_stock_moves_apply AFTER INSERT ON stock_moves
BEGIN
  UPDATE batches SET qty_units = qty_units + NEW.qty_units WHERE id = NEW.batch_id;
END;

-- Stock must never go negative.
CREATE TRIGGER trg_batches_no_negative BEFORE UPDATE OF qty_units ON batches
WHEN NEW.qty_units < 0
BEGIN
  SELECT RAISE(ABORT, 'STOCK_NEGATIVE');
END;

-- stock_moves is append-only.
CREATE TRIGGER trg_stock_moves_no_update BEFORE UPDATE ON stock_moves
BEGIN SELECT RAISE(ABORT, 'STOCK_MOVES_APPEND_ONLY'); END;
CREATE TRIGGER trg_stock_moves_no_delete BEFORE DELETE ON stock_moves
BEGIN SELECT RAISE(ABORT, 'STOCK_MOVES_APPEND_ONLY'); END;

-- ---------- Compliance: Schedule H / H1 / X / NDPS register ----------
CREATE TABLE schedule_register (
  id               INTEGER PRIMARY KEY,
  sale_line_id     INTEGER NOT NULL UNIQUE REFERENCES sale_lines(id),
  schedule         TEXT NOT NULL CHECK (schedule IN ('H','H1','X','NDPS')),
  entry_date       TEXT NOT NULL DEFAULT (date('now','localtime')),
  prescriber_name  TEXT NOT NULL,
  prescriber_address TEXT NOT NULL,
  patient_name     TEXT NOT NULL,
  patient_address  TEXT NOT NULL,
  rx_no            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Register entries must be kept (H1: at least 3 years); never deleted by the app.
CREATE TRIGGER trg_schedule_register_no_delete BEFORE DELETE ON schedule_register
BEGIN SELECT RAISE(ABORT, 'REGISTER_IS_PERMANENT'); END;

-- ---------- Accounts ----------
CREATE TABLE ledger_entries (
  id          INTEGER PRIMARY KEY,
  entry_date  TEXT NOT NULL DEFAULT (date('now','localtime')),
  party_type  TEXT NOT NULL CHECK (party_type IN ('CUSTOMER','SUPPLIER','CASH','BANK')),
  party_id    INTEGER,
  debit_paise INTEGER NOT NULL DEFAULT 0,
  credit_paise INTEGER NOT NULL DEFAULT 0,
  ref_type    TEXT,                                -- 'SALE', 'PURCHASE', 'PAYMENT', 'RECEIPT'
  ref_id      INTEGER,
  narration   TEXT
);
CREATE INDEX idx_ledger_party ON ledger_entries(party_type, party_id);

-- ---------- Fast search (name, salt, company, barcode) ----------
CREATE VIRTUAL TABLE items_fts USING fts5(
  name, salt, company, barcode,
  tokenize='unicode61 remove_diacritics 2', prefix='2 3 4'
);

CREATE TRIGGER trg_items_fts_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, name, salt, company, barcode)
  VALUES (NEW.id, NEW.name, coalesce(NEW.salt,''),
          coalesce((SELECT name FROM companies WHERE id = NEW.company_id),''),
          coalesce(NEW.barcode,''));
END;

CREATE TRIGGER trg_items_fts_ad AFTER DELETE ON items BEGIN
  DELETE FROM items_fts WHERE rowid = OLD.id;
END;

CREATE TRIGGER trg_items_fts_au AFTER UPDATE ON items BEGIN
  DELETE FROM items_fts WHERE rowid = OLD.id;
  INSERT INTO items_fts(rowid, name, salt, company, barcode)
  VALUES (NEW.id, NEW.name, coalesce(NEW.salt,''),
          coalesce((SELECT name FROM companies WHERE id = NEW.company_id),''),
          coalesce(NEW.barcode,''));
END;

-- Company renamed → refresh search rows of its items.
CREATE TRIGGER trg_companies_fts_au AFTER UPDATE OF name ON companies BEGIN
  UPDATE items SET updated_at = datetime('now','localtime') WHERE company_id = NEW.id;
END;

-- ---------- Seed ----------
INSERT INTO users (username, display_name, role) VALUES ('owner', 'Owner', 'OWNER');
INSERT INTO settings (key, value) VALUES
  ('shop_name', ''), ('shop_address', ''), ('gstin', ''), ('dl_no_20', ''), ('dl_no_21', ''),
  ('pharmacist_name', ''), ('language', 'hi'), ('setup_done', '0'),
  ('bill_prefix', 'S'), ('near_expiry_days', '90');
