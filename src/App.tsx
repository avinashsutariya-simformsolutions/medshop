import { useEffect, useState } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { I18nProvider } from "./i18n/I18nProvider";
import type { Lang } from "./i18n/strings";
import { AppShell } from "./components/AppShell";
import { Home } from "./pages/Home";
import { ComingSoon } from "./pages/ComingSoon";
import { hasDatabase } from "./db";
import { getSettings } from "./db/repo";
import type { Settings } from "./db/types";

type Boot = { status: "loading" } | { status: "ready"; settings: Partial<Settings> } | { status: "error"; msg: string };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ status: "loading" });

  useEffect(() => {
    if (!hasDatabase()) {
      setBoot({ status: "ready", settings: {} });
      return;
    }
    // First open runs the migrations, so this also creates the database.
    getSettings()
      .then((settings) => setBoot({ status: "ready", settings }))
      .catch((e) => setBoot({ status: "error", msg: String(e) }));
  }, []);

  if (boot.status === "loading") {
    return <div className="grid min-h-screen place-items-center text-ink-soft">MedShop…</div>;
  }
  if (boot.status === "error") {
    return (
      <div role="alert" className="m-10 rounded-xl bg-bad-soft p-6 text-bad">
        Database error: {boot.msg}
      </div>
    );
  }

  const s = boot.settings;
  const lang = (["en", "hi", "mr"].includes(s.language ?? "") ? s.language : "hi") as Lang;
  const nearDays = Number(s.near_expiry_days) || 90;

  return (
    <I18nProvider initial={lang}>
      <HashRouter>
        <Routes>
          <Route element={<AppShell shopName={s.shop_name ?? ""} />}>
            <Route index element={<Home nearDays={nearDays} />} />
            <Route path="bill" element={<ComingSoon title="newBill" sprint={3} />} />
            <Route path="purchase" element={<ComingSoon title="purchase" sprint={2} />} />
            <Route path="stock" element={<ComingSoon title="stock" sprint={4} />} />
            <Route path="expiry" element={<ComingSoon title="expiry" sprint={4} />} />
            <Route path="reports" element={<ComingSoon title="reports" sprint={6} />} />
            <Route path="settings" element={<ComingSoon title="settings" sprint={4} />} />
            <Route path="*" element={<Home nearDays={nearDays} />} />
          </Route>
        </Routes>
      </HashRouter>
    </I18nProvider>
  );
}
