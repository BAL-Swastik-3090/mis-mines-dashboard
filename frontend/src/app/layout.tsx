import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import Header from "@/components/layout/Header";

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
          <Header />
          <main className="px-4 sm:px-6 xl:px-8 py-5 max-w-[1920px] mx-auto">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
