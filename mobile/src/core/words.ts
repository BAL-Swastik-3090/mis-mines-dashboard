/**
 * Counting things in words an operator would use.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * The app said "6 photo(s)", "2 handover(s)", "1 photo(s)". Brackets are a
 * programmer writing to avoid a decision, and every one of them tells the
 * person holding the tablet that nobody finished this screen. On software that
 * is asking them to certify a machine is safe, that is not a small thing.
 *
 * English pluralisation is irregular, so this takes the plural when it is not
 * just an "s" rather than guessing at a rule.
 */

export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? `${one}s`)}`;
}

/** The same, without the number: "6 photographs waiting" vs "it is waiting". */
export function pluralWord(n: number, one: string, many?: string): string {
  return n === 1 ? one : (many ?? `${one}s`);
}

/** "is" or "are", for a sentence that has to agree with a count. */
export function verb(n: number, singular = 'is', plural_ = 'are'): string {
  return n === 1 ? singular : plural_;
}
