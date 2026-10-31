import { create } from "zustand";
import { persist } from "zustand/middleware";

// "access-control" (administration) and "minehub" (the operational platform) are
// separate screens, split by audience rather than merged for convenience. Neither
// is in the page-access matrix; each is gated on the permissions it needs.
// "manpower" is split out of "minehub" rather than living as a tab inside it:
// the people who keep the equipment register and the people who keep the
// workforce register are different people doing different work, and a section
// somebody has to enter through somebody else's screen is a section they stop
// visiting.
// "usage" is its own screen and not a tab inside Access Control: the two
// answer different questions. Access Control is "who may do what", changed
// about twice a month; Usage is "who actually did", read by whoever is asking
// whether the platform earns its keep.
// "weather" is its own screen rather than a strip on the MIS dashboard: it is
// consulted before a shift is planned, by people who are not otherwise reading
// production figures, and a full-height map cannot share a page with anything.
export type AppPage = "mis" | "executive-summary" | "weather" | "fuel-management" | "ev-tracking" | "product-costing" | "oee" | "intelligence" | "amira" | "access-control" | "data-health" | "minehub" | "manpower" | "operations" | "workforce" | "market" | "organisation" | "weighbridge" | "gate" | "capacity" | "usage";

interface AppPageStore {
  page: AppPage;
  /** Where the user was before the current page.
   *
   *  Data Health is reached by a button in the header rather than by walking
   *  the sidebar, so somebody can land on it from any screen and then have to
   *  remember which one they were reading. A sidebar is not a way back: it
   *  tells you where you may go, not where you came from.
   *
   *  Null at the start of a session and after a reload, which the back control
   *  must handle rather than offering a return to a page nobody visited. */
  previousPage: AppPage | null;
  setPage: (p: AppPage) => void;
}

export const useAppPage = create<AppPageStore>()(
  persist(
    (set) => ({
      // The landing screen. A one-page management view of the whole mine comes
      // before the operational dashboard it summarises, which is what the mine
      // asked for. Persisted after that, so anyone who navigates away stays
      // where they left off — only a fresh sign-in resets to this.
      page: "executive-summary",
      previousPage: null,
      // Navigating to the page you are already on is not a move, and recording
      // it would make "back" point at itself.
      setPage: (page) => set((s) =>
        page === s.page ? s : { page, previousPage: s.page }),
    }),
    {
      name: "kaliapani-app-page",
      // ONLY `page` IS PERSISTED, deliberately. A "back" restored from a week
      // ago would send somebody to a screen they have no memory of opening,
      // and the stored shape stays exactly what it was before this field
      // existed.
      partialize: (s) => ({ page: s.page }),
    }
  )
);
