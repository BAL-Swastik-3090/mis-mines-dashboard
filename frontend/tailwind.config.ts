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
      },
    },
  },
  plugins: [],
};

export default config;
