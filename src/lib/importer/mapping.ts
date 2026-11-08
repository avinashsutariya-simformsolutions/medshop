import { FIELDS, normalizeHeader, type FieldDef, type FieldId, type ImportKind } from "./fields";

export type Cell = string | number | boolean | Date | null | undefined;
export type Grid = Cell[][];

/** Column index → field. Columns not in the map are ignored. */
export type Mapping = Record<number, FieldId>;

function exactField(fields: FieldDef[], norm: string): FieldDef | undefined {
  return fields.find((f) => f.names.includes(norm));
}

function looseField(fields: FieldDef[], norm: string): FieldDef | undefined {
  return fields.find(
    (f) => f.contains?.some((c) => norm.includes(c)) && !f.notContains?.some((c) => norm.includes(c)),
  );
}

function isEmptyRow(row: Cell[] | undefined): boolean {
  return !row || row.every((c) => c === null || c === undefined || String(c).trim() === "");
}

/**
 * Reports often start with the shop name, report title and date before the real
 * header. Pick the row (within the first 25) whose cells match the most known names.
 */
export function detectHeaderRow(grid: Grid, kind: ImportKind): number {
  const fields = FIELDS[kind];
  let best = -1;
  let bestScore = 1; // need at least 2 recognised columns
  for (let r = 0; r < Math.min(grid.length, 25); r++) {
    const row = grid[r] ?? [];
    const seen = new Set<FieldId>();
    for (const c of row) {
      const f = exactField(fields, normalizeHeader(c));
      if (f) seen.add(f.id);
    }
    if (seen.size > bestScore) {
      best = r;
      bestScore = seen.size;
    }
  }
  if (best >= 0) return best;
  return Math.max(0, grid.findIndex((r) => !isEmptyRow(r)));
}

/** Guess which column is which field. Exact names win over partial ones; each field is used once. */
export function guessMapping(headers: Cell[], kind: ImportKind): Mapping {
  const fields = FIELDS[kind];
  const mapping: Mapping = {};
  const used = new Set<FieldId>();
  const norms = headers.map(normalizeHeader);

  norms.forEach((n, i) => {
    const f = exactField(fields, n);
    if (f && !used.has(f.id)) {
      mapping[i] = f.id;
      used.add(f.id);
    }
  });
  norms.forEach((n, i) => {
    if (mapping[i] || !n) return;
    const f = looseField(fields, n);
    if (f && !used.has(f.id)) {
      mapping[i] = f.id;
      used.add(f.id);
    }
  });
  return mapping;
}

/** Same layout → same signature, so a saved mapping can be applied next time. */
export function headerSignature(headers: Cell[]): string {
  return headers.map(normalizeHeader).join("|");
}

export function missingRequired(mapping: Mapping, kind: ImportKind): FieldId[] {
  const mapped = new Set(Object.values(mapping));
  return FIELDS[kind].filter((f) => f.required && !mapped.has(f.id)).map((f) => f.id);
}

/** Data rows below the header, as objects keyed by field, with their sheet row number (1-based). */
export function extractRecords(
  grid: Grid,
  headerRow: number,
  mapping: Mapping,
): { rowNo: number; values: Partial<Record<FieldId, Cell>> }[] {
  const out: { rowNo: number; values: Partial<Record<FieldId, Cell>> }[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r];
    if (isEmptyRow(row)) continue;
    const values: Partial<Record<FieldId, Cell>> = {};
    for (const [col, field] of Object.entries(mapping)) values[field] = row[Number(col)];
    out.push({ rowNo: r + 1, values });
  }
  return out;
}
