import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from 'react';
import { setBackendLanguage } from '../api';
import { resolveLang, setLang, type Lang, type LangChoice } from '../i18n';

const LANG_KEY = 'cw.lang';

function storedChoice(): LangChoice {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'it' || v === 'en' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

interface LangState {
  choice: LangChoice;
  lang: Lang;
  setChoice(c: LangChoice): void;
}

const Ctx = createContext<LangState | null>(null);

/** Interface language: automatic (system), Italian or English; persisted like the theme. */
export function LangProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<LangChoice>(storedChoice);
  const lang = resolveLang(choice, navigator.language);
  // Set before children render, so every `t()` below uses it on this pass.
  setLang(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    setBackendLanguage(lang).catch(() => {
      /* backend messages stay in the previous language */
    });
  }, [lang]);

  const setChoice = (c: LangChoice) => {
    setChoiceState(c);
    try {
      localStorage.setItem(LANG_KEY, c);
    } catch {
      // Not persisted; still applied for this session.
    }
  };
  return <Ctx.Provider value={{ choice, lang, setChoice }}>{children}</Ctx.Provider>;
}

export function useLang(): LangState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLang outside LangProvider');
  return v;
}

/** Re-renders its subtree from scratch when the language changes (texts are read at render). */
export function LangKeyed({ children }: { children: ReactNode }) {
  return <Fragment key={useLang().lang}>{children}</Fragment>;
}
