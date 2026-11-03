import { create } from "zustand";
import api from "@/lib/api";

export interface UserRole { code: string; name: string }

export interface AuthUser {
  emp_id: string;
  name: string;
  title: string | null;
  designation: string | null;
  department: string | null;
  email: string | null;
  location: string | null;
  plant: string | null;
  /** The roles this person holds. Roles are data now — never branch on a role
   *  name in the UI; test the permission that role carries. */
  roles: UserRole[];
  /** Where roles and permissions came from. "legacy" means the access
   *  database was unreachable and this is the old, smaller fallback set. */
  access_source?: "minehub" | "legacy";
  /** Everything this person may do. The single source of truth for the UI. */
  permissions: string[];
  /** Pages this user may open, derived server-side from the dashboard.*
   *  permissions.
   *
   *  Optional on purpose: absent means an older session payload that predates
   *  the field, and is tolerated. An empty array means this person has no
   *  dashboards, which is an answer and must be honoured. Collapsing the two
   *  is what showed every dashboard tab to somebody holding none of them. */
  allowed_pages?: string[];
}

interface AuthStore {
  user: AuthUser | null;
  /** false until the first /auth/me call settles — distinguishes "checking" from "signed out". */
  checked: boolean;
  /** Why the last session ENDED, in the server's words, or null. Set only when
   *  the server sent a code — so an idle timeout or a supersede fills it, and
   *  somebody who simply has not signed in yet does not. */
  notice: string | null;
  clearNotice: () => void;
  setUser: (u: AuthUser | null) => void;
  /** Ask the server who we are. The session cookie is httpOnly, so this is the
   *  only way to know — the browser cannot read it. */
  refresh: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
  /** Whether the signed-in user holds a permission. Hiding a control is a
   *  courtesy; the API enforces the same check, so this is never the gate. */
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
}

export const useAuth = create<AuthStore>()((set, get) => ({
  user: null,
  checked: false,
  notice: null,

  setUser: (user) => set({ user, checked: true, notice: null }),

  refresh: async () => {
    try {
      const res = await api.get("/auth/me");
      const user = (res.data?.user ?? null) as AuthUser | null;
      set({ user, checked: true, notice: null });
      return user;
    } catch (err: unknown) {
      // A 401 here is usually the ordinary signed-out path and says nothing
      // worth showing. But it is ALSO what a reload lands on after a session
      // was closed, and that case has a reason the person needs: they were
      // idle, or their ID signed in somewhere else. The server sends a `code`
      // only for the second kind, which is how the two are told apart — a
      // first-time visitor must not be met with a red banner.
      const e = err as { response?: { data?: { detail?: string; code?: string } } };
      const d = e?.response?.data;
      set({
        user: null, checked: true,
        notice: d?.code ? (d.detail ?? null) : null,
      });
      return null;
    }
  },

  clearNotice: () => set({ notice: null }),

  logout: async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      // Clear locally even if the call failed — the cookie may already be gone.
      // No notice: signing out deliberately is not an event to explain back.
      set({ user: null, checked: true, notice: null });
    }
  },

  can: (permission) => (get().user?.permissions ?? []).includes(permission),

  canAny: (...permissions) => {
    const held = get().user?.permissions ?? [];
    return permissions.some((p) => held.includes(p));
  },
}));
