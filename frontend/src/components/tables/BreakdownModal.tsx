"use client";
import { useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";
import { useBreakdownDetails } from "@/hooks/useEquipment";

interface Props {
  machineName: string;
  sapName: string;
  onClose: () => void;
}

function fmt(dt: string | null): string {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch {
    return dt;
  }
}

export default function BreakdownModal({ machineName, sapName, onClose }: Props) {
  const { data, isLoading } = useBreakdownDetails(sapName);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const events = data?.events ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl border border-border w-full max-w-3xl mx-4 flex flex-col overflow-hidden"
           style={{ maxHeight: "85vh" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-navy border-b border-border shrink-0">
          <div>
            <div className="font-condensed font-bold text-[14px] text-white tracking-widest uppercase">
              Breakdown Events · {machineName}
            </div>
            <div className="text-[10px] text-white/50 font-mono mt-0.5 tracking-wider">
              SAP · {sapName}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors p-1 rounded"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 bg-bg-section animate-pulse rounded" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-txt-muted gap-3">
              <AlertTriangle size={32} className="text-txt-light/40" />
              <p className="text-sm font-mono">No breakdown events recorded for this machine in the selected period.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-bg-section border-b border-border">
                    <th className="px-4 py-2.5 text-left  font-bold text-txt-secondary tracking-wide text-[11px]">#</th>
                    <th className="px-4 py-2.5 text-left  font-bold text-txt-secondary tracking-wide text-[11px]">NOTIF NO.</th>
                    <th className="px-4 py-2.5 text-left  font-bold text-danger        tracking-wide text-[11px]">BREAKDOWN START</th>
                    <th className="px-4 py-2.5 text-left  font-bold text-success       tracking-wide text-[11px]">BREAKDOWN END</th>
                    <th className="px-4 py-2.5 text-right font-bold text-gold          tracking-wide text-[11px]">DURATION (HRS)</th>
                    <th className="px-4 py-2.5 text-left  font-bold text-txt-secondary tracking-wide text-[11px]">REASON</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev, idx) => (
                    <tr key={idx} className="border-b border-border-light hover:bg-bg-light transition-colors">
                      <td className="px-4 py-2.5 font-mono text-txt-muted text-[11px]">{idx + 1}</td>
                      <td className="px-4 py-2.5 font-mono text-navy font-semibold">{ev.notification_no || "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-danger text-[11px]">{fmt(ev.start)}</td>
                      <td className={`px-4 py-2.5 font-mono text-[11px] ${ev.end ? "text-success" : "text-txt-muted italic"}`}>
                        {ev.end ? fmt(ev.end) : "Open / Not closed"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[12px] font-semibold text-gold">
                        {ev.bd_hrs != null ? ev.bd_hrs.toFixed(2) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-txt-secondary text-[11px]">
                        {ev.reason || <span className="text-txt-muted italic">Not specified</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t border-border-light/40 bg-bg-section/40 shrink-0">
          <p className="text-[9px] font-mono text-success/70">
            <span className="font-semibold text-success/60">SOURCE · </span>
            SAP PM · IW29 Notifications · MAINTENANCE_PLANT=1200 · MINEAUTO
          </p>
        </div>
      </div>
    </div>
  );
}
