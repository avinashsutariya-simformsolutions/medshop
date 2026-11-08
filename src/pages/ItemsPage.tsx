import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useT } from "../i18n/I18nProvider";
import { hasDatabase } from "../db";
import { countItems, listItems } from "../db/masters";
import type { ItemSearchRow } from "../db/types";
import { formatPaise } from "../lib/money";
import { formatExpiry, formatQty } from "../lib/stock";
import { gstLabel } from "../lib/gst";
import { Button, PageHeader, inputCls } from "../components/Form";
import { SearchIcon } from "../components/Icons";
import { ScheduleBadge } from "../components/ScheduleBadge";

const LIMIT = 200;

export function ItemsPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ItemSearchRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (hasDatabase()) countItems().then(setTotal).catch(() => {});
  }, []);

  useEffect(() => {
    if (!hasDatabase()) {
      setRows([]);
      return;
    }
    let stale = false;
    const id = setTimeout(() => {
      listItems(q, LIMIT)
        .then((r) => {
          if (stale) return;
          setRows(r);
          setActive(0);
        })
        .catch((e) => !stale && setError(String(e)));
    }, q ? 120 : 0);
    return () => {
      stale = true;
      clearTimeout(id);
    };
  }, [q]);

  // Alt+N new medicine, Alt+I import
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (!e.altKey) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        navigate("/stock/items/new");
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        navigate("/import", { state: { from: "/stock" } });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!rows?.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      navigate(`/stock/items/${rows[active].id}`);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("medicines")}
        sub={t("itemsCount", { n: total })}
        actions={
          <>
            <Button onClick={() => navigate("/import", { state: { from: "/stock" } })} kbd="Alt+I">
              {t("importData")}
            </Button>
            <Button kind="primary" onClick={() => navigate("/stock/items/new")} kbd="Alt+N">
              {t("newMedicine")}
            </Button>
          </>
        }
      />

      <div className="relative mb-3">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-ink-soft" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className={inputCls + " h-12 pl-10 text-lg"}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      {error && <p role="alert" className="mb-3 rounded-lg bg-bad-soft px-4 py-3 text-bad">{error}</p>}

      {rows && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-card p-10 text-center text-ink-soft">
          {q.trim() ? t("noResults", { q: q.trim() }) : t("emptyItems")}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-left">
            <thead className="bg-paper text-sm text-ink-soft">
              <tr>
                <th className="px-4 py-2 font-medium">{t("colMedicine")}</th>
                <th className="px-4 py-2 font-medium">{t("colCompany")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("colPack")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("colGst")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("colStock")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("colMrp")}</th>
                <th className="px-4 py-2 font-medium">{t("colExpiry")}</th>
                <th className="px-4 py-2 font-medium">{t("colRack")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const low = r.reorder_level > 0 && r.stock_units < r.reorder_level;
                return (
                  <tr
                    key={r.id}
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => navigate(`/stock/items/${r.id}`)}
                    className={"cursor-pointer border-t border-line " + (i === active ? "bg-brand-soft" : "")}
                  >
                    <td className="px-4 py-2">
                      <div className="font-medium">
                        {r.name}
                        <ScheduleBadge schedule={r.schedule} />
                      </div>
                      {r.salt && <div className="text-sm text-ink-soft">{r.salt}</div>}
                    </td>
                    <td className="px-4 py-2 text-ink-soft">{r.company ?? ""}</td>
                    <td className="num px-4 py-2 text-right">{r.pack_size > 1 ? `${r.pack_size} ${r.unit.toLowerCase()}` : r.unit.toLowerCase()}</td>
                    <td className="num px-4 py-2 text-right">{gstLabel(r.gst_rate_bp)}</td>
                    <td className={"num px-4 py-2 text-right " + (r.stock_units === 0 ? "text-bad" : low ? "text-warn" : "")}>
                      {r.stock_units > 0 ? formatQty(r.stock_units, r.pack_size, r.unit.toLowerCase()) : t("outOfStock")}
                    </td>
                    <td className="num px-4 py-2 text-right">{r.mrp_paise != null ? formatPaise(r.mrp_paise) : ""}</td>
                    <td className="num px-4 py-2">{r.nearest_expiry ? formatExpiry(r.nearest_expiry) : ""}</td>
                    <td className="px-4 py-2 text-ink-soft">{r.rack ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!q && total > rows.length && (
            <p className="border-t border-line px-4 py-2 text-sm text-ink-soft">{t("showingFirst", { n: rows.length })}</p>
          )}
        </div>
      )}
    </div>
  );
}
