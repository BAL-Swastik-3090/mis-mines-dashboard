import { create } from "zustand";

/**
 * Whether the previous-day entry dialog is open.
 *
 * WHY A STORE FOR ONE BOOLEAN. The dialog is opened from the three-dot menu in
 * the header, which is rendered on every page, while the dialog itself belongs
 * to the MIS table that holds the plan figures it needs. They have no common
 * ancestor that could hold the state, and threading a callback from the header
 * down through the layout into one table would couple three components that
 * are otherwise unrelated.
 *
 * `request()` rather than a plain setter: opening the dialog from elsewhere in
 * the app also has to put the user on the page that renders it, and doing both
 * in one place means a caller cannot do half of it.
 */
interface PrevDayEntryStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const usePrevDayEntry = create<PrevDayEntryStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
