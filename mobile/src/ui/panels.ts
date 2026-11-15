/**
 * Which side panel is open: the menu, the guide, or the language list.
 *
 * Kept here rather than in the header, and the panels drawn once at the root
 * (GuideHost). A new language retitles every screen and the header is drawn
 * again: state kept in it was lost, and picking a language inside the guide
 * closed the guide (found on the tablet, 16 Nov). Drawn in the header, every
 * screen in the stack would also have opened its own copy.
 */

import { create } from 'zustand';

export type Panel = null | 'menu' | 'guide' | 'lang';

export const usePanel = create<{ panel: Panel; open: (p: Panel) => void }>()(
  (set) => ({ panel: null, open: (panel) => set({ panel }) }));
