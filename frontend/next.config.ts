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

  // ── SECURITY HEADERS, SET BY THE APP RATHER THAN BY nginx ───────────────
  // The obvious home for these is the site's nginx server block, and that is
  // where they were written first. They live here instead because /etc/nginx
  // needs root, the deploy account has no passwordless sudo, and headers that
  // wait for somebody to find a password are headers the scanner keeps
  // reporting. This file deploys with the application.
  //
  // THEY MUST NOT ALSO BE SET IN nginx. Two Content-Security-Policy headers
  // are not merged by the browser -- each is enforced separately and the
  // page gets the intersection, which is a very confusing way to break a
  // screen. The nginx config in deploy/nginx/ is deliberately left with only
  // `server_tokens off`, which is the one finding nothing here can fix.
  //
  // /api/* DOES NOT COME THROUGH HERE in production: the host nginx routes it
  // straight to FastAPI on 8006, bypassing Next's rewrite. The backend sets
  // the same headers in its own middleware, so both halves are covered.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Safe today: port 80 on this name already 301s to HTTPS and the
          // certificate runs to 2027-01-13. includeSubDomains covers
          // *.mines.balasorealloys.in only -- not crm., imos. or the other
          // siblings, which are separate hosts with their own policy.
          // Browsers hold this for two years and ignore attempts to shorten
          // it, so it is the one header here that is hard to take back.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          // SAMEORIGIN rather than the scanner's suggested DENY. The
          // dashboard EMBEDDING windy.com is unaffected either way; whether
          // anything embeds the DASHBOARD -- the D&D portal, an intranet page
          // -- could not be established from here. Tighten to DENY once
          // somebody confirms nothing frames it.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // REPORT-ONLY ON PURPOSE. An enforcing CSP that is one directive
          // short does not degrade, it blanks the screen -- and this is the
          // dashboard the mine runs its morning meeting from.
          //
          // The directives are what the app actually loads. frame-src is for
          // the Weather page's embed.windy.com. There is NO font host,
          // because next/font/google downloads the three faces at build time
          // and serves them from this origin. 'unsafe-inline' and
          // 'unsafe-eval' are what Next.js needs unless the app is reworked
          // to emit a per-request nonce -- a code change, not a header one.
          //
          // Rename this key to Content-Security-Policy once the browser
          // console is quiet on MIS, OEE, Weather, AMIRA, Fuel, EV, Costing
          // and Despatch.
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-src https://embed.windy.com",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },

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
