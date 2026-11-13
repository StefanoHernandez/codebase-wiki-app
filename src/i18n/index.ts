import { en } from './en.ts';
import { it } from './it.ts';

export type Lang = 'it' | 'en';
export type LangChoice = 'auto' | Lang;
export type Key = keyof typeof it;
/** Keys that come in `.one` / `.other` pairs, named without the suffix. */
export type PluralKey = { [K in Key]: K extends `${infer B}.one` ? B : never }[Key];

let current: Lang = 'it';

/** Automatic follows the system language: Italian for `it-*`, English for anything else. */
export function resolveLang(choice: LangChoice, systemLang: string): Lang {
  if (choice !== 'auto') return choice;
  return systemLang.toLowerCase().startsWith('it') ? 'it' : 'en';
}

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

/** Locale for `Intl` dates and numbers. */
export function locale(): 'it-IT' | 'en-GB' {
  return current === 'en' ? 'en-GB' : 'it-IT';
}

/** Text for `key` in the current language, `{name}` placeholders filled from `vars`. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const text = (current === 'en' ? en : it)[key] ?? it[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text;
}

/** Plural text: `key.one` for 1, `key.other` otherwise; `{n}` is the count. */
export function tn(key: PluralKey, n: number, vars?: Record<string, string | number>): string {
  return t(`${key}.${n === 1 ? 'one' : 'other'}` as Key, { n, ...vars });
}
