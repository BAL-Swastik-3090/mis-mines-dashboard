/**
 * How many updates from the office nobody has looked at yet: the number on
 * the bell, in the menu and on the home screen. Read from the tablet's own
 * list (core/notices.ts), so it is right with no signal.
 */

import { create } from 'zustand';
import type { Store } from '@/core/capture/store';
import { unreadCount } from '@/core/notices';

interface NoticesState {
  store: Store | null;
  unread: number;
  attach: (store: Store) => void;
  refresh: () => Promise<void>;
}

export const useNotices = create<NoticesState>()((set, get) => ({
  store: null,
  unread: 0,
  attach: (store) => { set({ store }); void get().refresh(); },
  refresh: async () => {
    const { store } = get();
    if (!store) return;
    try { set({ unread: await unreadCount(store) }); } catch { /* keep the last count */ }
  },
}));
