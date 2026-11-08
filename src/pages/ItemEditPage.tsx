import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useT } from "../i18n/I18nProvider";
import type { StringKey } from "../i18n/strings";
import { hasDatabase } from "../db";
import { findSameName, getBatches, getItem, listCompanyNames, saveItem, type BatchRow, type ItemForm } from "../db/masters";
import { dbErrorKey } from "../db/errors";
import type { Schedule } from "../db/types";
import { DEFAULT_GST_BP, GST_RATES_BP, gstLabel } from "../lib/gst";
import { formatPaise } from "../lib/money";
import { expiryStatus, formatExpiry, formatQty, isoDate } from "../lib/stock";
import { useFormKeys } from "../hooks/useFormKeys";
import { setLeaveGuard } from "../hooks/leaveGuard";
import { Banner, Button, Field, PageHeader, Select, TextInput } from "../components/Form";

const UNITS = ["TAB", "CAP", "BTL", "TUBE", "PCS", "ML", "GM", "AMP", "VIAL", "SACHET", "KIT"];
const SCHEDULES: { v: Schedule; k: StringKey }[] = [
  { v: "OTC", k: "schOTC" },
  { v: "H", k: "schH" },
  { v: "H1", k: "schH1" },
  { v: "X", k: "schX" },
  { v: "NDPS", k: "schNDPS" },
];

const EMPTY: ItemForm = {
  name: "",
  company: "",
  salt: "",
  unit: "TAB",
  packSize: 10,
  hsn: "",
  gstBp: DEFAULT_GST_BP,
  schedule: "OTC",
  rack: "",
  barcode: "",
  reorderPacks: 0,
};

export function ItemEditPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { id: idParam } = useParams();
  const id = idParam && idParam !== "new" ? Number(idParam) : undefined;

  const [form, setForm] = useState<ItemForm>(EMPTY);
  const [original, setOriginal] = useState<ItemForm>(EMPTY);
  const [companies, setCompanies] = useState<string[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [same, setSame] = useState<{ id: number; name: string; company: string | null; pack_size: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!hasDatabase()) return;
    listCompanyNames().then(setCompanies).catch(() => {});
    if (id) {
      getItem(id).then((r) => {
        if (!r) return navigate("/stock");
        const { id: _ignored, ...f } = r;
        setForm(f);
        setOriginal(f);
      });
      getBatches(id).then(setBatches);
    }
    nameRef.current?.focus();
  }, [id, navigate]);

  // Warn about an existing medicine with the same name while typing a new one.
  useEffect(() => {
    if (!hasDatabase() || !form.name.trim()) return setSame([]);
    const h = setTimeout(() => findSameName(form.name, id).then(setSame).catch(() => {}), 250);
    return () => clearTimeout(h);
  }, [form.name, id]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(original), [form, original]);
  const invalid = {
    name: !form.name.trim(),
    packSize: !Number.isInteger(form.packSize) || form.packSize < 1 || form.packSize > 1000,
  };
  const set = <K extends keyof ItemForm>(k: K, v: ItemForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setShowErrors(true);
    if (saving || invalid.name || invalid.packSize || !hasDatabase()) return;
    setSaving(true);
    setError(null);
    try {
      await saveItem(form, id);
      setLeaveGuard(null);
      setOriginal(form);
      navigate("/stock");
    } catch (e) {
      const { key, raw } = dbErrorKey(e);
      setError(t(key, { msg: raw }));
    } finally {
      setSaving(false);
    }
  }

  const { onFormKeyDown, leaveWarning } = useFormKeys({ dirty, onSave: save });
  const today = isoDate();

  return (
    <div>
      <PageHeader
        title={id ? t("editMedicineTitle") : t("newMedicineTitle")}
        sub={t("enterHint")}
        actions={
          <>
            <Button onClick={() => navigate("/stock")} kbd="Esc">
              {t("cancel")}
            </Button>
            <Button kind="primary" onClick={save} disabled={saving} kbd="Ctrl+S">
              {t("save")}
            </Button>
          </>
        }
      />

      <div className="space-y-3">
        {leaveWarning && <Banner tone="warn">{t("unsavedWarn")}</Banner>}
        {error && <Banner tone="bad">{error}</Banner>}
      </div>

      <form onKeyDown={onFormKeyDown} onSubmit={(e) => e.preventDefault()} className="mt-3 grid grid-cols-12 gap-4 rounded-xl border border-line bg-card p-5">
        <Field label={t("fName")} htmlFor="name" required className="col-span-12 lg:col-span-6" error={showErrors && invalid.name ? t("imp_NAME_MISSING") : null}>
          <TextInput id="name" ref={nameRef} value={form.name} onChange={(e) => set("name", e.target.value.toUpperCase())} aria-invalid={showErrors && invalid.name} maxLength={120} />
        </Field>
        <Field label={t("fCompany")} htmlFor="company" className="col-span-12 lg:col-span-6">
          <TextInput id="company" list="companies" value={form.company} onChange={(e) => set("company", e.target.value.toUpperCase())} maxLength={120} />
          <datalist id="companies">
            {companies.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>

        {same.length > 0 && (
          <div className="col-span-12">
            <Banner tone="warn">
              {t("dupWarn")}{" "}
              {same.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ", "}
                  <Link className="underline" to={`/stock/items/${s.id}`}>
                    {s.name} {s.company ? `(${s.company})` : ""} · {s.pack_size}
                  </Link>
                </span>
              ))}
            </Banner>
          </div>
        )}

        <Field label={t("fSalt")} htmlFor="salt" className="col-span-12 lg:col-span-6">
          <TextInput id="salt" value={form.salt} onChange={(e) => set("salt", e.target.value)} maxLength={200} />
        </Field>
        <Field label={t("fUnit")} htmlFor="unit" className="col-span-6 lg:col-span-2">
          <Select id="unit" value={form.unit} onChange={(e) => set("unit", e.target.value)}>
            {UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("fPack")} htmlFor="pack" className="col-span-6 lg:col-span-4" hint={batches.length > 0 ? t("packLocked") : t("hintPack")} error={showErrors && invalid.packSize ? t("imp_PACK_INVALID") : null}>
          <TextInput id="pack" inputMode="numeric" value={String(form.packSize)} onChange={(e) => set("packSize", Number(e.target.value.replace(/\D/g, "")) || 0)} aria-invalid={showErrors && invalid.packSize} disabled={batches.length > 0} />
        </Field>

        <Field label={t("fGst")} htmlFor="gst" className="col-span-6 lg:col-span-2" hint={t("gstHint")}>
          <Select id="gst" value={form.gstBp} onChange={(e) => set("gstBp", Number(e.target.value))}>
            {GST_RATES_BP.map((g) => (
              <option key={g} value={g}>
                {gstLabel(g)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("fHsn")} htmlFor="hsn" className="col-span-6 lg:col-span-2">
          <TextInput id="hsn" inputMode="numeric" value={form.hsn} onChange={(e) => set("hsn", e.target.value.replace(/\D/g, "").slice(0, 8))} />
        </Field>
        <Field label={t("fSchedule")} htmlFor="schedule" className="col-span-12 lg:col-span-4" hint={t("hintSchedule")}>
          <Select id="schedule" value={form.schedule} onChange={(e) => set("schedule", e.target.value as Schedule)}>
            {SCHEDULES.map((s) => (
              <option key={s.v} value={s.v}>
                {t(s.k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("fRack")} htmlFor="rack" className="col-span-6 lg:col-span-2">
          <TextInput id="rack" value={form.rack} onChange={(e) => set("rack", e.target.value.toUpperCase())} maxLength={30} />
        </Field>
        <Field label={t("fBarcode")} htmlFor="barcode" className="col-span-6 lg:col-span-2">
          <TextInput id="barcode" value={form.barcode} onChange={(e) => set("barcode", e.target.value.trim())} maxLength={32} />
        </Field>
        <Field label={t("fReorder")} htmlFor="reorder" className="col-span-12 lg:col-span-4" hint={t("hintReorder")}>
          <TextInput id="reorder" inputMode="numeric" value={String(form.reorderPacks)} onChange={(e) => set("reorderPacks", Number(e.target.value.replace(/\D/g, "")) || 0)} />
        </Field>
      </form>

      {id && (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">{t("batchesTitle")}</h2>
          {batches.length === 0 ? (
            <p className="text-ink-soft">{t("noBatches")}</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-card">
              <table className="w-full text-left">
                <thead className="bg-paper text-sm text-ink-soft">
                  <tr>
                    <th className="px-4 py-2 font-medium">{t("colBatch")}</th>
                    <th className="px-4 py-2 font-medium">{t("colExpiry")}</th>
                    <th className="px-4 py-2 text-right font-medium">{t("colMrp")}</th>
                    <th className="px-4 py-2 text-right font-medium">{t("fPurchaseRate")}</th>
                    <th className="px-4 py-2 text-right font-medium">{t("colQty")}</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => {
                    const st = expiryStatus(b.expiry, today, 90);
                    return (
                      <tr key={b.id} className="border-t border-line">
                        <td className="px-4 py-2 font-mono">{b.batch_no}</td>
                        <td className={"num px-4 py-2 " + (st === "EXPIRED" ? "font-semibold text-bad" : st === "NEAR" ? "text-warn" : "")}>{formatExpiry(b.expiry)}</td>
                        <td className="num px-4 py-2 text-right">{formatPaise(b.mrp_paise)}</td>
                        <td className="num px-4 py-2 text-right">{formatPaise(b.purchase_rate_paise)}</td>
                        <td className="num px-4 py-2 text-right">{formatQty(b.qty_units, form.packSize, form.unit.toLowerCase())}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
