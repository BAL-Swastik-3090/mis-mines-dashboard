import type { Metadata } from "next";
import { Barlow_Condensed, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

/* ── THE FONTS COME FROM US, NOT FROM GOOGLE ──────────────────────────────
 *
 * They used to be a CSS @import at the top of globals.css, which is the
 * slowest way there is to load a typeface. The browser has to fetch
 * globals.css, parse it, DISCOVER the import, open a connection to
 * fonts.googleapis.com for the stylesheet, and only then open a third to
 * fonts.gstatic.com for the files — three serialised round trips before a
 * single character can be painted, all of it render-blocking, for thirteen
 * files across three families.
 *
 * It also made the mine's dashboard depend on the mine's internet. The
 * weighbridge has a standing reason code for "Internet not working"; on a
 * morning like that this page could not render its own text.
 *
 * next/font downloads them at BUILD time and serves them from this origin, so
 * a user fetches them over the same connection as the page, there is no
 * external dependency at runtime, and the automatic size-adjusted fallback
 * removes the layout shift the old `display=swap` produced.
 *
 * Same three families and the same weights — nothing changes on screen. */
const sans = IBM_Plex_Sans({
  subsets: ["latin"], display: "swap",
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
});
const condensed = Barlow_Condensed({
  subsets: ["latin"], display: "swap",
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-barlow-condensed",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"], display: "swap",
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
});
import Providers   from "./providers";
import AuthWrapper from "@/components/layout/AuthWrapper";

export const metadata: Metadata = {
  title: "Mines Operation Dashboard",
  description: "Balasore Alloys Limited — Kaliapani Chromite Mines Operational Performance Dashboard",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${condensed.variable} ${mono.variable}`}>
      {/* Browser extensions write their own classes and attributes onto <body>
          before React hydrates — ClickUp adds clickup-chrome-ext_installed, and
          password managers do the same. React then reports a mismatch it can do
          nothing about, and that noise hides the mismatches we can fix. The
          suppression applies to this element's own attributes, not to anything
          rendered inside it. */}
      <body className="bg-bg-soft min-h-screen" suppressHydrationWarning>
        <Providers>
          <AuthWrapper>
            {children}
          </AuthWrapper>
        </Providers>
      </body>
    </html>
  );
}
