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
  /** Everything this person may do. The single source of truth for the UI. */
  permissions: string[];
  /** Pages this user may open, derived server-side from the dashboard.* permissions. */
  allowed_pages: string[];
}

interface AuthStore {
  user: AuthUser | null;
  /** false until the first /auth/me call settles — distinguishes "checking" from "signed out". */
  checked: boolean;
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

  setUser: (user) => set({ user, checked: true }),

  refresh: async () => {
    try {
      const res = await api.get("/auth/me");
      const user = (res.data?.user ?? null) as AuthUser | null;
      set({ user, checked: true });
      return user;
    } catch {
      // 401 is the normal signed-out path, not an error worth surfacing.
      set({ user: null, checked: true });
      return null;
    }
  },

  logout: async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      // Clear locally even if the call failed — the cookie may already be gone.
      set({ user: null, checked: true });
    }
  },

  can: (permission) => (get().user?.permissions ?? []).includes(permission),

  canAny: (...permissions) => {
    const held = get().user?.permissions ?? [];
    return permissions.some((p) => held.includes(p));
  },
}));
