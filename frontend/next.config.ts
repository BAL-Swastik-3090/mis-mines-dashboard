import type { NextConfig } from "next";

// BACKEND_URL is a server-only env var (no NEXT_PUBLIC_ prefix) — it never
// reaches the browser bundle. The Next.js server uses it to proxy /api/* to
// the FastAPI backend. Defaults to localhost:8989 for local development.
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8989";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
