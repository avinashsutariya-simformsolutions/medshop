import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useT } from "../i18n/I18nProvider";
import { hasDatabase } from "../db";
import { listParties, saveParty, type Party, type PartyForm, type PartyTable } from "../db/masters";
import { dbErrorKey } from "../db/errors";
import { formatPaise } from "../lib/money";
import { gstin as parseGstin } from "../lib/importer/values";
import { useFormKeys } from "../hooks/useFormKeys";
import { Banner, Button, Field, PageHeader, TextInput, inputCls } from "../components/Form";
import { SearchIcon } from "../components/Icons";

const EMPTY: PartyForm = { name: "", phone: "", address: "", gstin: "", dlNo: "", openingRupees: "", creditLimitRupees: "" };

function toForm(p: Party): PartyForm {
  return {
    name: p.name,
    phone: p.phone ?? "",
    address: p.address ?? "",
    gstin: p.gstin ?? "",
    dlNo: p.dl_no ?? "",
    openingRupees: p.opening_balance_paise ? String(p.opening_balance_paise / 100) : "",
    creditLimitRupees: p.credit_limit_paise ? String(p.credit_limit_paise / 100) : "",
  };
}

/** Suppliers and customers share one screen: list on the left, form on the right. */
export function PartiesPage({ table }: { table: PartyTable }) {
  const { t } = useT();
  const navigate = useNavigate();
  const isSupplier = table === "suppliers";
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Party[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [form, setForm] = useState<PartyForm>(EMPTY);
  const [original, setOriginal] = useState<PartyForm>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    if (!hasDatabase()) return;
    listParties(table, q).then(setRows).catch((e) => setError(String(e)));
  }, [table, q]);

  useEffect(() => {
    const h = setTimeout(reload, q ? 120 : 0);
    return () => clearTimeout(h);
  }, [reload, q]);

  // Switching between suppliers and customers starts fresh.
  useEffect(() => {
    setSelected(null);
    setForm(EMPTY);
    setOriginal(EMPTY);
    setQ("");
    nameRef.current?.focus();
  }, [table]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(original), [form, original]);
  const gstinCheck = parseGstin(form.gstin);
  const gstinBad = gstinCheck !== null && "error" in gstinCheck;
  const nameMissing = !form.name.trim();
  const set = <K extends keyof PartyForm>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function pick(p: Party | null) {
    setSelected(p?.id ?? null);
    const f = p ? toForm(p) : EMPTY;
    setForm(f);
    setOriginal(f);
    setError(null);
    setShowErrors(false);
    setTimeout(() => nameRef.current?.focus(), 0);
  }

  async function save() {
    setShowErrors(true);
    if (nameMissing || gstinBad || !hasDatabase()) return;
    try {
      const id = await saveParty(table, form, selected ?? undefined);
      setSelected(id);
      setOriginal(form);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 1500);
      reload();
    } catch (e) {
      const { key, raw } = dbErrorKey(e);
      setError(t(key, { msg: raw }));
    }
  }

  const { onFormKeyDown, leaveWarning } = useFormKeys({ dirty, onSave: save });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        pick(null);
      } else if (e.altKey && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        navigate("/import", { state: { from: `/${table}` } });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const title = isSupplier ? t("suppliers") : t("customers");

  return (
    <div>
      <PageHeader
        title={title}
        sub={t("partiesCount", { n: rows.length })}
        actions={
          <>
            <Button onClick={() => navigate("/import", { state: { from: `/${table}` } })} kbd="Alt+I">
              {t("importData")}
            </Button>
            <Button kind="primary" onClick={() => pick(null)} kbd="Alt+N">
              {isSupplier ? t("newSupplier") : t("newCustomer")}
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <section className="lg:col-span-2">
          <div className="relative mb-2">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-ink-soft" />
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={title} className={inputCls + " pl-10"} spellCheck={false} />
          </div>
          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-card p-6 text-center text-ink-soft">{t("emptyParties")}</p>
          ) : (
            <ul className="max-h-[60vh] overflow-auto rounded-xl border border-line bg-card">
              {rows.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    className={"flex w-full items-center justify-between border-b border-line px-4 py-2.5 text-left last:border-0 hover:bg-paper " + (p.id === selected ? "bg-brand-soft" : "")}
                  >
                    <span>
                      <span className="block font-medium">{p.name}</span>
                      <span className="text-sm text-ink-soft">{p.phone ?? ""}</span>
                    </span>
                    {p.opening_balance_paise !== 0 && <span className="num text-sm text-ink-soft">{formatPaise(p.opening_balance_paise)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="lg:col-span-3">
          <h2 className="mb-2 text-lg font-semibold">
            {selected ? (isSupplier ? t("editSupplier") : t("editCustomer")) : isSupplier ? t("newSupplier") : t("newCustomer")}
          </h2>
          <div className="mb-3 space-y-2">
            {leaveWarning && <Banner tone="warn">{t("unsavedWarn")}</Banner>}
            {error && <Banner tone="bad">{error}</Banner>}
            {savedMsg && <Banner tone="ok">{t("saved")}</Banner>}
          </div>
          <form onKeyDown={onFormKeyDown} onSubmit={(e) => e.preventDefault()} className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-card p-5">
            <Field label={t("fPartyName")} htmlFor="pname" required className="col-span-2" error={showErrors && nameMissing ? t("imp_NAME_MISSING") : null}>
              <TextInput id="pname" ref={nameRef} value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={120} aria-invalid={showErrors && nameMissing} />
            </Field>
            <Field label={t("fPhone")} htmlFor="pphone">
              <TextInput id="pphone" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value.replace(/[^\d+ -]/g, ""))} maxLength={20} />
            </Field>
            <Field label={t("fGstin")} htmlFor="pgstin" error={gstinBad ? t("gstinInvalid") : null}>
              <TextInput id="pgstin" value={form.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase().replace(/\s/g, ""))} maxLength={15} aria-invalid={gstinBad} />
            </Field>
            <Field label={t("fAddress")} htmlFor="paddr" className="col-span-2">
              <TextInput id="paddr" value={form.address} onChange={(e) => set("address", e.target.value)} maxLength={300} />
            </Field>
            {isSupplier ? (
              <Field label={t("fDlNo")} htmlFor="pdl">
                <TextInput id="pdl" value={form.dlNo} onChange={(e) => set("dlNo", e.target.value.toUpperCase())} maxLength={60} />
              </Field>
            ) : (
              <Field label={t("fCreditLimit")} htmlFor="plimit">
                <TextInput id="plimit" inputMode="decimal" value={form.creditLimitRupees} onChange={(e) => set("creditLimitRupees", e.target.value.replace(/[^\d.]/g, ""))} />
              </Field>
            )}
            <Field label={t("fOpening")} htmlFor="popen" hint={isSupplier ? t("openingHintSupplier") : t("openingHintCustomer")}>
              <TextInput id="popen" inputMode="decimal" value={form.openingRupees} onChange={(e) => set("openingRupees", e.target.value.replace(/[^\d.]/g, ""))} />
            </Field>
            <div className="col-span-2 flex justify-end">
              <Button kind="primary" onClick={save} kbd="Ctrl+S">
                {t("save")}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
