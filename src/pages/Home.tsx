import { useEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n/I18nProvider";
import type { StringKey } from "../i18n/strings";
import { hasDatabase } from "../db";
import { getDashboardCounts, searchItems } from "../db/repo";
import type { DashboardCounts, ItemSearchRow } from "../db/types";
import { formatPaise } from "../lib/money";
import { formatExpiry, formatQty } from "../lib/stock";
import { SEARCH_EVENT } from "../hooks/useShortcuts";
import {
  BillIcon,
  ExpiryIcon,
  PurchaseIcon,
  ReportIcon,
  SearchIcon,
  SettingsIcon,
  StockIcon,
} from "../components/Icons";

interface Tile {
  to: string;
  key: string;
  title: StringKey;
  desc: StringKey;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  primary?: boolean;
}

const TILES: Tile[] = [
  { to: "/bill", key: "F2", title: "newBill", desc: "newBillDesc", Icon: BillIcon, primary: true },
  { to: "/purchase", key: "F3", title: "purchase", desc: "purchaseDesc", Icon: PurchaseIcon },
  { to: "/stock", key: "F6", title: "stock", desc: "stockDesc", Icon: StockIcon },
  { to: "/expiry", key: "F7", title: "expiry", desc: "expiryDesc", Icon: ExpiryIcon },
  { to: "/reports", key: "F8", title: "reports", desc: "reportsDesc", Icon: ReportIcon },
  { to: "/settings", key: "F9", title: "settings", desc: "settingsDesc", Icon: SettingsIcon },
];

export function Home({ nearDays }: { nearDays: number }) {
  const { t } = useT();
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasDatabase()) return;
    getDashboardCounts(nearDays)
      .then(setCounts)
      .catch((e) => setError(String(e)));
  }, [nearDays]);

  return (
    <div className="space-y-6">
      <ItemSearch />

      {error && (
        <p role="alert" className="rounded-lg bg-bad-soft px-4 py-3 text-bad">
          {t("dbError", { msg: error })}
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Summary">
        <Stat
          label={t("todaySale")}
          value={counts ? formatPaise(counts.today_sale_paise) : "—"}
          sub={counts ? t("bills", { n: counts.today_bills }) : ""}
        />
        <Stat
          label={t("nearExpiry", { n: nearDays })}
          value={counts ? String(counts.near_expiry_batches) : "—"}
          sub={t("batches")}
          tone={counts && counts.near_expiry_batches > 0 ? "warn" : undefined}
          to="/expiry"
        />
        <Stat
          label={t("expiredInStock")}
          value={counts ? String(counts.expired_in_stock) : "—"}
          sub={t("batches")}
          tone={counts && counts.expired_in_stock > 0 ? "bad" : undefined}
          to="/expiry"
        />
        <Stat
          label={t("lowStock")}
          value={counts ? String(counts.low_stock_items) : "—"}
          sub={t("items")}
          tone={counts && counts.low_stock_items > 0 ? "warn" : undefined}
          to="/stock"
        />
      </section>

      <nav className="grid grid-cols-2 gap-4 lg:grid-cols-3" aria-label="Main">
        {TILES.map(({ to, key, title, desc, Icon, primary }) => (
          <Link
            key={to}
            to={to}
            className={
              "group relative flex min-h-36 flex-col justify-between rounded-xl border p-5 transition " +
              (primary
                ? "border-brand bg-brand text-white hover:bg-brand-ink"
                : "border-line bg-card hover:border-brand hover:shadow-sm")
            }
          >
            <div className="flex items-start justify-between">
              <Icon className={"h-9 w-9 " + (primary ? "text-white" : "text-brand")} />
              <kbd
                className={
                  "rounded-md border px-2 py-0.5 font-mono text-sm " +
                  (primary ? "border-white/40 text-white" : "border-line text-ink-soft")
                }
              >
                {key}
              </kbd>
            </div>
            <div>
              <div className="text-xl font-semibold">{t(title)}</div>
              <div className={"mt-1 text-sm " + (primary ? "text-white/85" : "text-ink-soft")}>{t(desc)}</div>
            </div>
          </Link>
        ))}
      </nav>
    </div>
  );
}

function Stat(props: { label: string; value: string; sub: string; tone?: "warn" | "bad"; to?: string }) {
  const toneCls =
    props.tone === "bad"
      ? "border-bad/30 bg-bad-soft"
      : props.tone === "warn"
        ? "border-warn/30 bg-warn-soft"
        : "border-line bg-card";
  const valueCls = props.tone === "bad" ? "text-bad" : props.tone === "warn" ? "text-warn" : "text-ink";
  const body = (
    <>
      <div className="text-sm text-ink-soft">{props.label}</div>
      <div className={"num mt-1 text-2xl font-semibold " + valueCls}>{props.value}</div>
      <div className="text-sm text-ink-soft">{props.sub}</div>
    </>
  );
  const cls = `block rounded-xl border px-4 py-3 ${toneCls}`;
  return props.to ? (
    <Link to={props.to} className={cls + " hover:border-brand"}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function ItemSearch() {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ItemSearchRow[]>([]);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener(SEARCH_EVENT, focus);
    focus();
    return () => window.removeEventListener(SEARCH_EVENT, focus);
  }, []);

  // Debounce so fast typing does not fire a query per key.
  useEffect(() => {
    if (!hasDatabase()) return;
    const text = q.trim();
    if (!text) {
      setRows([]);
      setSearched(false);
      return;
    }
    let stale = false;
    const id = setTimeout(() => {
      searchItems(text)
        .then((r) => {
          if (stale) return;
          setRows(r);
          setActive(0);
          setSearched(true);
        })
        .catch(() => !stale && setRows([]));
    }, 120);
    return () => {
      stale = true;
      clearTimeout(id);
    };
  }, [q]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setQ("");
    }
    // Enter → add to bill: wired up in Sprint 3.
  }

  return (
    <section aria-label="Search">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-4 h-6 w-6 -translate-y-1/2 text-ink-soft" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="h-14 w-full rounded-xl border border-line bg-card pr-36 pl-13 text-lg shadow-sm outline-none focus:border-brand"
          spellCheck={false}
          autoComplete="off"
        />
        <span className="absolute top-1/2 right-4 -translate-y-1/2 text-sm text-ink-soft">{t("searchHint")}</span>
      </div>

      {searched && rows.length === 0 && (
        <p className="mt-2 px-1 text-ink-soft">{t("noResults", { q: q.trim() })}</p>
      )}

      {rows.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-left">
            <thead className="bg-paper text-sm text-ink-soft">
              <tr>
                <th className="px-4 py-2 font-medium">{t("colMedicine")}</th>
                <th className="px-4 py-2 font-medium">{t("colCompany")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("colStock")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("colMrp")}</th>
                <th className="px-4 py-2 font-medium">{t("colExpiry")}</th>
                <th className="px-4 py-2 font-medium">{t("colRack")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  className={"border-t border-line " + (i === active ? "bg-brand-soft" : "")}
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium">
                      {r.name}
                      {r.schedule !== "OTC" && (
                        <span className="ml-2 rounded bg-bad-soft px-1.5 py-0.5 text-xs font-semibold text-bad">
                          {r.schedule}
                        </span>
                      )}
                    </div>
                    {r.salt && <div className="text-sm text-ink-soft">{r.salt}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft">{r.company ?? ""}</td>
                  <td className={"num px-4 py-2.5 text-right " + (r.stock_units > 0 ? "" : "text-bad")}>
                    {r.stock_units > 0 ? formatQty(r.stock_units, r.pack_size, r.unit.toLowerCase()) : t("outOfStock")}
                  </td>
                  <td className="num px-4 py-2.5 text-right">{r.mrp_paise != null ? formatPaise(r.mrp_paise) : ""}</td>
                  <td className="num px-4 py-2.5">{r.nearest_expiry ? formatExpiry(r.nearest_expiry) : ""}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{r.rack ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
