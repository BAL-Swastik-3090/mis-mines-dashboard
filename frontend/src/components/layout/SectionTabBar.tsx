"use client";
import { useState } from "react";
import {
  Cloud, Package, Building2, BarChart3,
  Layers, FlaskConical, Wrench, Droplets,
  Target, Sparkles, Download, Check,
} from "lucide-react";
import { useSectionObserver } from "@/hooks/useSectionObserver";
import { useDateFilter }      from "@/contexts/useDateFilter";
import { useSidebar }         from "@/contexts/useSidebar";
import { downloadDashboard }  from "@/utils/downloadDashboard";

const TABS = [
  { id: "weather",        label: "Weather",        icon: Cloud        },
  { id: "stock",          label: "Stock",           icon: Package      },
  { id: "plant",          label: "Plant",           icon: Building2    },
  { id: "production",     label: "Production",      icon: BarChart3    },
  { id: "ob",             label: "OB Excavation",   icon: Layers       },
  { id: "cob",            label: "COB Plant",       icon: FlaskConical },
  { id: "equipment",      label: "Equipment",       icon: Wrench       },
  { id: "dewatering",     label: "Dewatering",      icon: Droplets     },
  { id: "reality-check",  label: "Reality Check",   icon: Target       },
  { id: "insights",       label: "AI Insights",     icon: Sparkles     },
] as const;

const SECTION_IDS = TABS.map((t) => t.id);

// Header (71px) + this tab bar (44px) = 115px total fixed offset
const TOP_OFFSET = 115;

export default function SectionTabBar() {
  const activeId                          = useSectionObserver(SECTION_IDS, TOP_OFFSET);
  const { label: dateRange, periodLabel } = useDateFilter();
  const { collapsed }                     = useSidebar();
  const [downloading, setDownloading] = useState(false);
  const [done, setDone]               = useState(false);

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    setDone(false);
    try {
      await downloadDashboard({ dateRange, periodLabel });
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      style={{ left: collapsed ? "56px" : "200px" }}
      className="fixed top-[71px] right-0 z-20 bg-white border-b border-[#d0d9e8] shadow-sm h-[44px] flex items-stretch transition-[left] duration-300 ease-in-out"
    >

      {/* ── Section tabs — scrollable ─────────────────────── */}
      <nav className="flex flex-1 overflow-x-auto scrollbar-thin min-w-0">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = activeId === id;
          return (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className={`
                relative flex items-center gap-[6px]
                px-4 h-full shrink-0
                font-condensed text-[11px] font-bold tracking-[.1em] uppercase
                transition-colors duration-150
                ${isActive
                  ? "text-[#c8960c]"
                  : "text-[#8899bb] hover:text-[#3a4a6b] hover:bg-[#f8fafd]"
                }
              `}
            >
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#c8960c]" />
              )}
              <Icon size={13} className="shrink-0" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── Download button — always pinned right ────────── */}
      <div className="shrink-0 border-l border-[#d0d9e8] flex items-center px-3">
        <button
          onClick={handleDownload}
          disabled={downloading}
          title="Download MIS Dashboard as HTML"
          className={`
            flex items-center gap-[6px] px-3 py-1.5 rounded
            font-condensed text-[11px] font-bold tracking-[.08em] uppercase
            transition-all duration-150
            ${done
              ? "bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7]"
              : downloading
                ? "bg-[#f5f7fb] text-[#8899bb] border border-[#d0d9e8] cursor-wait"
                : "bg-[#2e7d32] text-white border border-[#2e7d32] hover:bg-[#388e3c] hover:border-[#388e3c] active:scale-95"
            }
          `}
        >
          {done
            ? <><Check size={12} className="shrink-0" /><span>Downloaded</span></>
            : downloading
              ? <><span className="w-3 h-3 border border-[#b0bdd4] border-t-[#6b7ea8] rounded-full animate-spin shrink-0" /><span>Preparing…</span></>
              : <><Download size={12} className="shrink-0" /><span>Export HTML</span></>
          }
        </button>
      </div>

    </div>
  );
}
