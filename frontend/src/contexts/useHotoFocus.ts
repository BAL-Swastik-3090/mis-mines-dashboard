/**
 * Carrying "which machine" from one handover screen to the next.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * Until now no HOTO screen linked to any other: `setPage` appeared nowhere in
 * any of the six. So a foreman looking at a defect on MAN-11 who wanted the
 * handover that raised it had to read the machine name, open the register by
 * hand, set the dates, and search for it. Six screens that cannot reach each
 * other are six tools, not one.
 *
 * ── WHY IT IS TAKEN, NOT READ ────────────────────────────────────────────────
 * `take()` returns the focus once and clears it. A filter that arrived by a
 * link is a statement about THIS journey, not a preference: if it survived,
 * somebody returning to the register next week would find it still filtered to
 * a machine they looked at once and would have no idea why.
 *
 * It is deliberately not in the URL. This dashboard has no routing — every
 * screen is one page — and inventing a query-string convention for one section
 * would be a second way to navigate that only works here.
 */

import { create } from "zustand";
import { useAppPage, type AppPage } from "./useAppPage";

export interface HotoFocus {
  /** The machine to narrow to. Both are carried: the id is exact, the code is
   *  what a text filter can actually match and what a reader recognises. */
  assetId?: number;
  fleetCode?: string;
  /** A specific handover to open on arrival. */
  sessionId?: number;
  sessionRef?: string;
  /** A date to widen the range to, so the row being linked to is in it. The
   *  commonest way a link lands on an empty screen is a default date range
   *  that does not include the thing the link points at. */
  onDate?: string;
  /** Shown to the reader so a narrowed screen explains itself rather than
   *  looking like it has lost most of its data. */
  because?: string;
}

interface Store {
  pending: HotoFocus | null;
  /** Go to a handover screen with something to focus on. */
  goTo: (page: AppPage, focus: HotoFocus) => void;
  /** Read it once, then forget it. */
  take: () => HotoFocus | null;
}

export const useHotoFocus = create<Store>()((set, get) => ({
  pending: null,
  goTo: (page, focus) => {
    set({ pending: focus });
    useAppPage.getState().setPage(page);
  },
  take: () => {
    const f = get().pending;
    if (f) set({ pending: null });
    return f;
  },
}));
