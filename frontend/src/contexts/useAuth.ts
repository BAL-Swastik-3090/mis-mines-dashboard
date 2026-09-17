import { create } from "zustand";
import api from "@/lib/api";

export type MinesRole = "viewer" | "manager" | "admin" | "superadmin";

export interface AuthUser {
  emp_id: string;
  name: string;
  title: string | null;
  designation: string | null;
  department: string | null;
  email: string | null;
  location: string | null;
  plant: string | null;
  mines_role: MinesRole;
  /** Pages this user may open, from the role x page matrix. */
  allowed_pages: string[];
}

interface AuthStore {
  user: AuthUser | null;
  /** null until the first /auth/me call settles — distinguishes "checking" from "signed out". */
  checked: boolean;
  setUser: (u: AuthUser | null) => void;
  /** Ask the server who we are. The session cookie is httpOnly, so this is the
   *  only way to know — the browser cannot read it. */
  refresh: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
  hasRole: (minimum: MinesRole) => boolean;
}

const RANK: Record<MinesRole, number> = { viewer: 1, manager: 2, admin: 3, superadmin: 4 };

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

  hasRole: (minimum) => {
    const role = get().user?.mines_role;
    return role ? RANK[role] >= RANK[minimum] : false;
  },
}));
