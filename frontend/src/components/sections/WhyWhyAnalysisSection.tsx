"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import {
  Wrench, AlertTriangle, Clock, Repeat, Users, Database,
  Sparkles, RefreshCw, Info, ChevronRight, GraduationCap, Layers, TrendingDown,
} from "lucide-react";
import { useWhyWhy, useWhyWhyNarrative, useWhyWhyTraining } from "@/hooks/useInsights";
import { formatIndian } from "@/lib/utils";
import type {
  WhyWhyShare, WhyWhyWatch, WhyWhyMachineDetail, WhyWhyOperatorIssues,
  WhyWhyProductionLoss, WhyWhyLossSlice,
} from "@/types";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

/**
 * Why-Why Analysis — breakdown root causes, read from the MPICC register.
 *
 * Two data sources, deliberately kept apart. The charts and tables come from
 * /insights/why-why, which is pure SQL and always answers. The prose comes from
 * /insights/why-why/narrative, which asks BAL-AI to interpret those same
 * figures and takes ~9 seconds. The narrative is therefore opt-in and its
 * failure is contained: a gateway outage costs one card, not the section.
 *
 * The model is never given the underlying rows and is never asked to count
 * anything, so a number it states should already appear in the figures it was
 * handed. The backend checks that and returns anything it cannot account for,
 * which is surfaced here rather than quietly trusted.
 */

const CHART_FONT = { fontSize: 11, color: "#6b7ea8", fontFamily: "IBM Plex Sans" };

// Root causes read better with fixed colours than with a rotating palette —
// "Operator Error" should not change colour when a month has none of it.
const CAUSE_COLOURS: Record<string, string> = {
  "Ageing":              "#5e7fb8",
  "Operator Error":      "#e65100",
  "Tyre / Haul Road":    "#c8960c",
  "Diesel & Electrical": "#5e35b1",
  "Electrical":          "#00897b",
};
const FALLBACK = "#8fa3c4";

/** Rupees at mine scale — crore past a crore, lakh below it. A bare Indian
 *  grouping of 47,74,21,308 is unreadable at a glance in a KPI. */
function inrCr(v: number | null | undefined): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${formatIndian(v)}`;
}

function num(v: number | null | undefined, dec = 0): string {
  if (v == null) return "—";
  return dec > 0 ? v.toFixed(dec) : formatIndian(v);
}

// ── shell ────────────────────────────────────────────────────
function Card({
  icon, title, note, children, className = "",
}: {
  icon: React.ReactNode; title: string; note?: string;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-white border border-border rounded-lg shadow-sm overflow-hidden ${className}`}>
      <div className="px-4 pt-3 pb-2 border-b border-border-light flex items-center gap-2">
        {icon}
        <span className="font-condensed font-bold text-[12px] tracking-widest uppercase text-txt-secondary">
          {title}
        </span>
        {note ? <span className="ml-auto text-[11px] text-txt-muted">{note}</span> : null}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-3 py-2.5">
      <div className="text-[10.5px] font-condensed uppercase tracking-widest text-txt-muted">{label}</div>
      <div className="mt-0.5 font-mono font-bold text-[19px] text-navy leading-none">{value}</div>
      {sub ? <div className="mt-1 text-[11px] text-txt-muted leading-tight">{sub}</div> : null}
    </div>
  );
}

// ── prose ────────────────────────────────────────────────────
function Prose({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="space-y-2.5">
      {text.split("\n").filter((l) => l.trim()).map((line, i) => (
        <p key={i} className="text-[12.5px] leading-relaxed text-txt-secondary">
          {line.trim()}
        </p>
      ))}
    </div>
  );
}

/** Actions arrive pipe-delimited as "what | owner | trigger" — see the prompt. */
function ActionTable({ text }: { text: string }) {
  const rows = text.split("\n").map((l) => l.trim()).filter((l) => l.includes("|"))
    .map((l) => l.split("|").map((c) => c.trim()));
  if (!rows.length) return <Prose text={text} />;
  return (
    <div className="divide-y divide-border-light">
      {rows.map((c, i) => (
        <div key={i} className="py-2.5 first:pt-0 last:pb-0">
          <div className="flex items-start gap-2">
            <ChevronRight size={14} className="mt-[3px] shrink-0 text-accent" />
            <span className="text-[12.5px] text-txt-primary leading-snug">{c[0]}</span>
          </div>
          <div className="mt-1 pl-[22px] flex flex-wrap gap-x-4 gap-y-1">
            {c[1] ? (
              <span className="text-[11px] text-txt-muted">
                <b className="font-semibold text-txt-secondary">Owner</b> {c[1]}
              </span>
            ) : null}
            {c[2] ? (
              <span className="text-[11px] text-txt-muted">
                <b className="font-semibold text-txt-secondary">Trigger</b> {c[2]}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── bars ─────────────────────────────────────────────────────
function ShareBars({ rows, colours }: { rows: WhyWhyShare[]; colours?: boolean }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] text-txt-secondary truncate">{r.label}</span>
            <span className="font-mono text-[12px] text-navy shrink-0">
              {r.count}
              <span className="ml-1.5 text-[11px] text-txt-muted">{num(r.pct ?? null, 1)}%</span>
            </span>
          </div>
          <div className="mt-1 h-[6px] rounded-full bg-bg-subtle overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(r.count / max) * 100}%`,
                background: colours ? (CAUSE_COLOURS[r.label] ?? FALLBACK) : "#5e7fb8",
              }}
            />
          </div>
          {r.cost_per_event != null ? (
            <div className="mt-0.5 text-[10.5px] text-txt-muted">
              ₹{formatIndian(r.cost_per_event)} per event · {num(r.hours ?? null, 1)} hrs
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

const WATCH_STYLE: Record<WhyWhyWatch["state"], { cls: string; label: (w: WhyWhyWatch) => string }> = {
  due:   { cls: "bg-danger/10 text-danger border-danger/25",
           label: (w) => (w.due_in_days <= 0 ? `Overdue ${Math.abs(w.due_in_days)}d` : "Due now") },
  soon:  { cls: "bg-accent/10 text-[#c8960c] border-accent/25", label: (w) => `In ${w.due_in_days}d` },
  watch: { cls: "bg-navy/5 text-navy border-navy/15",           label: (w) => `In ${w.due_in_days}d` },
  held:  { cls: "bg-success/10 text-success border-success/25", label: () => "Appears held" },
};

// -- production loss ------------------------------------------
/**
 * What breakdowns cost in ore never mined, split by what broke.
 *
 * The rupee total is the LCM section's own figure, not a second calculation.
 * Ore loss is scoped to the machines LCM prices it against and split within
 * them by each failure's share of Why-Why breakdown hours, so the parts always
 * foot to the whole whichever hour basis turns out to be authoritative.
 */
function LossSplit({ rows, title }: { rows: WhyWhyLossSlice[]; title: string }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.amount), 1);
  return (
    <div>
      <div className="mb-1.5 font-condensed text-[10.5px] font-bold uppercase tracking-widest text-txt-muted">
        {title}
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[12px] text-txt-secondary">
                {r.label}
                <span className="ml-1.5 text-[10.5px] text-txt-muted">{r.events} ev</span>
              </span>
              <span className="shrink-0 font-mono text-[12px] text-navy">
                {inrCr(r.amount)}
                <span className="ml-1.5 text-[11px] text-txt-muted">{r.share_pct}%</span>
              </span>
            </div>
            <div className="mt-1 h-[6px] overflow-hidden rounded-full bg-bg-subtle">
              <div className="h-full rounded-full bg-[#b3261e]"
                   style={{ width: `${(r.amount / max) * 100}%` }} />
            </div>
            {r.tonnes != null ? (
              <div className="mt-0.5 text-[10.5px] text-txt-muted">
                {formatIndian(r.tonnes)} MT of ore not mined
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductionLoss({ d }: { d: WhyWhyProductionLoss }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[26px] font-bold leading-none text-[#b3261e]">
            {inrCr(d.amount)}
          </span>
          <span className="text-[12.5px] text-txt-secondary">of ore never mined</span>
          {d.times_repair_cost ? (
            <span className="ml-auto rounded border border-danger/25 bg-white px-2 py-[3px] text-[12px] font-bold text-[#b3261e]">
              {formatIndian(d.times_repair_cost)}× the repair bill
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-txt-secondary">
          {d.tonnes != null ? <>{formatIndian(d.tonnes)} MT at ₹{formatIndian(d.rate_per_mt ?? 0)}/MT</> : null}
          {d.loss_hours != null ? <> · {d.loss_hours} ore-loss hours</> : null}
          {d.share_of_all_loss_pct != null ? (
            <> · <b>{d.share_of_all_loss_pct}%</b> of every rupee the mine loses to any cause</>
          ) : null}
          {d.loss_type ? <> · {d.loss_type}</> : null}
        </p>
        <p className="mt-1 text-[11px] text-txt-muted">
          Repair cost over the same period was ₹{formatIndian(d.repair_cost)}.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <LossSplit rows={d.allocation.by_machine} title="By machine" />
        <LossSplit rows={d.allocation.by_mode} title="By failure mode" />
        <LossSplit rows={d.allocation.by_cause} title="By root cause" />
      </div>

      <p className="border-t border-border-light pt-2 text-[11px] leading-relaxed text-txt-muted">
        {d.basis} Ore loss sits with {d.ore_machines.join(" and ")} ({d.ore_machine_events} breakdowns
        in the register){d.rate_source ? <> · rate: {d.rate_source}</> : null}.
      </p>
    </div>
  );
}

// ── equipment-wise Pareto + RCA ──────────────────────────────
/**
 * One machine per block: its own failure Pareto beside its own cause split.
 *
 * The fleet Pareto says tyres are the biggest failure mode. It does not say
 * that tyres are almost entirely a tipper problem while the excavators fail
 * hydraulically — and a maintenance plan is written per machine, so the
 * aggregate hides the thing the plan needs.
 */
function MachineDetail({ rows }: { rows: WhyWhyMachineDetail[] }) {
  const [open, setOpen] = useState<string | null>(rows[0]?.machine ?? null);
  return (
    <div className="divide-y divide-border-light">
      {rows.map((m) => {
        const isOpen = open === m.machine;
        return (
          <div key={m.machine} className="py-2 first:pt-0 last:pb-0">
            <button
              onClick={() => setOpen(isOpen ? null : m.machine)}
              className="flex w-full items-center gap-2 text-left"
            >
              <ChevronRight
                size={14}
                className={`shrink-0 text-txt-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
              />
              <span className="font-mono text-[12.5px] font-bold text-navy w-[72px] shrink-0">
                {m.machine}
              </span>
              <span className="font-mono text-[12px] text-txt-secondary shrink-0">
                {m.breakdowns}
              </span>
              <span className="text-[11px] text-txt-muted shrink-0">breakdowns</span>
              {/* Concentration is the actionable bit: two modes covering 80% is a
                  pattern you can fix, eight is scatter you can only monitor. */}
              <span
                className={`ml-auto shrink-0 rounded border px-1.5 py-[1px] text-[10.5px] font-semibold ${
                  m.concentrated
                    ? "border-success/25 bg-success/10 text-success"
                    : "border-border bg-bg-subtle text-txt-muted"
                }`}
              >
                {m.concentrated
                  ? `${m.modes_to_80pct} mode${m.modes_to_80pct > 1 ? "s" : ""} = 80%`
                  : `spread over ${m.modes_to_80pct}`}
              </span>
              <span className="font-mono text-[11px] text-txt-muted w-[70px] text-right shrink-0">
                {num(m.hours, 1)} h
              </span>
            </button>

            {isOpen && (
              <div className="mt-2.5 grid gap-4 pl-[30px] md:grid-cols-2">
                <div>
                  <div className="mb-1.5 font-condensed text-[10.5px] font-bold uppercase tracking-widest text-txt-muted">
                    Failure mode
                  </div>
                  <ShareBars rows={m.modes.slice(0, 5)} />
                </div>
                <div>
                  <div className="mb-1.5 font-condensed text-[10.5px] font-bold uppercase tracking-widest text-txt-muted">
                    Root cause
                    <span className="ml-1.5 font-sans font-normal normal-case tracking-normal">
                      ({m.causes_recorded} of {m.breakdowns} recorded)
                    </span>
                  </div>
                  {m.causes.length ? (
                    <ShareBars rows={m.causes} colours />
                  ) : (
                    <p className="text-[11.5px] text-txt-muted">No cause recorded on this machine.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── operator issues + training ───────────────────────────────
/** Topics arrive as TOPIC/WHY/COVER/CHECK lines — see TRAINING_SECTIONS. */
function TrainingTopics({ text }: { text: string }) {
  const blocks = text
    .split(/(?=TOPIC:)/)
    .map((b) => b.trim())
    .filter((b) => b.startsWith("TOPIC:"));
  if (!blocks.length) return <Prose text={text} />;

  const field = (b: string, key: string) => {
    const m = b.match(new RegExp(`${key}:\\s*(.+?)(?=\\n[A-Z]{3,}:|$)`, "s"));
    return m ? m[1].trim() : "";
  };

  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        const cover = field(b, "COVER").split(";").map((x) => x.trim()).filter(Boolean);
        return (
          <div key={i} className="rounded-lg border border-border bg-bg-subtle/40 px-3.5 py-3">
            <div className="flex items-start gap-2">
              <span className="mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded bg-navy text-[10.5px] font-bold text-white">
                {i + 1}
              </span>
              <h4 className="text-[13px] font-bold leading-snug text-txt-primary">
                {field(b, "TOPIC")}
              </h4>
            </div>
            {field(b, "WHY") ? (
              <p className="mt-1.5 pl-[26px] text-[11.5px] leading-relaxed text-txt-muted">
                {field(b, "WHY")}
              </p>
            ) : null}
            {cover.length ? (
              <ul className="mt-2 space-y-1 pl-[26px]">
                {cover.map((c, j) => (
                  <li key={j} className="flex gap-1.5 text-[12px] leading-snug text-txt-secondary">
                    <span className="text-accent">•</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {field(b, "CHECK") ? (
              <p className="mt-2 pl-[26px] text-[11px] text-txt-muted">
                <b className="font-semibold text-txt-secondary">Check</b> {field(b, "CHECK")}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function OperatorIssues({ data }: { data: WhyWhyOperatorIssues }) {
  const [showAll, setShowAll] = useState(false);
  const [wantTraining, setWantTraining] = useState(false);
  const tr = useWhyWhyTraining(wantTraining);
  const shown = showAll ? data.issues : data.issues.slice(0, 6);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <Stat label="Events" value={num(data.events)} sub="cause = operating error" />
        <Stat label="Downtime" value={`${num(data.hours, 1)} h`} />
        <Stat label="Repair cost" value={`₹${formatIndian(data.cost)}`} />
        <Stat label="With Why-chain" value={num(data.with_why_chain)} sub={`of ${data.events}`} />
      </div>

      <div>
        <div className="mb-1.5 font-condensed text-[10.5px] font-bold uppercase tracking-widest text-txt-muted">
          What breaks
        </div>
        <ShareBars rows={data.by_family.slice(0, 6)} />
      </div>

      <div>
        <div className="mb-1.5 font-condensed text-[10.5px] font-bold uppercase tracking-widest text-txt-muted">
          Problem statements
          <span className="ml-1.5 font-sans font-normal normal-case tracking-normal">
            most expensive first
          </span>
        </div>
        <div className="divide-y divide-border-light">
          {shown.map((i, k) => (
            <div key={k} className="py-2.5 first:pt-0">
              <div className="flex items-start gap-2">
                <span className="text-[12.5px] font-semibold leading-snug text-txt-primary">
                  {i.problem_statement}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11.5px] text-navy">
                  ₹{formatIndian(i.cost)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-txt-muted">
                <span>{i.family}</span>
                <span>{num(i.hours, 1)} h</span>
                {i.sub_category ? <span>{i.sub_category}</span> : null}
                {/* Shown because it is recorded, labelled so it is not read as blame. */}
                {i.operator ? <span>Operator on record: {i.operator}</span> : null}
              </div>
              {i.why_chain.length ? (
                <ol className="mt-1.5 space-y-[3px] border-l-2 border-accent/25 pl-2.5">
                  {i.why_chain.map((c, j) => (
                    <li key={j} className="text-[11.5px] leading-snug text-txt-secondary">
                      <b className="text-txt-muted">Why {j + 1}</b> {c}
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ))}
        </div>
        {data.issues.length > 6 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="mt-2 text-[11.5px] font-semibold text-navy hover:underline"
          >
            {showAll ? "Show fewer" : `Show all ${data.issues.length}`}
          </button>
        )}
      </div>

      {/* ── training ── */}
      <div className="rounded-lg border border-accent/25 bg-accent/5 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <GraduationCap size={15} className="text-[#c8960c]" />
          <span className="font-condensed text-[11.5px] font-bold uppercase tracking-widest text-txt-secondary">
            Training topics
          </span>
          {tr.data?.model ? (
            <span className="ml-auto text-[10.5px] text-txt-muted">
              {tr.data.model} · {tr.data.generated_at}
            </span>
          ) : null}
        </div>

        {!wantTraining ? (
          <div className="flex flex-col items-start gap-2 pt-2">
            <p className="text-[12px] leading-relaxed text-txt-muted">
              BAL-AI reads the {data.events} problem statements above and returns a
              toolbox plan — what to teach, why the data calls for it, and how a
              supervisor checks it stuck. It is told to train the fleet and never
              to name or rank an operator.
            </p>
            <button
              onClick={() => setWantTraining(true)}
              className="flex items-center gap-1.5 rounded-md bg-navy px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-navy/90"
            >
              <GraduationCap size={13} /> Suggest training topics
            </button>
          </div>
        ) : tr.isLoading ? (
          <div className="flex items-center gap-2 py-5 text-[12.5px] text-txt-muted">
            <RefreshCw size={14} className="animate-spin" /> Reading the incidents…
          </div>
        ) : tr.isError ? (
          <div className="flex items-start gap-2 py-3">
            <AlertTriangle size={14} className="mt-[2px] shrink-0 text-danger" />
            <div>
              <p className="text-[12px] text-txt-secondary">
                {(tr.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
                  ?? "Could not reach the BAL-AI gateway."}
              </p>
              <button
                onClick={() => tr.refetch()}
                className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-navy hover:underline"
              >
                <RefreshCw size={12} /> Try again
              </button>
            </div>
          </div>
        ) : tr.data?.error ? (
          <p className="py-3 text-[12px] text-txt-muted">{tr.data.error}</p>
        ) : tr.data ? (
          <div className="space-y-3 pt-2.5">
            {tr.data.unverified_numbers?.length > 0 && (
              <div className="flex items-start gap-2 rounded border border-danger/25 bg-danger/5 px-3 py-2">
                <AlertTriangle size={13} className="mt-[2px] shrink-0 text-danger" />
                <p className="text-[11.5px] leading-snug text-txt-secondary">
                  <b>Check before quoting.</b> Not in the data given:{" "}
                  <span className="font-mono">{tr.data.unverified_numbers.join(", ")}</span>.
                </p>
              </div>
            )}
            {tr.data.sections.topics ? <TrainingTopics text={tr.data.sections.topics} /> : null}
            {tr.data.sections.priority ? (
              <div className="rounded border border-border bg-white px-3 py-2">
                <div className="mb-1 font-condensed text-[10.5px] font-bold uppercase tracking-widest text-txt-muted">
                  Run this one first
                </div>
                <Prose text={tr.data.sections.priority} />
              </div>
            ) : null}
            <button
              onClick={() => tr.refetch()}
              className="flex items-center gap-1.5 text-[11.5px] text-txt-muted hover:text-navy"
            >
              <RefreshCw size={12} /> Regenerate
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// -- loading ---------------------------------------------------------------
/** First load: the shape of what is coming, so the page does not jump. */
function SectionSkeleton() {
  return (
    <div className="space-y-4">
      <Card icon={<Wrench size={15} className="text-accent" />} title="Why-Why Analysis">
        <div className="grid grid-cols-2 gap-px md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-3 py-2.5">
              <div className="h-[9px] w-16 animate-pulse rounded bg-bg-subtle" />
              <div className="mt-2 h-[18px] w-20 animate-pulse rounded bg-bg-subtle" />
              <div className="mt-2 h-[9px] w-24 animate-pulse rounded bg-bg-subtle" />
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((k) => (
          <div key={k} className="rounded-lg border border-border bg-white p-4 shadow-sm">
            <div className="h-[10px] w-28 animate-pulse rounded bg-bg-subtle" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i}>
                  <div className="h-[9px] w-40 animate-pulse rounded bg-bg-subtle" />
                  <div className="mt-1.5 h-[6px] animate-pulse rounded-full bg-bg-subtle"
                       style={{ width: `${90 - i * 15}%` }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Refetch veil — shown while a new date range loads over the old figures.
 *
 * react-query keeps the previous data on screen during a refetch, which stops
 * the page collapsing but also means the numbers sit there looking current
 * when they belong to the range you just navigated away from. The veil says
 * plainly that they are stale, without throwing the layout away and rebuilding
 * it, which on a section this tall is worse than waiting.
 */
function RefetchVeil() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center
                    rounded-lg bg-white/65 backdrop-blur-[1px]">
      <span className="mt-16 flex items-center gap-2 rounded-full border border-border
                       bg-white px-3.5 py-1.5 shadow-sm">
        <RefreshCw size={13} className="animate-spin text-accent" />
        <span className="text-[12px] font-semibold text-txt-secondary">
          Loading the selected dates…
        </span>
      </span>
    </div>
  );
}

// ── section ──────────────────────────────────────────────────
export default function WhyWhyAnalysisSection() {
  const { data, isLoading, isFetching } = useWhyWhy();
  const [wantNarrative, setWantNarrative] = useState(false);
  const nar = useWhyWhyNarrative(wantNarrative);

  if (isLoading && !data) return <SectionSkeleton />;

  const h = data?.headline;
  const w = data?.window;
  if (!data || !h || !w || w.empty || h.breakdowns === 0) {
    // Empty is an answer, not a failure — but it has to say which period was
    // asked for and which period the register actually holds, or it reads as
    // a broken section.
    return (
      <div className="relative">
        {isFetching ? <RefetchVeil /> : null}
      <Card icon={<Wrench size={15} className="text-accent" />} title="Why-Why Analysis">
        <div className="py-7 text-center">
          <p className="text-[12.5px] text-txt-secondary">
            No Why-Why analyses recorded for the selected dates
            {w?.requested_from && w?.requested_to
              ? <> (<b>{w.requested_from}</b> to <b>{w.requested_to}</b>)</>
              : null}.
          </p>
          {w?.extent_from && w?.extent_to ? (
            <p className="mt-1.5 text-[11.5px] text-txt-muted">
              The register currently runs {w.extent_from} to {w.extent_to}.
              Change the date filter to see it.
            </p>
          ) : null}
        </div>
      </Card>
      </div>
    );
  }

  const hourMax = Math.max(...(data.timing?.by_hour ?? []).map((x) => x.count), 1);

  return (
    // `relative` so the refetch veil can cover the whole section rather than
    // one card — a date change invalidates every figure below, not just some.
    <div className="relative space-y-4">
      {isFetching ? <RefetchVeil /> : null}
      {/* Which period is actually on screen. The register covers a fixed span,
          so a filter outside it shows the whole extent rather than nothing —
          said plainly instead of leaving the reader to wonder. */}
      {w.clamped && (
        <div className="flex items-start gap-2 rounded-lg border border-accent/25 bg-accent/5 px-3.5 py-2.5">
          <Info size={14} className="mt-[2px] shrink-0 text-[#c8960c]" />
          <p className="text-[12px] leading-snug text-txt-secondary">
            Your date filter runs past the Why-Why register, which holds{" "}
            <b>{w.extent_from} to {w.extent_to}</b>. Showing the overlap,{" "}
            <b>{w.from} to {w.to}</b>.
          </p>
        </div>
      )}

      {/* ── headline ── */}
      <Card
        icon={<Wrench size={15} className="text-accent" />}
        title="Why-Why Analysis"
        note={`${w.from} to ${w.to}`}
      >
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 divide-x divide-y xl:divide-y-0 divide-border-light -mx-1">
          <Stat label="Breakdowns" value={num(h.breakdowns)} sub={`${h.machines} machines`} />
          <Stat label="Downtime" value={`${num(h.breakdown_hours, 1)} h`}
                sub={h.avg_hours ? `${num(h.avg_hours, 2)} h average` : undefined} />
          <Stat label="Operating hrs" value={h.operating_hours ? num(h.operating_hours, 1) : "—"}
                sub="from GPS telematics" />
          <Stat label="Repair cost" value={`₹${formatIndian(h.repair_cost)}`}
                sub={`on ${h.repair_cost_rows} of ${h.breakdowns}`} />
          <Stat label="Repeat failures" value={`${num(h.repeat_pct, 1)}%`}
                sub={`${h.repeat_events} events, same machine & fault`} />
          <Stat label="Cause recorded" value={`${num(h.cause_recorded_pct, 1)}%`}
                sub={data.root_causes ? `${data.root_causes.missing} without` : undefined} />
        </div>
      </Card>

      {/* ── production loss — the number the section exists to surface ── */}
      {data.production_loss && (
        <Card icon={<TrendingDown size={15} className="text-[#b3261e]" />}
              title="What breakdowns cost in lost ore"
              note="valued by the LCM section">
          <ProductionLoss d={data.production_loss} />
        </Card>
      )}

      {/* ── cause + failure mode ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card icon={<AlertTriangle size={15} className="text-[#e65100]" />} title="Root cause"
              note={data.root_causes ? `${data.root_causes.recorded} recorded` : undefined}>
          {data.root_causes ? <ShareBars rows={data.root_causes.categories} colours /> : null}
        </Card>

        <Card icon={<Wrench size={15} className="text-[#5e7fb8]" />} title="Failure mode"
              note={data.failure_modes
                ? `${data.failure_modes.families_to_80pct} families cover 80%` : undefined}>
          {data.failure_modes ? <ShareBars rows={data.failure_modes.families.slice(0, 7)} /> : null}
        </Card>
      </div>

      {/* ── machines ── */}
      <Card icon={<Wrench size={15} className="text-navy" />} title="Machines by failure rate"
            note="breakdowns per 100 operating hours">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-txt-muted border-b border-border-light">
                <th className="py-1.5 text-left font-semibold">Machine</th>
                <th className="py-1.5 text-right font-semibold">Breakdowns</th>
                <th className="py-1.5 text-right font-semibold">Per 100 hrs</th>
                <th className="py-1.5 text-right font-semibold">Operating hrs</th>
                <th className="py-1.5 text-right font-semibold">Downtime</th>
                <th className="py-1.5 text-left font-semibold pl-4">Mostly</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light">
              {data.machines.map((m) => (
                <tr key={m.machine}>
                  <td className="py-1.5 font-mono text-navy whitespace-nowrap">{m.machine}</td>
                  <td className="py-1.5 text-right font-mono">{m.breakdowns}</td>
                  {/* A dash means the machine ran too few hours to rate, not zero. */}
                  <td className="py-1.5 text-right font-mono font-bold text-navy">
                    {m.per_100_hours == null
                      ? <span className="text-txt-muted font-normal" title="Too few operating hours to rate">—</span>
                      : m.per_100_hours.toFixed(2)}
                  </td>
                  <td className="py-1.5 text-right font-mono text-txt-muted">
                    {m.operating_hours == null ? "—" : num(m.operating_hours, 1)}
                  </td>
                  <td className="py-1.5 text-right font-mono text-txt-muted">{num(m.hours, 1)} h</td>
                  <td className="py-1.5 pl-4 text-txt-secondary">{m.top_failure}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── trend + timing ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card icon={<Clock size={15} className="text-[#5e35b1]" />} title="Monthly trend">
          <ReactECharts
            style={{ height: 210 }}
            option={{
              backgroundColor: "transparent",
              grid: { top: 30, right: 14, bottom: 24, left: 8, containLabel: true },
              legend: { data: ["Breakdowns", "Downtime hrs"], top: 0, textStyle: CHART_FONT },
              tooltip: { trigger: "axis" },
              xAxis: { type: "category", data: data.months.map((m) => m.month),
                       axisLabel: CHART_FONT, axisLine: { lineStyle: { color: "#dde3ee" } } },
              yAxis: [
                { type: "value", axisLabel: CHART_FONT, splitLine: { lineStyle: { color: "#eef1f7" } } },
                { type: "value", axisLabel: CHART_FONT, splitLine: { show: false } },
              ],
              series: [
                { name: "Breakdowns", type: "bar", data: data.months.map((m) => m.breakdowns),
                  itemStyle: { color: "#5e7fb8", borderRadius: [3, 3, 0, 0] }, barMaxWidth: 34 },
                { name: "Downtime hrs", type: "line", yAxisIndex: 1, smooth: true,
                  data: data.months.map((m) => m.hours),
                  itemStyle: { color: "#e65100" }, lineStyle: { width: 2 } },
              ],
            }}
          />
        </Card>

        <Card icon={<Clock size={15} className="text-[#00897b]" />} title="When breakdowns are reported"
              note={data.timing ? `peaks ${data.timing.peak_hours.map((x) => `${x}:00`).join(", ")}` : undefined}>
          <div className="flex items-end gap-[3px] h-[120px]">
            {(data.timing?.by_hour ?? []).map((x) => (
              <div key={x.hour} className="flex-1 flex flex-col items-center justify-end h-full"
                   title={`${x.hour}:00 — ${x.count} breakdowns`}>
                <div
                  className={`w-full rounded-t ${
                    data.timing?.peak_hours.includes(x.hour) ? "bg-[#e65100]" : "bg-[#9db4d8]"}`}
                  style={{ height: `${(x.count / hourMax) * 100}%`, minHeight: x.count ? 2 : 0 }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-txt-muted">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
          </div>
          <div className="mt-3 flex gap-4 border-t border-border-light pt-2">
            {(data.timing?.by_shift ?? []).map((s) => (
              <span key={s.label} className="text-[11.5px] text-txt-muted">
                Shift <b className="text-txt-secondary">{s.label}</b>{" "}
                <span className="font-mono text-navy">{s.count}</span> ({num(s.pct, 1)}%)
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* ── repeats + watchlist ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card icon={<Repeat size={15} className="text-[#e65100]" />} title="Recurring defects"
              note="same machine, same fault">
          <div className="divide-y divide-border-light">
            {data.repeats.map((r, i) => (
              <div key={i} className="flex items-baseline gap-2 py-1.5 first:pt-0 last:pb-0">
                <span className="font-mono text-[12px] text-navy w-[68px] shrink-0">{r.machine}</span>
                <span className="text-[12px] text-txt-secondary truncate flex-1">{r.defect}</span>
                <span className="font-mono text-[12px] font-bold text-[#e65100] shrink-0">×{r.count}</span>
                <span className="font-mono text-[11px] text-txt-muted w-[62px] text-right shrink-0">
                  {num(r.hours, 1)} h
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card icon={<AlertTriangle size={15} className="text-danger" />} title="Pattern projection"
              note="a cadence, not a prediction">
          <div className="divide-y divide-border-light">
            {data.watchlist.map((x, i) => {
              const st = WATCH_STYLE[x.state];
              return (
                <div key={i} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                  <span className="font-mono text-[12px] text-navy w-[68px] shrink-0">{x.machine}</span>
                  <span className="text-[12px] text-txt-secondary truncate flex-1">{x.defect}</span>
                  <span className="font-mono text-[10.5px] text-txt-muted shrink-0">
                    {x.events}× · {x.mean_gap_days}d ±{x.sd_days}
                  </span>
                  <span className={`shrink-0 rounded border px-1.5 py-[1px] text-[10.5px] font-semibold ${st.cls}`}>
                    {st.label(x)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2.5 border-t border-border-light pt-2 text-[11px] leading-snug text-txt-muted">
            Projected from the mean interval between past occurrences. A wide ± is
            weak evidence; a pattern silent for over twice its mean gap reads as held.
          </p>
        </Card>
      </div>

      {/* ── equipment-wise Pareto + RCA ── */}
      {data.machine_detail?.length > 0 && (
        <Card icon={<Layers size={15} className="text-navy" />}
              title="Equipment-wise failure mode & root cause"
              note="machines with 4+ breakdowns">
          <MachineDetail rows={data.machine_detail} />
        </Card>
      )}

      {/* ── operators ── */}
      {data.operators && data.operators.named_events > 0 && (
        <Card icon={<Users size={15} className="text-[#5e35b1]" />} title="Operators named on the record"
              note={`${data.operators.named_events} of ${h.breakdowns} events`}>
          <div className="flex flex-wrap gap-1.5">
            {data.operators.top.map((o) => (
              <span key={o.operator}
                    className="rounded border border-border bg-bg-subtle px-2 py-1 text-[11.5px] text-txt-secondary"
                    title={`${o.machines.join(", ")} · ₹${formatIndian(o.cost)}`}>
                {o.operator}
                <span className="ml-1.5 font-mono font-bold text-navy">{o.events}</span>
              </span>
            ))}
          </div>
          {/* Shipped by the backend as data, not written here, so it cannot be
              dropped by a later edit to this file. */}
          <p className="mt-3 border-t border-border-light pt-2 text-[11px] leading-relaxed text-txt-muted">
            {data.operators.caveat}
          </p>
        </Card>
      )}

      {/* ── operating-error problem statements + training ── */}
      {data.operator_issues && data.operator_issues.events > 0 && (
        <Card icon={<GraduationCap size={15} className="text-[#c8960c]" />}
              title="Operating issues & training"
              note={`${data.operator_issues.events} breakdowns with cause = operating error`}>
          <OperatorIssues data={data.operator_issues} />
        </Card>
      )}

      {/* ── narrative ── */}
      <Card
        icon={<Sparkles size={15} className="text-[#c8960c]" />}
        title="AI reading of these figures"
        note={nar.data?.model ? `${nar.data.model} · ${nar.data.generated_at}` : undefined}
      >
        {!wantNarrative ? (
          <div className="flex flex-col items-center gap-2.5 py-5">
            <p className="max-w-lg text-center text-[12px] leading-relaxed text-txt-muted">
              BAL-AI reads the figures above — never the underlying records — and
              returns findings, risks and actions. Takes about ten seconds.
            </p>
            <button
              onClick={() => setWantNarrative(true)}
              className="flex items-center gap-1.5 rounded-md bg-navy px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-navy/90"
            >
              <Sparkles size={13} /> Generate analysis
            </button>
          </div>
        ) : nar.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[12.5px] text-txt-muted">
            <RefreshCw size={14} className="animate-spin" /> Reading the figures…
          </div>
        ) : nar.isError ? (
          <div className="flex items-start gap-2 py-4">
            <AlertTriangle size={15} className="mt-[2px] shrink-0 text-danger" />
            <div>
              <p className="text-[12.5px] text-txt-secondary">
                {(nar.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
                  ?? "Could not reach the BAL-AI gateway."}
              </p>
              <button onClick={() => nar.refetch()}
                      className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-navy hover:underline">
                <RefreshCw size={12} /> Try again
              </button>
              <p className="mt-2 text-[11px] text-txt-muted">
                Everything above is computed from the database and is unaffected.
              </p>
            </div>
          </div>
        ) : nar.data ? (
          <div className="space-y-4">
            {/* Numbers the model stated that were not in the figures it was
                given. Usually empty; shown when not, because a wrong figure
                nobody can check is the one failure this design guards against. */}
            {nar.data.unverified_numbers?.length > 0 && (
              <div className="flex items-start gap-2 rounded border border-danger/25 bg-danger/5 px-3 py-2">
                <AlertTriangle size={13} className="mt-[2px] shrink-0 text-danger" />
                <p className="text-[11.5px] leading-snug text-txt-secondary">
                  <b>Check before quoting.</b> These figures appear in the text below
                  but not in the data it was given:{" "}
                  <span className="font-mono">{nar.data.unverified_numbers.join(", ")}</span>.
                </p>
              </div>
            )}
            {([
              ["findings", "Findings"],
              ["risks",    "Risks"],
              ["gaps",     "What this data still cannot answer"],
            ] as const).map(([key, label]) =>
              nar.data!.sections[key] ? (
                <div key={key}>
                  <div className="mb-1.5 font-condensed text-[11px] font-bold uppercase tracking-widest text-txt-muted">
                    {label}
                  </div>
                  <Prose text={nar.data!.sections[key]} />
                </div>
              ) : null
            )}
            {nar.data.sections.actions ? (
              <div>
                <div className="mb-1.5 font-condensed text-[11px] font-bold uppercase tracking-widest text-txt-muted">
                  Actions
                </div>
                <ActionTable text={nar.data.sections.actions} />
              </div>
            ) : null}
            <button onClick={() => nar.refetch()}
                    className="flex items-center gap-1.5 border-t border-border-light pt-2.5 text-[11.5px] text-txt-muted hover:text-navy">
              <RefreshCw size={12} /> Regenerate
            </button>
          </div>
        ) : null}
      </Card>

      {/* ── completeness ── */}
      {data.completeness && (
        <Card icon={<Database size={15} className="text-txt-muted" />} title="What the register records"
              note={`${data.completeness.records} analyses`}>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.completeness.fields.map((f) => (
              <div key={f.field}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[11.5px] text-txt-secondary">{f.field}</span>
                  <span className="font-mono text-[11.5px] text-navy">{f.pct}%</span>
                </div>
                <div className="mt-1 h-[5px] rounded-full bg-bg-subtle overflow-hidden">
                  <div className="h-full rounded-full"
                       style={{ width: `${f.pct}%`,
                                background: f.pct >= 90 ? "#2e7d32" : f.pct >= 60 ? "#c8960c" : "#e65100" }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-border-light pt-2">
            <div className="mb-1 font-condensed text-[10.5px] font-bold uppercase tracking-widest text-txt-muted">
              Not recorded at all
            </div>
            <ul className="space-y-1">
              {data.completeness.not_recorded.map((x, i) => (
                <li key={i} className="text-[11px] leading-snug text-txt-muted">— {x}</li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}
