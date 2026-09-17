import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Brand / Navy ─────────────────────────────
        navy:    { DEFAULT: "#1a2744", 2: "#0f1c35" },
        steel:   { DEFAULT: "#2c4a7c", light: "#3d5d96" },
        accent:  { DEFAULT: "#1565c0", light: "#1e88e5", dark: "#0d47a1" },

        // ── Gold ─────────────────────────────────────
        gold:    { DEFAULT: "#c8960c", light: "#f5a623", dark: "#a07a07" },

        // ── Semantic ─────────────────────────────────
        success: { DEFAULT: "#2e7d32", light: "#43a047", bg: "#e8f5e9" },
        danger:  { DEFAULT: "#c62828", light: "#e53935", bg: "#ffebee" },
        warning: { DEFAULT: "#e65100", light: "#fb8c00", bg: "#fff3e0" },
        orange:  { DEFAULT: "#e65100", light: "#fb8c00", bg: "#fff3e0" },
        info:    { DEFAULT: "#00695c", light: "#00897b" },

        // ── Extended palette ────────────────────────
        // Colour carries meaning on the platform screens: each state and each
        // entity type has its own hue, so a status is recognised before it is
        // read. Every one is paired with a pale background and a ring so a chip
        // can be tinted without shouting.
        violet:  { DEFAULT: "#6d28d9", light: "#8b5cf6", bg: "#f5f3ff", ring: "#ddd6fe" },
        indigo:  { DEFAULT: "#4338ca", light: "#6366f1", bg: "#eef2ff", ring: "#c7d2fe" },
        teal:    { DEFAULT: "#0f766e", light: "#14b8a6", bg: "#f0fdfa", ring: "#99f6e4" },
        rose:    { DEFAULT: "#be123c", light: "#f43f5e", bg: "#fff1f2", ring: "#fecdd3" },
        amber:   { DEFAULT: "#b45309", light: "#f59e0b", bg: "#fffbeb", ring: "#fde68a" },
        sky:     { DEFAULT: "#0369a1", light: "#0ea5e9", bg: "#f0f9ff", ring: "#bae6fd" },
        emerald: { DEFAULT: "#047857", light: "#10b981", bg: "#ecfdf5", ring: "#a7f3d0" },
        slate:   { DEFAULT: "#475569", light: "#94a3b8", bg: "#f8fafc", ring: "#e2e8f0" },

        // ── Neutral ──────────────────────────────────
        "txt-primary":   "#0f1c35",
        "txt-secondary": "#3a4a6b",
        "txt-muted":     "#6b7ea8",
        "txt-light":     "#8899bb",
        "bg-base":       "#ffffff",
        "bg-soft":       "#f5f7fb",
        "bg-section":    "#eef2f8",
        "bg-light":      "#f8fafd",
        "border":        "#d0d9e8",
        "border-strong": "#b0bdd4",
        "border-light":  "#e2e8f0",
      },
      fontFamily: {
        sans:     ["var(--font-ibm-plex-sans)", "sans-serif"],
        condensed:["var(--font-barlow-condensed)", "sans-serif"],
        mono:     ["var(--font-ibm-plex-mono)", "monospace"],
      },
      boxShadow: {
        sm: "0 1px 2px rgba(15,28,53,.04)",
        md: "0 2px 8px rgba(15,28,53,.06)",
        lg: "0 4px 16px rgba(15,28,53,.10)",
      },
      borderRadius: {
        DEFAULT: "6px",
        xl: "14px",
        "2xl": "18px",
      },
      backgroundImage: {
        "grad-navy":   "linear-gradient(135deg, #0f1c35 0%, #2c4a7c 100%)",
        "grad-gold":   "linear-gradient(135deg, #c8960c 0%, #f5a623 100%)",
        "grad-violet": "linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)",
        "grad-emerald": "linear-gradient(135deg, #047857 0%, #10b981 100%)",
        "grad-sky":    "linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
