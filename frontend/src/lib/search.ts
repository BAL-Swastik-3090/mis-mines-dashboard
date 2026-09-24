/**
 * Matching a list against what somebody actually typed.
 *
 * Every list in this app filtered the same way: lower-case the query,
 * lower-case the field, `includes`. That works for names and fails for every
 * code the mine uses, because a code carries punctuation the person reading it
 * off a plate does not type.
 *
 *     MAN-20        typed as  man20, man 20, MAN20
 *     OD 04 B 8777  typed as  od04b8777
 *     OPR-2026-0152 typed as  opr20260152
 *
 * None of those are wrong, and a search that answers "nothing matches" to a
 * vehicle standing on the weighbridge is worse than no search at all — the
 * clerk believes the register, not the screen.
 *
 * So separators and case come off both sides before matching, and the words
 * are matched independently: "man tipper" and "tipper man" find the same
 * trucks. This mirrors what the server does for the registers it searches, so
 * a list filtered in the browser behaves the same as one filtered in SQL.
 */

const NOT_ALPHANUMERIC = /[^a-z0-9]/g;

/** A code with its punctuation and case removed: "MAN-20" -> "man20". */
export function squash(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(NOT_ALPHANUMERIC, "");
}

/** The words someone typed. Punctuation-only words are dropped: a stray
 *  hyphen should narrow nothing rather than match nothing. */
function words(query: string | null | undefined): string[] {
  return String(query ?? "").trim().toLowerCase().split(/\s+/).filter((w) => squash(w) !== "");
}

/**
 * Does this row match what was typed?
 *
 * Every word must match, but each may match a different field — "man tipper"
 * is a make and a type. Requiring all of them is what makes a second word
 * narrow the list instead of widening it.
 *
 * An empty query matches everything, so a caller can pass the query straight
 * through without testing it first.
 */
export function matchesSearch(query: string | null | undefined,
                              fields: readonly unknown[]): boolean {
  const typed = words(query);
  if (typed.length === 0) return true;

  const plain = fields.map((f) => String(f ?? "").toLowerCase());
  const squashed = plain.map((f) => f.replace(NOT_ALPHANUMERIC, ""));

  return typed.every((word) => {
    const bare = squash(word);
    return plain.some((f) => f.includes(word))
        || squashed.some((f) => f.includes(bare));
  });
}

/**
 * How well a row matches, lowest first, for sorting.
 *
 * Someone who types a whole fleet code or a whole number wants that vehicle,
 * not the alphabetically first of the forty that contain those characters
 * somewhere. `keys` are the fields that identify the row — its code and its
 * number — not everything it is searchable by.
 *
 * Returns the same value for every row when nothing is typed, so an existing
 * sort is left undisturbed.
 */
export function rank(query: string | null | undefined,
                     keys: readonly unknown[]): number {
  const needle = squash(query);
  if (!needle) return 3;

  const squashed = keys.map(squash);
  if (squashed.some((k) => k === needle)) return 0;
  if (squashed.some((k) => k.startsWith(needle))) return 1;
  if (squashed.some((k) => k.includes(needle))) return 2;
  return 3;
}
