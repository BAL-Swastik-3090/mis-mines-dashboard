/**
 * Whether this tablet's terms of use have been accepted, which version, and
 * when. Kept in the tablet's secure store beside its credential, so wiping the
 * handover database does not unaccept them, and a new TERMS_VERSION asks again.
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { TERMS_VERSION } from './terms';

const ENTRY = 'hoto.terms.accepted';

export interface Acceptance { version: string; at: string }

/** Whether a stored acceptance covers the terms in this build. */
export const covers = (a: Acceptance | null, version: string = TERMS_VERSION): boolean =>
  a != null && a.version === version;

export function parseAcceptance(raw: string | null): Acceptance | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Acceptance>;
    return typeof v.version === 'string' && typeof v.at === 'string'
      ? { version: v.version, at: v.at } : null;
  } catch { return null; }
}

interface TermsState {
  ready: boolean;
  accepted: Acceptance | null;
  load: () => Promise<void>;
  accept: (now?: Date) => Promise<void>;
}

export const useTerms = create<TermsState>()((set) => ({
  ready: false,
  accepted: null,
  load: async () => {
    let raw: string | null = null;
    try { raw = await SecureStore.getItemAsync(ENTRY); } catch { /* asked again */ }
    set({ accepted: parseAcceptance(raw), ready: true });
  },
  accept: async (now = new Date()) => {
    const a: Acceptance = { version: TERMS_VERSION, at: now.toISOString() };
    set({ accepted: a });
    try { await SecureStore.setItemAsync(ENTRY, JSON.stringify(a)); } catch { /* accepted for now */ }
  },
}));
