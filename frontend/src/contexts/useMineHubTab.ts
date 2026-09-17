import { create } from "zustand";

export type MineHubTab = "users" | "roles" | "audit" | "equipment";

/** Which MineHub tab is open.
 *
 *  Lifted out of the component so the sidebar can jump straight to a section.
 *  Merging Access Control into MineHub put it one click deeper and it stopped
 *  being findable; listing the tabs as sidebar sub-items fixes that without
 *  going back to several top-level pages.
 *
 *  Deliberately not persisted: coming back to the platform screen should start
 *  at People & Access rather than wherever you happened to stop last week.
 */
interface MineHubTabStore {
  tab: MineHubTab;
  setTab: (t: MineHubTab) => void;
}

export const useMineHubTab = create<MineHubTabStore>()((set) => ({
  tab: "users",
  setTab: (tab) => set({ tab }),
}));
