"use client";
import { useState } from "react";
import { Brain, RefreshCw, AlertCircle, Droplets, ShieldAlert, Truck, HardHat } from "lucide-react";
import { useInsightsGenerate } from "@/hooks/useInsights";
import { useDateFilter } from "@/contexts/useDateFilter";

// ── Markdown-lite renderer (bold, bullets) ────────────────────
function Prose({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split("\n").filter((l) => l.trim());
  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        // numbered bullets like "1. text" or "RISK: ... → ACTION: ..."
        const isBullet = /^(\d+\.|[-•*]|RISK:)/.test(line.trim());
        const rendered = line
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.*?)\*/g, "<em>$1</em>")
          .replace(/(RISK:)/g, '<span class="font-bold text-danger">$1</span>')
          .replace(/(ACTION:)/g, '<span class="font-bold text-success">$1</span>')
          .replace(/(ACHIEVABLE|STRETCH|NOT\s?FEASIBLE)/g, '<span class="font-bold">$1</span>');
        return (
          <p
            key={i}
            className={`text-[12.5px] leading-relaxed text-txt-secondary ${isBullet ? "pl-3 border-l-2 border-accent/30" : ""}`}
            dangerouslySetInnerHTML={{ __html: rendered }}
          />
        );
      })}
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────
function InsightCard({
  icon,
  title,
  accent,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`bg-white border border-border rounded-lg shadow-sm overflow-hidden`}>
      <div className={`px-4 pt-3 pb-2 border-b border-border-light flex items-center gap-2 ${accent}`}>
        {icon}
        <span className="font-condensed font-bold text-[12px] tracking-widest uppercase">
          {title}
        </span>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

// ── Skeleton card ─────────────────────────────────────────────
function SkeletonCard({ title, accent, icon }: { title: string; accent: string; icon: React.ReactNode }) {
  return (
    <InsightCard icon={icon} title={title} accent={accent}>
      <div className="space-y-2">
        {[70, 90, 60, 80].map((w) => (
          <div key={w} className={`h-3 bg-bg-section rounded animate-pulse`} style={{ width: `${w}%` }} />
        ))}
      </div>
    </InsightCard>
  );
}

// ── Main section ──────────────────────────────────────────────
export default function InsightsSection() {
  const { periodLabel } = useDateFilter();
  const [triggered, setTriggered] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useInsightsGenerate(triggered);

  const busy = isLoading || isFetching;

  const handleGenerate = () => {
    if (!triggered) {
      setTriggered(true);
    } else {
      refetch();
    }
  };

  return (
    <section className="space-y-4">

      {/* Header */}
      <div className="section-title">
        <Brain size={13} className="text-accent" />
        Operational Insights · AI Analysis

        <span className="ml-auto flex items-center gap-2 normal-case tracking-normal font-normal text-[11px]">
          {data && (
            <span className="text-txt-light font-mono text-[10px]">
              Generated {data.generated_at} · {data.model_used}
            </span>
          )}
          <button
            onClick={handleGenerate}
            disabled={busy}
            className="flex items-center gap-1.5 bg-accent text-white text-[11px] font-bold px-3 py-1 rounded tracking-wide hover:bg-navy transition-colors disabled:opacity-60"
          >
            <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
            {busy ? "Generating…" : triggered ? "Regenerate" : "Generate Insights"}
          </button>
          <span className="bg-navy text-white text-[10px] font-bold px-2 py-0.5 rounded tracking-wider">
            {periodLabel}
          </span>
        </span>
      </div>

      {/* Not yet triggered */}
      {!triggered && (
        <div className="bg-white border border-border rounded-lg shadow-sm p-8 text-center">
          <Brain size={32} className="mx-auto text-accent/30 mb-3" />
          <p className="text-txt-muted text-[13px] mb-1">AI insights are generated on demand</p>
          <p className="text-txt-light text-[11px] mb-4">
            Analyses month-end feasibility, dewatering, equipment fleet, COB quality, stock position, and despatch split using Claude.
          </p>
          <button
            onClick={handleGenerate}
            className="bg-accent text-white text-[12px] font-bold px-5 py-2 rounded hover:bg-navy transition-colors"
          >
            Generate Insights
          </button>
        </div>
      )}

      {/* Loading */}
      {triggered && busy && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <SkeletonCard title="Month-End Feasibility Narrative" accent="text-navy" icon={<AlertCircle size={13} />} />
            <SkeletonCard title="Critical Observations — Dewatering" accent="text-accent" icon={<Droplets size={13} />} />
            <SkeletonCard title="Equipment & COB Plant Status" accent="text-warning" icon={<HardHat size={13} />} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <SkeletonCard title="Stock & Despatch Summary" accent="text-success" icon={<Truck size={13} />} />
            <SkeletonCard title="Key Risks & Recommended Actions" accent="text-danger" icon={<ShieldAlert size={13} />} />
          </div>
        </div>
      )}

      {/* Error */}
      {triggered && isError && !busy && (
        <div className="bg-white border border-danger/30 rounded-lg p-6 text-center">
          <p className="text-danger text-[13px] font-semibold mb-2">Failed to generate insights</p>
          <p className="text-txt-muted text-[11px] mb-3">LiteLLM API may be unreachable. Check backend logs.</p>
          <button
            onClick={() => refetch()}
            className="bg-danger text-white text-[11px] font-bold px-4 py-1.5 rounded hover:opacity-80 transition-opacity"
          >
            Retry
          </button>
        </div>
      )}

      {/* Results */}
      {triggered && data && !busy && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <InsightCard icon={<AlertCircle size={13} className="text-navy" />} title="Month-End Feasibility Narrative" accent="text-navy">
              <Prose text={data.reality_check_narrative} />
            </InsightCard>
            <InsightCard icon={<Droplets size={13} className="text-accent" />} title="Critical Observations — Dewatering" accent="text-accent">
              <Prose text={data.dewatering_observations} />
            </InsightCard>
            <InsightCard icon={<HardHat size={13} className="text-warning" />} title="Equipment & COB Plant Status" accent="text-warning">
              <Prose text={data.equipment_cob_status} />
            </InsightCard>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <InsightCard icon={<Truck size={13} className="text-success" />} title="Stock & Despatch Summary" accent="text-success">
              <Prose text={data.stock_despatch_summary} />
            </InsightCard>
            <InsightCard icon={<ShieldAlert size={13} className="text-danger" />} title="Key Risks & Recommended Actions" accent="text-danger">
              <Prose text={data.key_risks_and_actions} />
            </InsightCard>
          </div>
        </div>
      )}

    </section>
  );
}
