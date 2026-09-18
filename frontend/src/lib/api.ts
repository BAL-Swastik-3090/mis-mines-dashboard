import axios from "axios";

// Always use the Next.js proxy (/api → backend via next.config.ts rewrite).
// Using an absolute URL (http://localhost:8989) would break access from any
// machine other than the server itself — the browser resolves "localhost" to
// the client's own machine, not the server.
const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
  timeout: 60000,   // 60s global — covers cold-start + concurrent DB load
});

/** Fired when the API rejects us as unauthenticated, so AuthWrapper can show the
 *  login screen. A plain DOM event rather than a direct store import: useAuth
 *  imports this module, so calling into it from here would be a cycle. */
export const AUTH_EXPIRED_EVENT = "mines:auth-expired";

// ── Response interceptor: global error handling ───────────────
api.interceptors.response.use(
  (res) => res,
  (err) => {
    // warn (not error) — TanStack Query handles these; console.error triggers the Next.js dev overlay badge
    const status = err?.response?.status;
    const msg    = err?.response?.data?.detail ?? err?.response?.data ?? err.message;
    console.warn(`[API ${status ?? "NET"}]`, msg);

    // A session that expires while the tab is open used to leave the dashboard
    // sitting there with every panel showing "Request failed with status code
    // 401" — which reads as the site being broken rather than as a logout. Tell
    // the app instead, so it returns to the login screen.
    // /auth/me is exempt: its 401 is the normal "not signed in" answer that
    // AuthWrapper asks for on load, and reacting to it would loop.
    const url = err?.config?.url ?? "";
    const revoked = err?.response?.data?.code === "access_revoked";
    const signedOut = (status === 401 && !url.includes("/auth/me")) || revoked;
    if (signedOut && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, {
        detail: {
          message: revoked
            ? String(msg)
            : "Your session timed out after 30 minutes of inactivity. Please sign in again.",
        },
      }));
    }
    return Promise.reject(err);
  }
);

export default api;

// ── Typed endpoint helpers (filled in Phase 2) ───────────────
export const endpoints = {
  health:       "/health",
  stock:        "/stock",
  production:   "/production",
  equipment:    "/equipment",
  dewatering:   "/dewatering",
  loss:         "/loss",
  plant:        "/plant",
};
