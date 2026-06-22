import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8989/api",
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
