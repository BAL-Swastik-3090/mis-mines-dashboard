"use client";
/**
 * Has yesterday's export been loaded?
 *
 * THE DEADLINE IS WHAT MAKES THE QUESTION ANSWERABLE. "Is the data current"
 * has no answer on its own: at 07:00 yesterday's file is not late, it is
 * simply not in yet, and a badge shouting OVERDUE at that hour teaches people
 * to ignore it — which costs more than the badge was ever worth. The mine's
 * own rule is 09:30, so before that a missing day reads DUE and after it reads
 * OVERDUE, and the badge is worth looking at.
 *
 * It is a button, not a banner. A fleet that is up to date should take one
 * glance and no vertical space; a fleet that is behind should say how far and
 * open to name the machines.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, X } from "lucide-react";
import { useEvFreshness } from "@/hooks/useEvTracking";

interface FreshMachine {
  serial_no: string;
  equipment_type: string;
  model: string | null;
  last_day: string | null;
  days_behind: number | null;
  state: "OK" | "DUE" | "OVERDUE";
}
interface Freshness {
  checked_at: string;
  expected_through: string;
  due_by: string;
  past_due_time: boolean;
  machines: FreshMachine[];
  overdue: number;
  due: number;
  ok: number;
  worst_days_behind: number;
}

const day = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN",
    { day: "2-digit", month: "short", year: "numeric" }) : "never";

export default function EvFreshnessButton() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  /* CLOSED BY A DOCUMENT LISTENER, NOT BY A FULL-SCREEN CATCHER DIV.
     The catcher was `fixed inset-0`, which reads as "the whole viewport" and
     is not: this button sits inside the page's sticky header, and that header
     carries backdrop-blur, which makes it the containing block for every
     fixed descendant. The catcher covered the header bar and nothing else, so
     clicking out on the page below did not close the popover. A listener on
     the document does not care about layout. */
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  /* Cached and refetched on its own five-minute schedule by the hook, which
     also means a tab switch no longer re-asks: the badge was re-fetching from
     scratch every time this button remounted. */
  const { data: f } = useEvFreshness() as { data: Freshness | undefined };

  if (!f) return null;

  const bad = f.overdue > 0;
  const waiting = !bad && f.due > 0;
  const tone = bad
    ? "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100"
    : waiting
      ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
      : "border-green-200 bg-green-50 text-green-800 hover:bg-green-100";
  const Icon = bad ? AlertTriangle : waiting ? Clock : CheckCircle2;

  const label = bad
    ? `${f.overdue} machine${f.overdue === 1 ? "" : "s"} overdue`
    : waiting
      ? `${f.due} awaiting today`
      : "Data up to date";

  return (
    /* ANCHORED TO ITS BUTTON, NOT A FULL-SCREEN MODAL.
       This opened as a dialog over a dimmed page: a black sheet across the
       whole screen plus a drop shadow, which is what the dark band under the
       KPI cards was. That weight belongs to a decision you cannot back out of
       — this is a four-row status list, read in two seconds and dismissed.
       So it hangs off the button like a menu, dims nothing, and the page stays
       readable behind it. */
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={`Expected through ${day(f.expected_through)}, due by ${f.due_by}`}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-condensed font-bold uppercase tracking-widest shadow-sm transition ${tone}`}
      >
        <Icon size={12} />
        {label}
        {bad && f.worst_days_behind > 1 ? (
          <span className="rounded bg-rose-200/70 px-1 py-0.5 text-[10px]">
            {f.worst_days_behind}d
          </span>
        ) : null}
      </button>

      {!open ? null : (
        <>
          <div className="absolute right-0 top-full z-50 mt-2 w-[min(94vw,480px)]
                          overflow-hidden rounded-lg border border-border bg-white
                          shadow-lg ring-1 ring-black/5">
            {/* The deadline, the date and the dismiss on ONE line — three
                stacked blocks of prose for a fact you already know. */}
            <div className="flex items-center gap-2 border-b border-border-light bg-bg-section px-3 py-2">
              <Icon size={13} className={bad ? "text-rose-700" : waiting ? "text-amber-700" : "text-green-700"} />
              <span className="font-condensed text-[11px] font-bold uppercase tracking-widest text-navy">
                Telemetry freshness
              </span>
              <span className="truncate text-[10.5px] text-txt-light">
                {day(f.expected_through)} due {f.due_by}
                {f.past_due_time ? " · passed" : " · not yet"}
              </span>
              <button onClick={() => setOpen(false)}
                      aria-label="Close"
                      className="ml-auto shrink-0 text-txt-light hover:text-navy">
                <X size={14} />
              </button>
            </div>

            {/* One row per machine, one line each: name and type together,
                the date, how far behind, and the state. */}
            <div className="max-h-[46vh] overflow-y-auto divide-y divide-border-light">
              {f.machines.map((m) => (
                <div key={m.serial_no}
                     className="flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-bg-light">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono font-semibold text-navy">{m.serial_no}</span>
                    <span className="ml-1.5 text-[10px] text-txt-light">{m.equipment_type}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-[10.5px] text-txt-light">
                    {day(m.last_day)}
                  </span>
                  <span className={`w-[58px] shrink-0 text-right tabular-nums text-[10.5px] ${
                    m.days_behind ? "text-rose-700" : "text-txt-light/60"}`}>
                    {m.days_behind ? `${m.days_behind}d behind` : "—"}
                  </span>
                  <span className={`w-[76px] shrink-0 rounded px-1.5 py-0.5 text-center text-[9.5px]
                                    font-condensed font-bold uppercase tracking-wider ring-1 ${
                    m.state === "OK" ? "bg-green-50 text-green-700 ring-green-200"
                      : m.state === "DUE" ? "bg-amber-50 text-amber-800 ring-amber-200"
                      : "bg-rose-50 text-rose-800 ring-rose-200"}`}>
                    {m.state === "OK" ? "up to date" : m.state === "DUE" ? "awaiting" : "overdue"}
                  </span>
                </div>
              ))}
            </div>

            <p className="border-t border-border-light px-3 py-1.5 text-[10px] leading-snug text-txt-light">
              Overdue means nobody uploaded the export, not that the machine stood
              idle — an idle day still arrives as a row of zeros. Clocked at the mine.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
