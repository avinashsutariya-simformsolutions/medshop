import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { dictionaries, type Lang, type StringKey } from "./strings";
import { hasDatabase } from "../db";
import { setSetting } from "../db/repo";

type Vars = Record<string, string | number>;

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: StringKey, vars?: Vars) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    if (hasDatabase()) void setSetting("language", l);
  }, []);

  const t = useCallback(
    (key: StringKey, vars?: Vars) => {
      let s: string = dictionaries[lang][key] ?? dictionaries.en[key];
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used inside I18nProvider");
  return ctx;
}
