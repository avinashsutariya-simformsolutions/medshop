import { Link } from "react-router-dom";
import { useT } from "../i18n/I18nProvider";
import type { StringKey } from "../i18n/strings";

/** Placeholder for screens built in later sprints. */
export function ComingSoon({ title, sprint }: { title: StringKey; sprint: number }) {
  const { t } = useT();
  return (
    <div className="rounded-xl border border-line bg-card p-10 text-center">
      <h1 className="text-2xl font-semibold">{t(title)}</h1>
      <p className="mt-2 text-ink-soft">{t("comingSoon", { n: sprint })}</p>
      <Link to="/" className="mt-6 inline-block rounded-lg bg-brand px-5 py-2.5 font-medium text-white hover:bg-brand-ink">
        {t("backHome")}
      </Link>
    </div>
  );
}
