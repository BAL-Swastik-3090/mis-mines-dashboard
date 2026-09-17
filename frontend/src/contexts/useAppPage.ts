import { create } from "zustand";
import { persist } from "zustand/middleware";

// "access-control" is the super-admin screen; it is not part of the page-access
// matrix, it is gated on the admin role itself.
export type AppPage = "mis" | "fuel-management" | "ev-tracking" | "oee" | "intelligence" | "access-control" | "minehub";

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
