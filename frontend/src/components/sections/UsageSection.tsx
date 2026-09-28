"use client";
/**
 * Usage — who uses this dashboard, what they open, and what they change.
 *
 * TWO LOGS THAT HAD NEVER BEEN PUT SIDE BY SIDE.
 *
 * The session log says somebody was here: signed in at this time, from this
 * browser, for this long, and opened these screens. The event log says they
 * did something: set a roster day, changed a bucket, planned a face, with
 * what it said before.
 *
 * Separately each is half an answer. Forty sessions and no changes is
 * somebody reading; six sessions and two hundred changes is somebody working.
 * A manager asking "is this being used" means the second and gets shown the
 * first, so both are on one row here.
 *
 * READ-ONLY, and behind the same permission as the access screen — seeing a
 * colleague's activity is seeing a colleague's details.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. No "engagement score", no ranking of
 * people against each other. The numbers are hours and counts, which a person
 * can check and argue with; a score is a number nobody can check that gets
 * quoted as though they could.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, Users, Clock, MousePointerClick, Pencil, Loader2, Monitor,
  AlertTriangle, LayoutGrid, CalendarClock,
} from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { matchesSearch } from "@/lib/search";
import {
  Card, CardHeader, Chip, EmptyRow, Td, Th, PageHeader, Tabs,
  inputClass, type Tone,
} from "@/components/minehub/ui";
import SearchSelect from "@/components/minehub/SearchSelect";

interface Person {
  emp_id: string; name: string | null; department: string | null;
  role: string | null; sessions: number; minutes: number;
  last_seen: string | null; browser: string | null; device: string | null;
  timed_out: number; views: number; changes: number;
}
interface Screen {
  page_path: string; screen: string; views: number; people: number;
  avg_seconds: number; total_seconds: number; no_dwell: number;
}
interface Kind {
  event_type: string; count: number; people: number; last: string | null;
}
interface Change {
  occurred_at: string; event_type: string; by: string | null;
  emp_id: string | null; payload: Record<string, unknown> | null;
}
interface Sess {
  session_id: string; emp_id: string; emp_name: string | null;
  login_at: string; logout_at: string | null; duration_minutes: number | null;
  end_reason: string | null; is_active: number; browser: string | null;
  os: string | null; device_type: string | null; ip_address: string | null;
}
interface Usage {
  app_source: string; from: string; to: string; days: number;
  headline: {
    sessions: number; people: number; minutes: number; avg_minutes: number;
    live: number; views: number; changes: number; screens: number;
  };
  people: Person[]; screens: Screen[];
  by_hour: Record<string, number>; by_weekday: Record<string, number>;
  by_day: { day: string; views: number; people: number }[];
  endings: Record<string, number>; browsers: Record<string, number>;
  recent_sessions: Sess[];
  changes_by_kind: Kind[]; latest_changes: Change[];
  unattributed: { by: string; count: number }[];
}
interface App {
  app_source: string; sessions: number; people: number;
  minutes: number; last_seen: string | null;
}

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Hours, not minutes, once it runs past a couple of them: "5,764 minutes"
 *  is a number nobody converts in their head. */
function hours(mins: number): string {
  if (mins < 90) return `${Math.round(mins)} min`;
  return `${formatIndian(Math.round(mins / 6) / 10)} hrs`;
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso.replace(" ", "T")).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} hrs ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

/** A bar drawn in CSS rather than by a charting library. These are counts
 *  against a maximum; a dependency to draw a rectangle is a dependency to
 *  keep, secure and upgrade forever. */
function Bar({ value, max, tone = "gold" }: {
  value: number; max: number; tone?: "gold" | "sky" | "violet" | "teal";
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  const bg = { sky: "bg-sky", violet: "bg-violet", teal: "bg-teal",
               gold: "bg-gold" }[tone];
  return (
    <span className="block h-1.5 rounded-full bg-bg-section overflow-hidden">
      <span className={`block h-full rounded-full ${bg}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

type TabId = "overview" | "people" | "screens" | "changes" | "sessions";

export default function UsageSection() {
  const [days, setDays] = useState(30);
  const [app, setApp] = useState("MINES");
  const [tab, setTab] = useState<TabId>("overview");
  const [data, setData] = useState<Usage | null>(null);
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [u, a] = await Promise.all([
        api.get("/usage", { params: { days, app_source: app } }),
        api.get("/usage/apps", { params: { days } }).catch(() => ({ data: [] })),
      ]);
      // The API is a claim, not a guarantee. Every list is defaulted so one
      // missing key cannot take the page down.
      setData(u.data ?? null);
      setApps(a.data ?? []);
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(d ?? "Could not load usage.");
    } finally {
      setLoading(false);
    }
  }, [days, app]);

  useEffect(() => { void load(); }, [load]);

  const h = data?.headline;
  const people = useMemo(
    () => (data?.people ?? []).filter(
      (p) => matchesSearch(q, [p.emp_id, p.name, p.department, p.role])),
    [data, q]);

  const maxHour = Math.max(1, ...Object.values(data?.by_hour ?? {}));
  const maxDay = Math.max(1, ...Object.values(data?.by_weekday ?? {}));
  const maxScreen = Math.max(1, ...(data?.screens ?? []).map((s) => s.views));

  const TABS = [
    { id: "overview", label: "Overview", icon: Activity, tone: "gold" as Tone,
      hint: "Who is using it, when, and how much." },
    { id: "people", label: data ? `People · ${data.people.length}` : "People",
      icon: Users, tone: "sky" as Tone,
      hint: "Everyone who signed in or changed something, with both counts on one row." },
    { id: "screens", label: "Screens", icon: LayoutGrid, tone: "teal" as Tone,
      hint: "What gets opened, by how many people, and for how long." },
    { id: "changes", label: data ? `Changes · ${h?.changes ?? 0}` : "Changes",
      icon: Pencil, tone: "violet" as Tone,
      hint: "What was actually altered, by whom, and when." },
    { id: "sessions", label: "Sessions", icon: Monitor, tone: "slate" as Tone,
      hint: "Recent sign-ins, how long they lasted and how they ended." },
  ];
  const active = TABS.find((t) => t.id === tab);

  return (
    <div className="py-6 space-y-5 max-w-[1500px]">
      <PageHeader
        lead="Us" rest="age" joined tone="gold" icon={Activity} tuck
        subtitle={active?.hint}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gold" />}
            <SearchSelect value={String(days)} onChange={(v) => setDays(Number(v))}
              options={[
                { value: "1", label: "Today" }, { value: "7", label: "Last 7 days" },
                { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" },
                { value: "365", label: "Last year" },
              ]} />
            {apps.length > 1 && (
              // The table is shared by 22 applications. Seeing this one's
              // numbers beside the others is the difference between "494
              // sessions" and "494 sessions, sixth of twenty-two".
              <SearchSelect value={app} onChange={setApp}
                searchPlaceholder="Type an application…"
                options={apps.map((a) => ({
                  value: a.app_source, label: a.app_source,
                  hint: `${a.people} people`,
                  meta: <span className="text-txt-light">{a.sessions}</span>,
                }))} />
            )}
          </span>
        } />

      {err && (
        <Card tone="rose">
          <div className="px-4 py-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-rose">{err}</p>
          </div>
        </Card>
      )}

      {/* ── the five numbers, before anything else ───────────────────────── */}
      {h && (
        <Card>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0
                          sm:divide-x divide-border-light">
            {([
              [Users, "People", formatIndian(h.people), `${h.sessions} sessions`],
              [Clock, "Time on it", hours(h.minutes), `${h.avg_minutes} min a session`],
              [MousePointerClick, "Screens opened", formatIndian(h.views),
               `${h.screens} different ones`],
              [Pencil, "Things changed", formatIndian(h.changes),
               "roster, plan, register"],
              [Activity, "Signed in now", formatIndian(h.live),
               h.live ? "right this minute" : "nobody at the moment"],
            ] as const).map(([Icon, label, value, hint], i) => (
              <div key={label} className="px-4 py-3">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Icon className={`w-3.5 h-3.5 ${i === 3 ? "text-violet" : "text-gold"}`} />
                  <span className="text-[11px] font-semibold text-txt-secondary">{label}</span>
                </div>
                <div className="text-[22px] font-bold text-navy tabular-nums leading-none">
                  {value}
                </div>
                <div className="text-[10.5px] text-txt-light mt-0.5">{hint}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Tabs tabs={TABS} value={tab} onChange={(id: string) => setTab(id as TabId)} />

      {loading && !data && (
        <Card><div className="p-6 flex items-center gap-2 text-txt-muted text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading the logs…
        </div></Card>
      )}

      {/* ── overview ─────────────────────────────────────────────────────── */}
      {!loading && data && tab === "overview" && (
        <div className="space-y-5">
          <div className="grid lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader icon={CalendarClock} tone="gold" title="What hour of the day"
                subtitleOnIcon
                subtitle="Screens opened, by the hour. The shape says when the dashboard is actually part of somebody's work rather than something opened once." />
              <div className="px-4 py-3 flex items-end gap-[3px] h-[120px]">
                {Array.from({ length: 24 }, (_, i) => {
                  const n = data.by_hour[String(i)] ?? 0;
                  return (
                    <span key={i} className="flex-1 flex flex-col items-center gap-1"
                      title={`${String(i).padStart(2, "0")}:00 — ${n} views`}>
                      <span className="w-full rounded-t bg-gold/70 hover:bg-gold transition-colors"
                        style={{ height: `${Math.max(2, (n / maxHour) * 92)}px` }} />
                      {i % 3 === 0 && (
                        <span className="text-[8.5px] text-txt-light">{i}</span>
                      )}
                    </span>
                  );
                })}
              </div>
            </Card>

            <Card>
              <CardHeader icon={CalendarClock} tone="sky" title="What day of the week"
                subtitleOnIcon
                subtitle="A mine runs seven days. A dashboard used only Monday to Friday is a dashboard the weekend shift does not have." />
              <div className="px-4 py-3 space-y-2">
                {WEEK.map((d, i) => {
                  const n = data.by_weekday[String(i)] ?? 0;
                  return (
                    <div key={d} className="flex items-center gap-2 text-[11.5px]">
                      <span className="w-9 text-txt-muted">{d}</span>
                      <span className="flex-1"><Bar value={n} max={maxDay} tone="sky" /></span>
                      <span className="w-12 text-right tabular-nums text-txt-muted">
                        {formatIndian(n)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader icon={Monitor} tone="slate" title="How sessions end" subtitleOnIcon
                subtitle="A timeout is somebody who walked away; a logout is somebody who finished. Mostly timeouts is normal, and it is also why the idle policy matters." />
              <div className="px-4 py-3 space-y-1.5">
                {Object.entries(data.endings).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                  <div key={k} className="flex items-center justify-between text-[12px]">
                    <span className="text-txt-muted">{k.replace(/_/g, " ").toLowerCase()}</span>
                    <span className="font-mono tabular-nums text-navy">{formatIndian(n)}</span>
                  </div>
                ))}
                <div className="pt-1.5 mt-1.5 border-t border-border-light">
                  {Object.entries(data.browsers).slice(0, 4).map(([k, n]) => (
                    <div key={k} className="flex items-center justify-between text-[11.5px]">
                      <span className="text-txt-light">{k}</span>
                      <span className="font-mono tabular-nums text-txt-muted">{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader icon={LayoutGrid} tone="teal" title="Across the applications"
                subtitleOnIcon
                subtitle="Twenty-two share this session table. Which is worth knowing before anybody calls a number here high or low." />
              <div className="px-4 py-3 space-y-1">
                {apps.slice(0, 9).map((a) => (
                  <button key={a.app_source} type="button"
                    onClick={() => setApp(a.app_source)}
                    className={`w-full flex items-center gap-2 text-[11.5px] rounded px-1
                                py-0.5 hover:bg-bg-soft ${
                      a.app_source === app ? "font-semibold text-navy" : "text-txt-muted"}`}>
                    <span className="w-[150px] truncate text-left">{a.app_source}</span>
                    <span className="flex-1">
                      <Bar value={a.sessions} max={apps[0]?.sessions ?? 1}
                        tone={a.app_source === app ? "gold" : "sky"} />
                    </span>
                    <span className="w-10 text-right tabular-nums">{a.sessions}</span>
                  </button>
                ))}
              </div>
            </Card>
          </div>

          {data.unattributed.length > 0 && (
            <Card tone="amber">
              <CardHeader icon={AlertTriangle} tone="amber" subtitleOnIcon
                title={`${data.unattributed.reduce((n, u) => n + u.count, 0)} changes not tied to a person`}
                subtitle="Reported rather than hidden: a change nobody can be tied to is a fact about the log, not a row to drop." />
              <div className="px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
                {data.unattributed.map((u) => (
                  <span key={u.by}>
                    <span className="font-mono text-navy">{u.by}</span>
                    <span className="text-txt-muted"> — {u.count}</span>
                  </span>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── people ───────────────────────────────────────────────────────── */}
      {!loading && data && tab === "people" && (
        <Card>
          <CardHeader icon={Users} tone="sky" title="Everybody, and what they did"
            subtitleOnIcon
            subtitle="Sessions say somebody was here; changes say they did something. Both on one row, because a manager asking whether this is used means the second."
            actions={
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Name, number, department…"
                className={`${inputClass} w-[220px] py-1 text-[12px]`} />
            } />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr>
                  <Th>Person</Th><Th>Department</Th>
                  <Th className="text-right">Sessions</Th>
                  <Th className="text-right">Time</Th>
                  <Th className="text-right">Screens</Th>
                  <Th className="text-right">Changes</Th>
                  <Th>Last seen</Th>
                </tr>
              </thead>
              <tbody>
                {people.length === 0 && (
                  <EmptyRow colSpan={7}>Nobody matches.</EmptyRow>
                )}
                {people.map((p) => (
                  <tr key={p.emp_id}
                    className="border-t border-border-light hover:bg-bg-soft/50">
                    <Td>
                      <span className="font-semibold text-navy">
                        {p.name ?? p.emp_id}
                      </span>
                      <span className="block text-[10.5px] text-txt-light">
                        {p.emp_id}{p.role ? ` · ${p.role}` : ""}
                      </span>
                    </Td>
                    <Td className="text-[11.5px] text-txt-muted">
                      {p.department ?? "—"}
                    </Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums">
                      {p.sessions || "—"}
                    </Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums">
                      {p.minutes ? hours(p.minutes) : "—"}
                    </Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums text-txt-muted">
                      {p.views || "—"}
                    </Td>
                    <Td className="text-right text-[12px]">
                      {p.changes
                        ? <span className="font-mono font-bold text-violet tabular-nums">
                            {formatIndian(p.changes)}
                          </span>
                        : <span className="text-txt-light">—</span>}
                    </Td>
                    <Td className="text-[11.5px] text-txt-muted whitespace-nowrap">
                      {ago(p.last_seen)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border-light px-4 py-1.5 text-[10.5px] text-txt-light">
            Somebody with changes and no sessions changed things in a window
            they did not sign in during — the two logs cover the same days but
            not the same moments.
          </div>
        </Card>
      )}

      {/* ── screens ──────────────────────────────────────────────────────── */}
      {!loading && data && tab === "screens" && (
        <Card>
          <CardHeader icon={LayoutGrid} tone="teal" title="What gets opened" subtitleOnIcon
            subtitle="Views say it was reached; people says how widely; the time says whether anybody stayed. A screen opened often by three people is not the same as one opened often by thirty." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <Th>Screen</Th>
                  <Th className="text-right">Views</Th>
                  <Th>Share</Th>
                  <Th className="text-right">People</Th>
                  <Th className="text-right">Avg time</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {data.screens.map((s) => (
                  <tr key={s.page_path}
                    className="border-t border-border-light hover:bg-bg-soft/50">
                    <Td>
                      <span className="font-semibold text-navy text-[12.5px]">{s.screen}</span>
                      <span className="block text-[10px] font-mono text-txt-light">
                        {s.page_path}
                      </span>
                    </Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums">
                      {formatIndian(s.views)}
                    </Td>
                    <Td className="w-[140px]">
                      <Bar value={s.views} max={maxScreen} tone="teal" />
                    </Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums text-txt-muted">
                      {s.people}
                    </Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums">
                      {s.avg_seconds ? `${s.avg_seconds}s` : "—"}
                    </Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums text-txt-muted">
                      {hours(s.total_seconds / 60)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── changes ──────────────────────────────────────────────────────── */}
      {!loading && data && tab === "changes" && (
        <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 items-start">
          <Card>
            <CardHeader icon={Pencil} tone="violet" title="By kind" subtitleOnIcon
              subtitle="What sort of thing is being altered, and by how many different people." />
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr><Th>Kind</Th><Th className="text-right">Count</Th>
                      <Th className="text-right">People</Th></tr>
                </thead>
                <tbody>
                  {data.changes_by_kind.map((k) => (
                    <tr key={k.event_type} className="border-t border-border-light">
                      <Td className="text-[11.5px]">
                        {k.event_type.replace(/_/g, " ").toLowerCase()}
                      </Td>
                      <Td className="text-right text-[12px] font-mono tabular-nums">
                        {formatIndian(k.count)}
                      </Td>
                      <Td className="text-right text-[12px] font-mono tabular-nums text-txt-muted">
                        {k.people || "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader icon={Activity} tone="violet" title="The last 80 changes"
              subtitleOnIcon
              subtitle="Newest first, across every screen that records one." />
            <div className="max-h-[520px] overflow-auto">
              {data.latest_changes.map((c, i) => (
                <div key={`${c.occurred_at}-${i}`}
                  className="px-4 py-1.5 border-b border-border-light last:border-0
                             flex items-start gap-3 hover:bg-bg-soft/50">
                  <span className="text-[10.5px] font-mono text-txt-light tabular-nums
                                   shrink-0 pt-0.5 w-[84px]">
                    {String(c.occurred_at).slice(5, 16).replace("T", " ")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11.5px] text-txt-primary">
                      {c.event_type.replace(/_/g, " ").toLowerCase()}
                    </span>
                    <span className="block text-[10px] text-txt-light truncate">
                      {c.payload
                        ? JSON.stringify(c.payload).slice(0, 110)
                        : ""}
                    </span>
                  </span>
                  <Chip tone="slate" dot={false}>
                    {data.people.find((p) => p.emp_id === c.emp_id)?.name
                      ?? c.by ?? "—"}
                  </Chip>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── sessions ─────────────────────────────────────────────────────── */}
      {!loading && data && tab === "sessions" && (
        <Card>
          <CardHeader icon={Monitor} tone="slate" title="Recent sign-ins" subtitleOnIcon
            subtitle="The last sixty, with how long each lasted, how it ended and what it was on." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr>
                  <Th>Person</Th><Th>Signed in</Th>
                  <Th className="text-right">For</Th>
                  <Th>Ended</Th><Th>On</Th><Th>From</Th>
                </tr>
              </thead>
              <tbody>
                {data.recent_sessions.map((s) => (
                  <tr key={s.session_id + s.login_at}
                    className="border-t border-border-light hover:bg-bg-soft/50">
                    <Td>
                      <span className="text-[12px] font-semibold text-navy">
                        {s.emp_name ?? s.emp_id}
                      </span>
                      <span className="block text-[10px] text-txt-light">{s.emp_id}</span>
                    </Td>
                    <Td className="text-[11.5px] text-txt-muted whitespace-nowrap">
                      {String(s.login_at).slice(0, 16).replace("T", " ")}
                    </Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums">
                      {s.duration_minutes != null ? hours(s.duration_minutes) : "—"}
                    </Td>
                    <Td>
                      {s.is_active
                        ? <Chip tone="emerald">signed in</Chip>
                        : <span className="text-[11.5px] text-txt-muted">
                            {(s.end_reason ?? "—").replace(/_/g, " ").toLowerCase()}
                          </span>}
                    </Td>
                    <Td className="text-[11px] text-txt-light">
                      {[s.browser, s.os].filter(Boolean).join(" · ") || "—"}
                    </Td>
                    <Td className="text-[11px] font-mono text-txt-light">
                      {s.ip_address ?? "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
