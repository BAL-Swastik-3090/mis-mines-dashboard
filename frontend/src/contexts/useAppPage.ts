import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppPage = "mis" | "fuel-management" | "ev-tracking" | "oee";

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
