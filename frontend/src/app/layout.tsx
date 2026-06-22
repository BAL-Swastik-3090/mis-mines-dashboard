import type { Metadata } from "next";
import "./globals.css";
import Providers   from "./providers";
import Header      from "@/components/layout/Header";
import MainLayout  from "@/components/layout/MainLayout";

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
          <MainLayout>
            {children}
          </MainLayout>
        </Providers>
      </body>
    </html>
  );
}
