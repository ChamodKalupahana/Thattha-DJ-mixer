import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { en, type StringKey } from './en';
import { si } from './si';
import type { Lang } from '../db/types';

const dictionaries: Record<Lang, Record<StringKey, string>> = { en, si };

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: StringKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue>({
  lang: 'en',
  setLang: () => {},
  t: (k) => k,
});

export function I18nProvider({
  lang,
  onLangChange,
  children,
}: {
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  children: ReactNode;
}) {
  const t = useCallback(
    (key: StringKey, params?: Record<string, string | number>) => {
      let s: string = dictionaries[lang][key];
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          s = s.replaceAll(`{${k}}`, String(v));
        }
      }
      return s;
    },
    [lang],
  );

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang: onLangChange, t }),
    [lang, onLangChange, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}