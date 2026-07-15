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
      <body className="bg-bg-soft min-h-screen">
        <Providers>
          <AuthWrapper>
            {children}
          </AuthWrapper>
        </Providers>
      </body>
    </html>
  );
}
