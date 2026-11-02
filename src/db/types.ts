// Row shapes as they come back from SQLite (snake_case, integers for money).

export type Schedule = "OTC" | "H" | "H1" | "X" | "NDPS";

export interface ItemSearchRow {
  id: number;
  name: string;
  salt: string | null;
  company: string | null;
  pack_size: number;
  unit: string;
  schedule: Schedule;
  rack: string | null;
  /** Saleable stock in units (non-expired batches only). */
  stock_units: number;
  /** MRP per pack of the batch that would be sold first (FEFO). */
  mrp_paise: number | null;
  nearest_expiry: string | null;
}

export interface DashboardCounts {
  today_sale_paise: number;
  today_bills: number;
  near_expiry_batches: number;
  expired_in_stock: number;
  low_stock_items: number;
}

export type SettingKey =
  | "shop_name"
  | "shop_address"
  | "gstin"
  | "dl_no_20"
  | "dl_no_21"
  | "pharmacist_name"
  | "language"
  | "setup_done"
  | "bill_prefix"
  | "near_expiry_days";

export type Settings = Record<SettingKey, string>;
