import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useT } from "../i18n/I18nProvider";
import type { StringKey } from "../i18n/strings";
import { hasDatabase } from "../db";
import { loadSavedMapping, openingStockEntries } from "../db/masters";
import { dbErrorKey } from "../db/errors";
import { formatPaise } from "../lib/money";
import { isoDate } from "../lib/stock";
import { FIELDS, type FieldId, type ImportKind } from "../lib/importer/fields";
import { groupIssues, type Issue } from "../lib/importer/issues";
import { detectHeaderRow, extractRecords, guessMapping, headerSignature, missingRequired, type Cell, type Mapping } from "../lib/importer/mapping";
import { parseCsvText, readSpreadsheet, UnsupportedFileError, type SheetGrid } from "../lib/importer/read";
import { planStock, stockTotals, validateStock, type StockRow } from "../lib/importer/stockImport";
import { planParties, validateParties, type PartyRow } from "../lib/importer/partyImport";
import { Banner, Button, PageHeader, Select } from "../components/Form";
import sampleStock from "../../templates/sample-opening-stock.csv?raw";
import sampleSuppliers from "../../templates/sample-suppliers.csv?raw";
import tplStock from "../../templates/opening-stock-template.csv?raw";
import tplSuppliers from "../../templates/suppliers-template.csv?raw";
import tplCustomers from "../../templates/customers-template.csv?raw";

type Step = "choose" | "map" | "preview" | "working" | "done";

const FIELD_LABEL: Record<FieldId, StringKey> = {
  name: "fName", company: "fCompany", salt: "fSalt", pack: "fPackText", unit: "fUnit", hsn: "fHsn", gst: "fGst",
  schedule: "fSchedule", rack: "fRack", barcode: "fBarcode", batch: "fBatch", expiry: "fExpiry", mrp: "fMrp",
  purchaseRate: "fPurchaseRate", saleRate: "fSaleRate", qty: "fQty", loose: "fLoose", phone: "fPhone",
  address: "fAddress", gstin: "fGstin", dlNo: "fDlNo", openingBalance: "fOpening", creditLimit: "fCreditLimit",
};

const KINDS: { kind: ImportKind; title: StringKey; desc: StringKey; template: string; templateName: string; sample?: string }[] = [
  { kind: "STOCK", title: "impKindStock", desc: "impKindStockDesc", template: tplStock, templateName: "medshop-opening-stock.csv", sample: sampleStock },
  { kind: "SUPPLIERS", title: "impKindSuppliers", desc: "impKindSuppliersDesc", template: tplSuppliers, templateName: "medshop-suppliers.csv", sample: sampleSuppliers },
  { kind: "CUSTOMERS", title: "impKindCustomers", desc: "impKindCustomersDesc", template: tplCustomers, templateName: "medshop-customers.csv" },
];

type Validation =
  | { kind: "STOCK"; rows: StockRow[]; issues: Issue[]; total: number; skipped: number }
  | { kind: "SUPPLIERS" | "CUSTOMERS"; rows: PartyRow[]; issues: Issue[]; total: number; skipped: number };

function cellText(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c);
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImportPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [step, setStep] = useState<Step>("choose");
  const [kind, setKind] = useState<ImportKind>("STOCK");
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<SheetGrid[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [usedSaved, setUsedSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [openingCount, setOpeningCount] = useState(0);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const [result, setResult] = useState<string>("");

  const grid = sheets[sheetIdx]?.grid ?? [];
  const headers = grid[headerRow] ?? [];
  const fields = FIELDS[kind];

  // Re-guess the mapping when the sheet or header row changes; prefer a saved one.
  useEffect(() => {
    if (sheets.length === 0 || headers.length === 0) return;
    const guessed = guessMapping(headers, kind);
    setMapping(guessed);
    setUsedSaved(false);
    if (!hasDatabase()) return;
    loadSavedMapping(kind, headerSignature(headers))
      .then((saved) => {
        if (saved) {
          setMapping(saved as Mapping);
          setUsedSaved(true);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetIdx, headerRow, kind, sheets]);

  function begin(name: string, s: SheetGrid[]) {
    setFileName(name);
    setSheets(s);
    // Pick the first sheet that has a recognisable header.
    let idx = 0;
    for (let i = 0; i < s.length; i++) {
      if (Object.keys(guessMapping(s[i].grid[detectHeaderRow(s[i].grid, kind)] ?? [], kind)).length >= 2) {
        idx = i;
        break;
      }
    }
    setSheetIdx(idx);
    setHeaderRow(detectHeaderRow(s[idx]?.grid ?? [], kind));
    setError(null);
    setStep("map");
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      begin(file.name, await readSpreadsheet(file));
    } catch (err) {
      if (err instanceof UnsupportedFileError) setError(t("impUnsupported", { ext: err.ext }));
      else setError(t("impReadError", { msg: String(err) }));
    }
  }

  function setColumn(col: number, field: FieldId | "") {
    setMapping((m) => {
      const next: Mapping = {};
      for (const [c, f] of Object.entries(m)) if (Number(c) !== col && f !== field) next[Number(c)] = f;
      if (field) next[col] = field;
      return next;
    });
  }

  const missing = missingRequired(mapping, kind);

  async function check() {
    const records = extractRecords(grid, headerRow, mapping);
    const v: Validation =
      kind === "STOCK" ? { kind, ...validateStock(records, isoDate()) } : { kind, ...validateParties(records) };
    setValidation(v);
    setConfirmAgain(false);
    if (kind === "STOCK" && hasDatabase()) setOpeningCount(await openingStockEntries().catch(() => 0));
    else setOpeningCount(0);
    setStep("preview");
  }

  async function runImport() {
    if (!validation || !hasDatabase()) return;
    setStep("working");
    setError(null);
    const meta = {
      fileName,
      total: validation.total,
      skipped: validation.skipped,
      signature: headerSignature(headers),
      mappingJson: JSON.stringify(mapping),
    };
    try {
      if (validation.kind === "STOCK") {
        const plan = planStock(validation.rows, meta);
        const { rows_affected: a } = await plan.batch.run();
        const count = (steps: number[]) => steps.filter((i) => a[i] > 0).length;
        setResult(t("impDoneStock", { items: count(plan.itemSteps), batches: count(plan.batchSteps), moves: count(plan.moveSteps) }));
      } else {
        const plan = planParties(validation.kind, validation.rows, meta);
        const { rows_affected: a } = await plan.batch.run();
        const added = plan.partySteps.filter((i) => a[i] > 0).length;
        setResult(t("impDoneParties", { n: added, dup: plan.partySteps.length - added }));
      }
      setStep("done");
    } catch (e) {
      const { key, raw } = dbErrorKey(e);
      setError(t(key, { msg: raw }));
      setStep("preview");
    }
  }

  function reset() {
    setStep("choose");
    setSheets([]);
    setValidation(null);
    setError(null);
  }

  const groups = useMemo(() => (validation ? groupIssues(validation.issues) : []), [validation]);
  const totals = validation?.kind === "STOCK" ? stockTotals(validation.rows) : null;
  const blockedByOpening = kind === "STOCK" && openingCount > 0 && !confirmAgain;
  const listPath = kind === "STOCK" ? "/stock" : kind === "SUPPLIERS" ? "/suppliers" : "/customers";

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("importTitle")}
        sub={fileName || undefined}
        actions={
          <>
            {step !== "choose" && <Button onClick={reset}>{t("impStartOver")}</Button>}
            {step !== "working" && (
              <Button onClick={() => navigate(from ?? "/")} kbd="Esc">
                {t("cancel")}
              </Button>
            )}
          </>
        }
      />
      {error && <Banner tone="bad">{error}</Banner>}

      {step === "choose" && (
        <>
          <section>
            <h2 className="mb-2 font-semibold">{t("impStep1")}</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3" role="radiogroup">
              {KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.kind}
                  onClick={() => setKind(k.kind)}
                  className={"rounded-xl border p-4 text-left transition " + (kind === k.kind ? "border-brand bg-brand-soft" : "border-line bg-card hover:border-brand")}
                >
                  <div className="font-semibold">{t(k.title)}</div>
                  <div className="mt-1 text-sm text-ink-soft">{t(k.desc)}</div>
                </button>
              ))}
            </div>
          </section>
          <section className="rounded-xl border border-line bg-card p-5">
            <h2 className="mb-3 font-semibold">{t("impStep2")}</h2>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex h-11 cursor-pointer items-center rounded-lg bg-brand px-5 font-medium text-white hover:bg-brand-ink focus-within:outline-3 focus-within:outline-brand/50">
                {t("impChooseFile")}
                <input type="file" accept=".xlsx,.csv,.tsv,.txt" onChange={onFile} className="sr-only" />
              </label>
              {(() => {
                const k = KINDS.find((x) => x.kind === kind)!;
                return (
                  <>
                    <Button kind="ghost" onClick={() => download(k.templateName, k.template)}>
                      {t("impTemplate")}
                    </Button>
                    {k.sample && (
                      <Button kind="ghost" onClick={() => begin("sample.csv", [{ name: "sample", grid: parseCsvText(k.sample!) }])}>
                        {t("impTrySample")}
                      </Button>
                    )}
                  </>
                );
              })()}
            </div>
            <p className="mt-3 text-sm text-ink-soft">{t("impXlsHint")}</p>
          </section>
        </>
      )}

      {step === "map" && (
        <section className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-semibold">{t("impStep3")}</h2>
          <p className="mb-3 text-sm text-ink-soft">{t("impMapHint")}</p>
          <div className="mb-4 flex flex-wrap gap-4">
            {sheets.length > 1 && (
              <label className="flex items-center gap-2 text-sm">
                {t("impSheet")}
                <Select value={sheetIdx} onChange={(e) => { setSheetIdx(Number(e.target.value)); setHeaderRow(detectHeaderRow(sheets[Number(e.target.value)].grid, kind)); }} className="w-48">
                  {sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                </Select>
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              {t("impHeaderRow")}
              <Select value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))} className="w-24">
                {grid.slice(0, 30).map((_, i) => <option key={i} value={i}>{i + 1}</option>)}
              </Select>
            </label>
          </div>
          {usedSaved && <div className="mb-3"><Banner tone="info">{t("impSavedMapping")}</Banner></div>}
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-left">
              <thead className="bg-paper text-sm text-ink-soft">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("impColumn")}</th>
                  <th className="px-3 py-2 font-medium">{t("impSample")}</th>
                  <th className="w-72 px-3 py-2 font-medium">{t("impField")}</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((h, col) => {
                  const samples = grid.slice(headerRow + 1).map((r) => cellText(r[col])).filter(Boolean).slice(0, 3);
                  if (!cellText(h) && samples.length === 0) return null;
                  return (
                    <tr key={col} className="border-t border-line">
                      <td className="px-3 py-2 font-medium">{cellText(h) || `#${col + 1}`}</td>
                      <td className="px-3 py-2 text-sm text-ink-soft">{samples.join(" · ")}</td>
                      <td className="px-3 py-1.5">
                        <Select aria-label={cellText(h)} value={mapping[col] ?? ""} onChange={(e) => setColumn(col, e.target.value as FieldId | "")}>
                          <option value="">{t("impIgnore")}</option>
                          {fields.map((f) => (
                            <option key={f.id} value={f.id}>
                              {t(kind !== "STOCK" && f.id === "name" ? "fPartyName" : FIELD_LABEL[f.id])}
                              {f.required ? " *" : ""}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            {missing.length > 0 && <span className="text-sm text-bad">{t("impMissing", { fields: missing.map((f) => t(FIELD_LABEL[f])).join(", ") })}</span>}
            <Button kind="primary" onClick={check} disabled={missing.length > 0}>
              {t("impCheck")}
            </Button>
          </div>
        </section>
      )}

      {(step === "preview" || step === "working") && validation && (
        <section className="space-y-4 rounded-xl border border-line bg-card p-5">
          <h2 className="font-semibold">{t("impStep4")}</h2>
          <p className="text-lg">{t("impReady", { ok: validation.rows.length, skip: validation.skipped })}</p>
          {totals && (
            <>
              <p className="num text-ink-soft">
                {t("impTotals", { items: totals.items, batches: totals.batches, mrp: formatPaise(totals.mrpValue), pr: formatPaise(totals.purchaseValue) })}
              </p>
              <p className="text-sm text-ink-soft">{t("impExistingNote")}</p>
            </>
          )}
          <IssueList title={t("impErrorsTitle")} tone="bad" groups={groups.filter((g) => g.error)} />
          <IssueList title={t("impWarningsTitle")} tone="warn" groups={groups.filter((g) => !g.error)} />
          {kind === "STOCK" && openingCount > 0 && (
            <Banner tone="warn">
              <p>{t("impAlready", { n: openingCount })}</p>
              <label className="mt-2 flex items-center gap-2 font-medium">
                <input type="checkbox" checked={confirmAgain} onChange={(e) => setConfirmAgain(e.target.checked)} className="h-4 w-4" />
                {t("impConfirmAgain")}
              </label>
            </Banner>
          )}
          <div className="flex justify-end gap-3">
            <Button onClick={() => setStep("map")}>{t("back")}</Button>
            <Button kind="primary" onClick={runImport} disabled={step === "working" || validation.rows.length === 0 || blockedByOpening || !hasDatabase()}>
              {step === "working" ? t("impWorking") : t("impDo", { n: validation.rows.length })}
            </Button>
          </div>
        </section>
      )}

      {step === "done" && (
        <section className="rounded-xl border border-ok/30 bg-brand-soft p-6">
          <h2 className="text-xl font-semibold text-ok">{t("impDone")}</h2>
          <p className="mt-1 text-lg">{result}</p>
          <div className="mt-4 flex gap-3">
            <Button kind="primary" onClick={() => navigate(listPath)}>
              {t("impOpenList")}
            </Button>
            <Button onClick={reset}>{t("impAnother")}</Button>
          </div>
        </section>
      )}
    </div>
  );
}

function IssueList(props: { title: string; tone: "bad" | "warn"; groups: ReturnType<typeof groupIssues> }) {
  const { t } = useT();
  if (props.groups.length === 0) return null;
  return (
    <div>
      <h3 className={"mb-1 text-sm font-semibold " + (props.tone === "bad" ? "text-bad" : "text-warn")}>{props.title}</h3>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {props.groups.map((g) => {
          const shown = g.rows.slice(0, 12).join(", ");
          const more = g.rows.length > 12 ? ` ${t("impMore", { n: g.rows.length - 12 })}` : "";
          return (
            <li key={g.code} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
              <span>
                <span className="font-medium">{t(`imp_${g.code}` as StringKey)}</span>
                {g.sample && <span className="ml-2 text-sm text-ink-soft">{t("impExample", { v: g.sample })}</span>}
              </span>
              <span className="num text-sm text-ink-soft">{t("impRows", { rows: shown + more })}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
