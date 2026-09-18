"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import {
  Wrench, AlertTriangle, Clock, Repeat, Users, Database,
  Sparkles, RefreshCw, Info, ChevronRight,
} from "lucide-react";
import { useWhyWhy, useWhyWhyNarrative } from "@/hooks/useInsights";
import { formatIndian } from "@/lib/utils";
import type { WhyWhyShare, WhyWhyWatch } from "@/types";

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

// ── section ──────────────────────────────────────────────────
export default function WhyWhyAnalysisSection() {
  const { data, isLoading } = useWhyWhy();
  const [wantNarrative, setWantNarrative] = useState(false);
  const nar = useWhyWhyNarrative(wantNarrative);

  if (isLoading && !data) {
    return (
      <Card icon={<Wrench size={15} className="text-accent" />} title="Why-Why Analysis">
        <div className="h-40 animate-pulse rounded bg-bg-subtle" />
      </Card>
    );
  }

  const h = data?.headline;
  const w = data?.window;
  if (!data || !h || !w || w.empty || h.breakdowns === 0) {
    return (
      <Card icon={<Wrench size={15} className="text-accent" />} title="Why-Why Analysis">
        <p className="py-6 text-center text-[12.5px] text-txt-muted">
          No breakdown analyses recorded for this period.
        </p>
      </Card>
    );
  }

  const hourMax = Math.max(...(data.timing?.by_hour ?? []).map((x) => x.count), 1);

  return (
    <div className="space-y-4">
      {/* Which period is actually on screen. The register covers a fixed span,
          so a filter outside it shows the whole extent rather than nothing —
          said plainly instead of leaving the reader to wonder. */}
      {(w.clamped || w.fell_back) && (
        <div className="flex items-start gap-2 rounded-lg border border-accent/25 bg-accent/5 px-3.5 py-2.5">
          <Info size={14} className="mt-[2px] shrink-0 text-[#c8960c]" />
          <p className="text-[12px] leading-snug text-txt-secondary">
            {w.fell_back
              ? <>The selected dates fall outside the Why-Why register, which runs{" "}
                  <b>{w.extent_from} to {w.extent_to}</b>. Showing the full register.</>
              : <>Trimmed to the register, which runs <b>{w.extent_from} to {w.extent_to}</b>.
                  Showing <b>{w.from} to {w.to}</b>.</>}
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
