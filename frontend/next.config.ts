import type { NextConfig } from "next";

// Disable Next.js anonymous telemetry
process.env.NEXT_TELEMETRY_DISABLED = "1";

// BACKEND_URL is a server-only env var (no NEXT_PUBLIC_ prefix) — it never
// reaches the browser bundle. The Next.js server uses it to proxy /api/* to
// the FastAPI backend. Defaults to localhost:8989 for local development.
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8989";

const nextConfig: NextConfig = {
  // Emit .next/standalone — the Dockerfile's runner stage copies it.
  output: "standalone",
  devIndicators: false,
  // Next.js sends `X-Powered-By: Next.js` on every response, which tells
  // anyone scanning the site which framework to look up advisories for. The
  // host nginx also strips it with proxy_hide_header; this stops it at the
  // source, so it stays gone if the app is ever served some other way.
  poweredByHeader: false,
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
