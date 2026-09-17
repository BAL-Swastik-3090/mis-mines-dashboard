import type { Metadata } from "next";
import "./globals.css";
import Providers   from "./providers";
import AuthWrapper from "@/components/layout/AuthWrapper";

export const metadata: Metadata = {
  title: "Mines Operation Dashboard",
  description: "Balasore Alloys Limited — Kaliapani Chromite Mines Operational Performance Dashboard",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
