/**
 * The app in the operator's own language: English, Hindi, Odia, Bengali.
 *
 * ── THE ENGLISH SENTENCE IS THE KEY ──────────────────────────────────────────
 * Screens are written in English and wrap what they show in t(): the English
 * is both the key and what is shown when a translation is missing. So a screen
 * reads naturally in the code, a new sentence works in English the moment it
 * is written, and a gap in a translation shows English rather than a blank or
 * a key name. `scripts/i18n-keys` lists every wrapped sentence so the
 * dictionaries can be checked for gaps.
 *
 * Variables are {name} in the sentence: t('{n} of {total} checks', {n, total}).
 *
 * ── WHAT IS NOT TRANSLATED ───────────────────────────────────────────────────
 * The checklist questions themselves. They come from the dashboard as the
 * mine wrote them; translating them needs a column per language on each
 * checklist item (gap G12, next step). Machine codes, names and numbers are
 * never translated. Digits stay 0-9 throughout: a meter reading or a fleet
 * code read wrongly is worse than one in a familiar script.
 *
 * Translations are a first draft and must be read by a native speaker at the
 * mine before go-live.
 */

import { useCallback } from 'react';
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { hi } from './hi';
import { or } from './or';
import { bn } from './bn';
import { PATTERNS } from './patterns';

export type Lang = 'en' | 'hi' | 'or' | 'bn';

/** Each language named in itself, so it can be found by somebody who reads only that one. */
export const LANGS: { code: Lang; name: string; short: string }[] = [
  { code: 'en', name: 'English', short: 'EN' },
  { code: 'hi', name: 'हिन्दी', short: 'हि' },
  { code: 'or', name: 'ଓଡ଼ିଆ', short: 'ଓ' },
  { code: 'bn', name: 'বাংলা', short: 'বা' },
];

const DICTS: Record<Lang, Record<string, string>> = { en: {}, hi, or, bn };
const ENTRY = 'hoto.ui.lang';

function fill(s: string, vars?: Record<string, string | number | null | undefined>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
}

/** Translate one sentence. Outside React, or for a known language. */
export function translate(lang: Lang, english: string,
                          vars?: Record<string, string | number | null | undefined>): string {
  return fill(DICTS[lang][english] ?? english, vars);
}

/**
 * Translate a sentence built elsewhere -- by the rules in core, which stay in
 * English so their tests read as the specification does. Exact sentences
 * first, then patterns with a machine, a name or a number in them.
 */
export function translateMessage(lang: Lang, msg: string): string {
  if (lang === 'en' || !msg) return msg;
  const exact = DICTS[lang][msg];
  if (exact) return exact;
  for (const p of PATTERNS) {
    const m = msg.match(p.re);
    if (m) {
      const tpl = DICTS[lang][p.template];
      if (!tpl) return msg;
      return fill(tpl, Object.fromEntries(p.vars.map((v, i) => [v, m[i + 1]])));
    }
  }
  return msg;
}

interface LangState {
  lang: Lang;
  ready: boolean;
  load: () => Promise<void>;
  setLang: (l: Lang) => Promise<void>;
}

export const useLang = create<LangState>()((set) => ({
  lang: 'en',
  ready: false,
  load: async () => {
    try {
      const v = await SecureStore.getItemAsync(ENTRY);
      if (v && v in DICTS) set({ lang: v as Lang });
    } catch { /* English until told otherwise */ }
    set({ ready: true });
  },
  setLang: async (l) => {
    set({ lang: l });
    try { await SecureStore.setItemAsync(ENTRY, l); } catch { /* still switched for now */ }
  },
}));

/** t() for the current language, and tn() for a count: tn(n, '{n} check', '{n} checks'). */
export function useT() {
  const lang = useLang((s) => s.lang);
  const t = useCallback(
    (english: string, vars?: Record<string, string | number | null | undefined>) =>
      translate(lang, english, vars),
    [lang]);
  const tn = useCallback(
    (n: number, one: string, many: string, vars?: Record<string, string | number | null | undefined>) =>
      translate(lang, n === 1 ? one : many, { n, ...vars }),
    [lang]);
  const tm = useCallback((msg: string) => translateMessage(lang, msg), [lang]);
  return { t, tn, tm, lang };
}
