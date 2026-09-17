import { create } from "zustand";
import { persist } from "zustand/middleware";

// "minehub" is the platform screen (access administration + master data). It is
// not part of the page-access matrix; it is gated on the permissions it needs.
export type AppPage = "mis" | "fuel-management" | "ev-tracking" | "oee" | "intelligence" | "minehub";

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
