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

// ── Request interceptor: attach JWT if present ────────────────
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: global error handling ───────────────
api.interceptors.response.use(
  (res) => res,
  (err) => {
    // warn (not error) — TanStack Query handles these; console.error triggers the Next.js dev overlay badge
    const status = err?.response?.status;
    const msg    = err?.response?.data?.detail ?? err?.response?.data ?? err.message;
    console.warn(`[API ${status ?? "NET"}]`, msg);
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
