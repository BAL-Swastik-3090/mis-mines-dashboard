"use client";
/**
 * Everything anybody said, lately.
 *
 * The per-thread notes answer "what was said about this machine". This answers
 * the question people actually arrive with — "what have I missed" — and it is
 * the reason notes are one table rather than seven: a feed across seven tables
 * is a union nobody maintains.
 *
 * Three filters, because there are only three ways people read this. Everything,
 * for catching up. Addressed to me, which is the only notification anybody
 * wants. And still open, which is the list of things somebody asked for and
 * nobody closed.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  MessageSquare, Loader2, AtSign, CircleDot, Cpu, User, CalendarClock,
  Plane, ArrowLeftRight, TriangleAlert, Repeat, Factory, Check, Pin,
} from "lucide-react";
import api from "@/lib/api";
import { Card, CardHeader, Chip, Tile, Avatar, type Tone } from "@/components/minehub/ui";
import { Body, said, type Note, type EntityKind } from "./CommentThread";

interface FeedNote extends Note {
  entity_type: EntityKind; entity_id: number; entity_label: string | null;
}

/** What each kind of thing looks like in a mixed list. */
const KIND: Record<EntityKind, { label: string; icon: React.ElementType; tone: Tone }> = {
  ASSET:      { label: "Machine",   icon: Cpu,             tone: "sky" },
  OPERATOR:   { label: "Operator",  icon: User,            tone: "violet" },
  SHIFT:      { label: "Shift",     icon: CalendarClock,   tone: "navy" },
  DEPLOYMENT: { label: "Deployment", icon: ArrowLeftRight, tone: "emerald" },
  HOTO:       { label: "Handover",  icon: ArrowLeftRight,  tone: "amber" },
  LEAVE:      { label: "Leave",     icon: Plane,           tone: "amber" },
  EXCEPTION:  { label: "Exception", icon: TriangleAlert,   tone: "rose" },
  PATTERN:    { label: "Pattern",   icon: Repeat,          tone: "slate" },
  PLANT:      { label: "Site",      icon: Factory,         tone: "teal" },
};

const VIEWS = [
  { id: "all", label: "Everything" },
  { id: "mine", label: "For me" },
  { id: "open", label: "Still open" },
];

export default function NotesFeed() {
  const [rows, setRows] = useState<FeedNote[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [view, setView] = useState("all");
  const [kind, setKind] = useState<string>("");
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/comments", {
        params: {
          days, limit: 150,
          entity_type: kind || undefined,
          mine: view === "mine" || undefined,
          unresolved: view === "open" || undefined,
        },
      });
      setRows(r.data?.comments ?? []);
      setSummary(r.data?.summary ?? {});
      setError(null);
    } catch {
      setError("The notes could not be read.");
    } finally { setLoading(false); }
  }, [view, kind, days]);

  useEffect(() => { void load(); }, [load]);

  const present = Array.from(new Set(rows.map((r) => r.entity_type)));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Tile label="Notes written" value={summary.total ?? 0} icon={MessageSquare}
              tone="violet" hint={`In the last ${days} days`} />
        <Tile label="Addressed to me" value={summary.mentioning_me ?? 0} icon={AtSign}
              tone={(summary.mentioning_me ?? 0) ? "amber" : "slate"}
              hint={(summary.mentioning_me ?? 0) ? "Somebody wants you" : "Nothing waiting"}
              onClick={() => setView("mine")} active={view === "mine"} />
        <Tile label="Still open" value={summary.open ?? 0} icon={CircleDot}
              tone={(summary.open ?? 0) ? "rose" : "slate"}
              hint="Asked for, not yet closed"
              onClick={() => setView("open")} active={view === "open"} />
      </div>

      <Card>
        <CardHeader
          title="Notes" icon={MessageSquare} tone="violet"
          subtitle="What people have said about machines, crews and shifts"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                {VIEWS.map((v) => (
                  <button key={v.id} onClick={() => setView(v.id)}
                    className={`px-2.5 py-1.5 text-[11px] font-semibold transition
                      ${view === v.id ? "bg-navy text-white"
                                      : "bg-white text-txt-muted hover:bg-slate-50"}`}>
                    {v.label}
                  </button>
                ))}
              </div>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px]
                           font-semibold text-txt-muted bg-white">
                <option value={7}>Last week</option>
                <option value={30}>Last month</option>
                <option value={90}>Last quarter</option>
                <option value={365}>Last year</option>
              </select>
            </div>
          }
        />

        {present.length > 1 && (
          <div className="px-5 py-2.5 border-b border-slate-100 flex flex-wrap gap-1.5">
            <button onClick={() => setKind("")}
              className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition
                ${!kind ? "bg-navy text-white border-navy"
                        : "bg-white text-txt-muted border-slate-200 hover:bg-slate-50"}`}>
              All kinds
            </button>
            {present.map((k) => {
              const look = KIND[k];
              const Icon = look.icon;
              return (
                <button key={k} onClick={() => setKind(kind === k ? "" : k)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold border
                    inline-flex items-center gap-1 transition
                    ${kind === k ? "bg-navy text-white border-navy"
                                 : "bg-white text-txt-muted border-slate-200 hover:bg-slate-50"}`}>
                  <Icon className="w-3 h-3" /> {look.label}
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="px-5 py-3 text-[12px] text-rose bg-rose-bg border-b border-rose/20">
            {error}
          </div>
        )}

        {loading ? (
          <div className="px-5 py-14 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-txt-light" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-14 text-center text-[13px] text-txt-muted">
            {view === "mine"
              ? "Nothing addressed to you. Somebody types @ and your name to change that."
              : view === "open"
              ? "Nothing outstanding — every note that asked for something has been closed."
              : "No notes yet. They are written on the machine, the operator or the shift "
                + "they are about, and they all land here."}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((n) => {
              const look = KIND[n.entity_type] ?? KIND.ASSET;
              const Icon = look.icon;
              return (
                <div key={n.comment_id} className="px-5 py-3 flex items-start gap-3">
                  <Avatar name={n.author_name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[12.5px] font-semibold text-navy">
                        {n.author_name}
                      </span>
                      <span className="text-[11px] text-txt-light">{said(n.created_at)}</span>
                      <Chip tone={look.tone} dot={false}>
                        <Icon className="w-3 h-3" />
                        {n.entity_label || `${look.label} ${n.entity_id}`}
                      </Chip>
                      {n.parent_id && (
                        <span className="text-[10.5px] text-txt-light">reply</span>
                      )}
                      {n.is_pinned && (
                        <Chip tone="gold" dot={false}><Pin className="w-3 h-3" /></Chip>
                      )}
                      {n.is_resolved && (
                        <Chip tone="emerald" dot={false}>
                          <Check className="w-3 h-3" /> closed
                        </Chip>
                      )}
                    </div>
                    <div className={`mt-0.5 ${n.is_resolved ? "opacity-60" : ""}`}>
                      <Body text={n.body} names={n.mention_names ?? {}} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
