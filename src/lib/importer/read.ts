import Papa from "papaparse";
import type { Cell, Grid } from "./mapping";

export interface SheetGrid {
  name: string;
  grid: Grid;
}

export class UnsupportedFileError extends Error {
  constructor(public ext: string) {
    super(`UNSUPPORTED_FILE:${ext}`);
  }
}

/** CSV / TSV text → grid. The delimiter (comma, semicolon, tab) is detected. */
export function parseCsvText(textIn: string): Grid {
  const text = textIn.replace(/^﻿/, ""); // Excel adds a BOM to UTF-8 CSV
  const res = Papa.parse<string[]>(text, { skipEmptyLines: false, delimiter: "" });
  return res.data as Cell[][];
}

/** Read an uploaded file into one grid per sheet. Supports .csv, .tsv, .txt and .xlsx. */
export async function readSpreadsheet(file: File): Promise<SheetGrid[]> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    // Old Windows exports are often not UTF-8; fall back when we see replacement characters.
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);
    return [{ name: file.name, grid: parseCsvText(text) }];
  }
  if (ext === "xlsx") {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(file);
    return sheets.map((s) => ({ name: s.sheet, grid: s.data as unknown as Grid }));
  }
  // .xls (Excel 97-2003) and others: ask the user to "Save As" .xlsx or .csv
  throw new UnsupportedFileError(ext);
}
