// What each kind of import can fill in, and the column names other software uses
// for it. Names are compared after `normalizeHeader` (lowercase, letters and
// digits only), so "Batch No." and "BATCH_NO" both become "batchno".

export type ImportKind = "STOCK" | "SUPPLIERS" | "CUSTOMERS";

export type StockField =
  | "name"
  | "company"
  | "salt"
  | "pack"
  | "unit"
  | "hsn"
  | "gst"
  | "schedule"
  | "rack"
  | "barcode"
  | "batch"
  | "expiry"
  | "mrp"
  | "purchaseRate"
  | "saleRate"
  | "qty"
  | "loose";

export type PartyField = "name" | "phone" | "address" | "gstin" | "dlNo" | "openingBalance" | "creditLimit";

export type FieldId = StockField | PartyField;

export interface FieldDef {
  id: FieldId;
  required?: boolean;
  /** Exact normalised header names. */
  names: string[];
  /** Weaker match: the normalised header contains one of these. */
  contains?: string[];
  /** The header must not contain any of these for a `contains` match. */
  notContains?: string[];
}

const STOCK_FIELDS: FieldDef[] = [
  {
    id: "name",
    required: true,
    names: ["name", "itemname", "item", "product", "productname", "medicine", "medicinename", "description", "itemdescription", "particulars", "drugname", "brand", "brandname"],
    contains: ["itemname", "productname", "medicine"],
  },
  {
    id: "company",
    names: ["company", "companyname", "comp", "mfg", "mfr", "mfgr", "manufacturer", "mfgname", "mfgby", "mkt", "marketedby", "make"],
    contains: ["company", "manufactur"],
  },
  { id: "salt", names: ["salt", "composition", "generic", "genericname", "content", "contents", "molecule", "saltname"], contains: ["composition", "salt"] },
  { id: "pack", names: ["pack", "packing", "packsize", "pkg", "packingsize", "unitpack", "pk", "packs"], contains: ["packing"] },
  { id: "unit", names: ["unit", "uom", "units"] },
  { id: "hsn", names: ["hsn", "hsncode", "hsnsac", "hsnsaccode", "hsnno"], contains: ["hsn"] },
  { id: "gst", names: ["gst", "gstper", "gstrate", "gstpercent", "tax", "taxper", "taxrate", "igst", "igstper", "vat"], contains: ["gst"], notContains: ["amt", "amount", "value", "no", "in"] },
  { id: "schedule", names: ["schedule", "sch", "drugschedule", "schedulename", "schtype"] },
  { id: "rack", names: ["rack", "rackno", "location", "shelf", "box", "loc"] },
  { id: "barcode", names: ["barcode", "ean", "barcodeno", "upc", "gtin"], contains: ["barcode"] },
  { id: "batch", names: ["batch", "batchno", "batchnumber", "bno", "batchnum", "lot", "lotno"], contains: ["batch"] },
  { id: "expiry", names: ["expiry", "exp", "expdate", "expirydate", "expdt", "expiry date", "expiryon"], contains: ["exp"], notContains: ["expense"] },
  { id: "mrp", names: ["mrp", "mrprate", "mrpperpack", "maxretailprice"], contains: ["mrp"] },
  {
    id: "purchaseRate",
    names: ["purchaserate", "prate", "purrate", "purchaseprice", "cost", "costrate", "costprice", "ptr", "rate", "netrate"],
    contains: ["purchase", "prate", "purrate"],
    notContains: ["amt", "amount", "value", "qty"],
  },
  { id: "saleRate", names: ["salerate", "srate", "sellingprice", "saleprice", "sellingrate", "salesrate"], contains: ["salerate", "selling"] },
  {
    id: "qty",
    names: ["qty", "quantity", "stock", "closing", "closingstock", "clstock", "clqty", "balance", "balqty", "closingqty", "currentstock", "stockqty", "availableqty"],
    contains: ["qty", "closing", "stock"],
    notContains: ["value", "amt", "amount", "free", "loose"],
  },
  { id: "loose", names: ["loose", "looseqty", "loosequantity", "looseunits", "loosetab"] },
];

const PARTY_COMMON: FieldDef[] = [
  { id: "name", required: true, names: ["name", "partyname", "supplier", "suppliername", "customer", "customername", "distributor", "ledgername", "accountname", "party"], contains: ["name"] },
  { id: "phone", names: ["phone", "mobile", "mobileno", "phoneno", "contact", "contactno", "mob", "tel", "telephone"], contains: ["mobile", "phone"] },
  { id: "address", names: ["address", "addr", "address1", "city", "location"], contains: ["address"] },
  { id: "gstin", names: ["gstin", "gstno", "gstnumber", "gstinno", "gst"], contains: ["gstin"] },
  { id: "openingBalance", names: ["opening", "openingbalance", "opbal", "openingbal", "balance", "outstanding", "due"], contains: ["opening", "outstanding"] },
];

const SUPPLIER_FIELDS: FieldDef[] = [
  ...PARTY_COMMON,
  { id: "dlNo", names: ["dlno", "dl", "druglicence", "druglicense", "druglicenceno", "druglicenseno", "licenceno", "licenseno", "dlnumber"], contains: ["licen", "dlno"] },
];

const CUSTOMER_FIELDS: FieldDef[] = [
  ...PARTY_COMMON,
  { id: "creditLimit", names: ["creditlimit", "limit", "crlimit"], contains: ["limit"] },
];

export const FIELDS: Record<ImportKind, FieldDef[]> = {
  STOCK: STOCK_FIELDS,
  SUPPLIERS: SUPPLIER_FIELDS,
  CUSTOMERS: CUSTOMER_FIELDS,
};

export function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/%/g, "per")
    .replace(/[^a-z0-9]/g, "");
}
