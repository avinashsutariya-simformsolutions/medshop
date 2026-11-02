import { Link, Outlet } from "react-router-dom";
import { useT } from "../i18n/I18nProvider";
import { LANGS, type Lang } from "../i18n/strings";
import { useGlobalShortcuts } from "../hooks/useShortcuts";
import { CrossLogo } from "./Icons";
import { hasDatabase } from "../db";

export function AppShell({ shopName }: { shopName: string }) {
  const { t, lang, setLang } = useT();
  useGlobalShortcuts();

  const today = new Intl.DateTimeFormat(lang === "en" ? "en-IN" : `${lang}-IN`, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center gap-4 border-b border-line bg-card px-6">
        <Link to="/" className="flex items-center gap-2.5 text-brand">
          <CrossLogo className="h-7 w-7" />
          <span className="text-lg font-semibold text-ink">{shopName || t("appName")}</span>
        </Link>
        <span className="text-sm text-ink-soft">{today}</span>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="lang" className="text-sm text-ink-soft">
            {t("language")}
          </label>
          <select
            id="lang"
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="rounded-md border border-line bg-card px-2 py-1 text-sm"
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {!hasDatabase() && (
        <div role="status" className="border-b border-warn/30 bg-warn-soft px-6 py-2 text-sm text-warn">
          <strong>{t("noDbTitle")}</strong> — {t("noDbBody")}
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
