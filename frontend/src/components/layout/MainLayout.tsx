"use client";
import Sidebar    from "./Sidebar";
import { useSidebar } from "@/contexts/useSidebar";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <>
      <Sidebar />
      <main
        className={`
          min-h-screen pt-[76px] pb-8
          px-4 sm:px-6 xl:px-8
          transition-[margin-left] duration-300 ease-in-out
          ${collapsed ? "ml-[56px]" : "ml-[220px]"}
        `}
      >
        <div className="max-w-[1920px] mx-auto">
          {children}
        </div>
      </main>
    </>
  );
}
