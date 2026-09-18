import { create } from "zustand";
import { persist } from "zustand/middleware";

// "access-control" (administration) and "minehub" (the operational platform) are
// separate screens, split by audience rather than merged for convenience. Neither
// is in the page-access matrix; each is gated on the permissions it needs.
export type AppPage = "mis" | "fuel-management" | "ev-tracking" | "oee" | "intelligence" | "access-control" | "minehub" | "operations" | "workforce";

interface AppPageStore {
  page: AppPage;
  setPage: (p: AppPage) => void;
}

export const useAppPage = create<AppPageStore>()(
  persist(
    (set) => ({
      page: "mis",
      setPage: (page) => set({ page }),
    }),
    { name: "kaliapani-app-page" }
  )
);
