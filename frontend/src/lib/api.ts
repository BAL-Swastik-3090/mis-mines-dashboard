import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8989/api",
  headers: { "Content-Type": "application/json" },
  timeout: 30000,
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
    console.error("[API Error]", err?.response?.data ?? err.message);
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
