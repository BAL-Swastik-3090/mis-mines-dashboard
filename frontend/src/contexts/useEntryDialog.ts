import { create } from "zustand";

/**
 * Which data-entry dialog the header menu has opened, if any.
 *
 * WHY A STORE. The dialogs are opened from the three-dot menu in the header,
 * which renders on every page, while each dialog belongs to the section that
 * holds the figures it needs. They have no common ancestor that could hold the
 * state, and threading callbacks from the header down through the layout into
 * two unrelated sections would couple four components for no reason.
 *
 * WHY ONE FIELD RATHER THAN A BOOLEAN EACH. Two booleans allow both dialogs to
 * be open at once — open one, dismiss the menu, open the other — and the second
 * would render on top of the first with the first still mounted behind it. One
 * field makes that unrepresentable.
 */
export type EntryDialog = "prev-day" | "mines-stock";

interface EntryDialogStore {
  which: EntryDialog | null;
  open: (which: EntryDialog) => void;
  close: () => void;
}

export const useEntryDialog = create<EntryDialogStore>((set) => ({
  which: null,
  open: (which) => set({ which }),
  close: () => set({ which: null }),
}));
