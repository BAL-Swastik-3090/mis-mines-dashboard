"use client";
/**
 * Usage — who uses this dashboard, what they open, and what they change.
 *
 * THE NUMBER THAT MAKES THE OTHERS MEAN SOMETHING is the denominator. The
 * first version of this screen reported on the 29 people who signed in, which
 * reads as a good number until you learn that 38 were given the platform. The
 * 19 who never arrived are the finding; the 29 are the consolation.
 *
 * THREE LOGS THAT HAD NEVER BEEN PUT TOGETHER. Sessions (MySQL, shared by 22
 * applications) say somebody was here. Page views say where they went. The
 * event log (Postgres, ours) says what they changed. Forty sessions and no
 * changes is somebody reading; six sessions and two hundred changes is
 * somebody working. A manager asking "is this being used" means the second and
 * was being shown the first.
 *
 * WHAT THE NUMBERS ARE ALLOWED TO BE. Hours, counts and dates — quantities a
 * person can check and argue with. Where a threshold is used, as in the
 * adoption bands, the threshold is printed beside the band. There is no
 * engagement score: a number nobody can recompute is a number that gets quoted
 * in a meeting as though they could.
 *
 * AND WHAT THEY ARE NOT ALLOWED TO SAY. The screen reports what the logs
 * recorded. It does not infer why, and in particular it does not convert a low
 * count into a judgement about a person: somebody who is on the register and
 * has never signed in may have been given access they never needed, or may
 * never have been shown the thing. The screen names them. Whoever knows them
 * says which.
 *
 * READ-ONLY, behind the same permission as Access Control, because seeing a
 * colleague's activity is seeing a colleague's details.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, BarChart3, CalendarClock, Clock, Eye, Gauge,
  LayoutGrid, Loader2, LogOut, Monitor, MousePointerClick, Pencil, TrendingUp,
  UserCheck, Users, X,
} from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { matchesSearch } from "@/lib/search";
import {
  Avatar, Card, CardHeader, Chip, EmptyRow, StatBar, Td, Th, Tile, PageHeader,
  Tabs, inputClass, type Tone,
} from "@/components/minehub/ui";
import SearchSelect from "@/components/minehub/SearchSelect";

/* ── shapes ─────────────────────────────────────────────────────────────── */
interface Person {
  emp_id: string; name: string | null; department: string | null;
  role: string | null; roles?: string | null; provisioned?: boolean;
  sessions: number; minutes: number; last_seen: string | null;
  browser: string | null; device: string | null; timed_out: number;
  views: number; changes: number;
}
interface Screen {
  page_path: string; screen: string; views: number; people: number;
  avg_seconds: number; total_seconds: number; no_dwell: number;
}
interface Sess {
  session_id: string; emp_id?: string; emp_name?: string | null;
  login_at: string; logout_at: string | null; duration_minutes: number | null;
  end_reason: string | null; is_active: number; browser: string | null;
  os: string | null; device_type: string | null; ip_address: string | null;
}
interface Change {
  occurred_at: string; event_type: string; by: string | null;
  emp_id?: string | null; payload: Record<string, unknown> | null;
}
interface Usage {
  app_source: string; from: string; to: string; days: number;
  headline: {
    sessions: number; people: number; minutes: number; avg_minutes: number;
    live: number; views: number; changes: number; screens: number;
    provisioned: number; dau: number; wau: number; mau: number;
    sessions_today: number; median_minutes: number; engaged_sessions: number;
  };
  people: Person[]; screens: Screen[];
  online: { emp_id: string; emp_name: string | null; department: string | null;
            role: string | null; last_active_at: string; login_at: string }[];
  heatmap: number[][];
  by_weekday_sessions: Record<string, { sessions: number; people: number }>;
  by_day_sessions: Record<string, { sessions: number; people: number }>;
  by_hour: Record<string, number>;
  by_day: { day: string; views: number; people: number }[];
  endings: Record<string, number>; browsers: Record<string, number>;
  recent_sessions: Sess[];
  changes_by_kind: { event_type: string; count: number; people: number }[];
  latest_changes: Change[];
  unattributed: { by: string; count: number }[];
}
interface App {
  app_source: string; sessions: number; people: number;
  minutes: number; last_seen: string | null;
}
interface PersonDetail {
  emp_id: string; name: string | null; department: string | null;
  role: string | null; sessions: Sess[];
  screens: (Screen & { last_seen: string })[]; changes: Change[];
}

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Screens grouped the way somebody thinks about the platform.
 *
 * "Equipment 360 had 284 views" is a fact about a page; "the registers had
 * 431" is a fact about a part of the job. Both are worth seeing, which is why
 * the grouped view and the page list sit side by side rather than one
 * replacing the other.
 */
const MODULE: Record<string, string> = {
  "/": "MIS", "/mis": "MIS",
  "/oee": "Dashboards", "/intelligence": "Dashboards", "/market": "Dashboards",
  "/fuel-management": "Dashboards", "/ev-tracking": "Dashboards",
  "/weather": "Dashboards",
  "/minehub": "Registers", "/manpower": "Registers", "/organisation": "Registers",
  "/operations": "Operations", "/workforce": "Operations", "/capacity": "Operations",
  "/gate": "Operations", "/weighbridge": "Operations",
  "/access-control": "Administration", "/usage": "Administration",
};

/**
 * How often somebody came, in bands.
 *
 * The thresholds are printed on the screen beside each band, because a band
 * whose rule is hidden is a judgement rather than a count. "Never" is kept
 * separate from the rest and not called anything pejorative: it says what the
 * log says and no more.
 */
const BANDS: { key: string; label: string; rule: string; tone: Tone;
               test: (n: number) => boolean }[] = [
  { key: "daily",   label: "Daily",        rule: "15 or more sessions",
    tone: "emerald", test: (n) => n >= 15 },
  { key: "regular", label: "Regular",      rule: "5 to 14",
    tone: "sky",     test: (n) => n >= 5 && n < 15 },
  { key: "now",     label: "Now and then", rule: "2 to 4",
    tone: "indigo",  test: (n) => n >= 2 && n < 5 },
  { key: "once",    label: "Once",         rule: "a single session",
    tone: "amber",   test: (n) => n === 1 },
  { key: "never",   label: "Never",        rule: "on the register, no session",
    tone: "slate",   test: (n) => n === 0 },
];

/* ── small helpers ──────────────────────────────────────────────────────── */

/** Hours once it runs past a couple of them — "5,872 minutes" is a number
 *  nobody converts in their head. */
function hours(mins: number): string {
  if (!mins) return "—";
  if (mins < 90) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m ? `${formatIndian(h)}h ${m}m` : `${formatIndian(h)}h`;
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(String(iso).replace(" ", "T")).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

const when = (iso: string | null | undefined, len = 16) =>
  iso ? String(iso).slice(0, len).replace("T", " ") : "—";

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/** A bar drawn in CSS. These are counts against a maximum; a charting library
 *  to draw a rectangle is a dependency to secure and upgrade forever.
 *
 *  The fill classes are written out rather than built as `bg-${tone}`.
 *  Tailwind generates its stylesheet by reading the source as text, so a class
 *  name assembled at runtime is never generated and the bar renders with no
 *  colour at all — a bug that only appears in the production build, where
 *  nobody is looking for it. */
const FILL: Record<string, string> = {
  gold: "bg-gold", sky: "bg-sky", teal: "bg-teal", violet: "bg-violet",
  indigo: "bg-indigo", emerald: "bg-emerald", amber: "bg-amber",
  rose: "bg-rose", navy: "bg-navy", slate: "bg-txt-light",
};

function Bar({ value, max, tone = "gold", className = "" }: {
  value: number; max: number; tone?: Tone; className?: string;
}) {
  const w = max > 0 ? Math.max(value > 0 ? 3 : 0, (value / max) * 100) : 0;
  return (
    <span className={`block h-1.5 rounded-full bg-bg-section overflow-hidden ${className}`}>
      <span className={`block h-full rounded-full ${FILL[tone] ?? FILL.gold}`}
        style={{ width: `${w}%` }} />
    </span>
  );
}

/* ── the screen ─────────────────────────────────────────────────────────── */
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
  const [band, setBand] = useState<string | null>(null);
  const [who, setWho] = useState<PersonDetail | null>(null);
  const [whoBusy, setWhoBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [u, a] = await Promise.all([
        api.get("/usage", { params: { days, app_source: app } }),
        api.get("/usage/apps", { params: { days } }).catch(() => ({ data: [] })),
      ]);
      setData(u.data ?? null);
      setApps(a.data ?? []);
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(d ?? "Could not read the usage logs.");
    } finally { setLoading(false); }
  }, [days, app]);

  useEffect(() => { void load(); }, [load]);

  const openPerson = async (emp: string) => {
    setWhoBusy(true); setWho(null);
    try {
      const r = await api.get(`/usage/person/${encodeURIComponent(emp)}`,
        { params: { days, app_source: app } });
      setWho(r.data);
    } catch { setWho(null); } finally { setWhoBusy(false); }
  };

  const h = data?.headline;

  /* Everyone, newest activity first, filtered by the search box and the band
     chips. Kept as one list so the counts on the chips and the rows in the
     table can never describe different sets of people. */
  const people = useMemo(() => {
    let list = data?.people ?? [];
    if (band) {
      const b = BANDS.find((x) => x.key === band);
      if (b) list = list.filter((p) => b.test(p.sessions));
    }
    return list.filter((p) =>
      matchesSearch(q, [p.emp_id, p.name, p.department, p.role, p.roles]));
  }, [data, q, band]);

  const bandCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const b of BANDS) {
      out[b.key] = (data?.people ?? []).filter((p) => b.test(p.sessions)).length;
    }
    return out;
  }, [data]);

  const modules = useMemo(() => {
    const m = new Map<string, { views: number; seconds: number; screens: number }>();
    for (const s of data?.screens ?? []) {
      const key = MODULE[s.page_path] ?? "Other";
      const cur = m.get(key) ?? { views: 0, seconds: 0, screens: 0 };
      cur.views += s.views; cur.seconds += s.total_seconds; cur.screens += 1;
      m.set(key, cur);
    }
    return [...m.entries()].map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.views - a.views);
  }, [data]);

  const departments = useMemo(() => {
    const m = new Map<string, { active: number; total: number; sessions: number;
                                minutes: number }>();
    for (const p of data?.people ?? []) {
      const key = p.department ?? "Not recorded";
      const cur = m.get(key) ?? { active: 0, total: 0, sessions: 0, minutes: 0 };
      cur.total += 1;
      if (p.sessions > 0) cur.active += 1;
      cur.sessions += p.sessions; cur.minutes += p.minutes;
      m.set(key, cur);
    }
    return [...m.entries()].map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.sessions - a.sessions);
  }, [data]);

  const daySeries = useMemo(() => {
    const src = data?.by_day_sessions ?? {};
    return Object.entries(src).map(([day, v]) => ({ day, ...v }));
  }, [data]);
  const maxDaySessions = Math.max(1, ...daySeries.map((d) => d.sessions));
  const peakDay = daySeries.reduce<{ day: string; sessions: number } | null>(
    (best, d) => (!best || d.sessions > best.sessions ? d : best), null);

  const maxHeat = Math.max(1, ...(data?.heatmap ?? []).flat());
  const maxWeekday = Math.max(1,
    ...Object.values(data?.by_weekday_sessions ?? {}).map((v) => v.sessions));
  const maxScreen = Math.max(1, ...(data?.screens ?? []).map((s) => s.views));
  const maxModule = Math.max(1, ...modules.map((m) => m.views));

  const nowWd = (new Date().getDay() + 6) % 7;
  const nowHr = new Date().getHours();

  const businessShare = useMemo(() => {
    const grid = data?.heatmap ?? [];
    let inside = 0, all = 0;
    grid.forEach((row) => row.forEach((n, hr) => {
      all += n; if (hr >= 9 && hr < 19) inside += n;
    }));
    return { inside, all, pct: pct(inside, all) };
  }, [data]);

  const TABS = [
    { id: "overview", label: "Overview", icon: Activity, tone: "gold" as Tone,
      hint: "How many of the people who were given this actually use it, and when." },
    { id: "people", label: data ? `People · ${data.people.length}` : "People",
      icon: Users, tone: "sky" as Tone,
      hint: "Everyone on the register, used or not. Click a row to open their own record." },
    { id: "screens", label: "Screens", icon: LayoutGrid, tone: "teal" as Tone,
      hint: "What gets opened, by how many people, and for how long." },
    { id: "changes", label: data ? `Changes · ${h?.changes ?? 0}` : "Changes",
      icon: Pencil, tone: "violet" as Tone,
      hint: "What was actually altered, by whom, and when." },
    { id: "sessions", label: "Sessions", icon: Monitor, tone: "slate" as Tone,
      hint: "Recent sign-ins, how long they lasted and how they ended." },
  ];
  const active = TABS.find((t) => t.id === tab);

  const logoutPct = useMemo(() => {
    const e = data?.endings ?? {};
    const total = Object.values(e).reduce((a, b) => a + b, 0);
    return { pct: pct(e["LOGOUT"] ?? 0, total), n: e["LOGOUT"] ?? 0, total };
  }, [data]);

  return (
    <div className="py-6 space-y-5 max-w-[1500px]">
      <PageHeader
        lead="Us" rest="age" joined tone="gold" icon={BarChart3} tuck
        subtitle={active?.hint}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gold" />}
            <SearchSelect value={String(days)} onChange={(v) => setDays(Number(v))}
              narrow options={[
                { value: "1", label: "Today" }, { value: "7", label: "Last 7 days" },
                { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" },
                { value: "365", label: "Last year" },
              ]} />
            {apps.length > 1 && (
              <SearchSelect value={app} onChange={setApp} narrow
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

      {/* ── the four that matter, before anything else ───────────────────── */}
      {h && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Using it" icon={UserCheck} tone="gold"
            value={<>{h.mau}<span className="text-txt-light text-[18px]"> / {h.provisioned}</span></>}
            hint={`${pct(h.mau, h.provisioned)}% of the people who were given it · ${
              Math.max(0, h.provisioned - h.mau)} have not signed in`} />
          <Tile label="Signed in now" icon={Activity}
            tone={h.live ? "emerald" : "slate"} value={h.live}
            hint={h.live ? "at this minute" : "nobody at the moment"} />
          <Tile label="Time on it" icon={Clock} tone="violet" value={hours(h.minutes)}
            hint={`${formatIndian(h.sessions)} sessions over ${data?.days ?? days} days`} />
          <Tile label="Typical session" icon={Gauge} tone="sky"
            value={`${h.median_minutes}m`}
            hint={`median · mean ${h.avg_minutes}m${
              h.avg_minutes > h.median_minutes * 1.4
                ? " — a few long ones pull the mean up" : ""}`} />
        </div>
      )}

      {/* Who is in there right now, by name. */}
      {data && data.online.length > 0 && (
        <Card>
          <div className="px-4 py-2.5 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase
                             tracking-[.14em] text-emerald">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald animate-pulse" />
              Signed in now
            </span>
            {data.online.map((o) => (
              <button key={o.emp_id} type="button"
                onClick={() => { setTab("people"); void openPerson(o.emp_id); }}
                className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full
                           bg-bg-soft hover:bg-bg-section transition-colors">
                <Avatar name={o.emp_name ?? o.emp_id} size="sm" />
                <span className="text-[11.5px] font-semibold text-navy">
                  {o.emp_name ?? o.emp_id}
                </span>
                <span className="text-[10px] text-txt-light">{ago(o.last_active_at)}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {h && (
        <StatBar items={[
          { label: "Today", value: h.dau, icon: Users, tone: "emerald",
            hint: `${h.sessions_today} sessions so far` },
          { label: "This week", value: h.wau, icon: Users, tone: "sky",
            hint: "signed in within 7 days" },
          { label: "In range", value: h.mau, icon: Users, tone: "indigo",
            hint: `of ${h.provisioned} provisioned` },
          { label: "Screens opened", value: formatIndian(h.views),
            icon: MousePointerClick, tone: "teal",
            hint: `${h.screens} different ones` },
          { label: "Per session", icon: Eye, tone: "amber",
            value: h.engaged_sessions
              ? (h.views / h.engaged_sessions).toFixed(1) : "—",
            hint: `across ${h.engaged_sessions} that reached a screen` },
          { label: "Signed out", value: `${logoutPct.pct}%`, icon: LogOut,
            tone: "slate",
            hint: `${logoutPct.n} of ${logoutPct.total} — the rest timed out` },
        ]} />
      )}

      <Tabs tabs={TABS} value={tab} onChange={(id: string) => setTab(id as TabId)} />

      {loading && !data && (
        <Card><div className="p-6 flex items-center gap-2 text-txt-muted text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading the logs…
        </div></Card>
      )}

      {/* ═══ OVERVIEW ═══════════════════════════════════════════════════════ */}
      {!loading && data && tab === "overview" && (
        <div className="space-y-5">

          {/* Sessions a day. */}
          <Card>
            <CardHeader icon={TrendingUp} tone="gold" subtitleOnIcon
              title="Sessions, day by day"
              subtitle="The bar is sessions; the line of dots is how many different people those sessions belonged to. A tall bar over few dots is one person working late, not the mine adopting a dashboard."
              actions={peakDay && (
                <Chip tone="gold">busiest {when(peakDay.day, 10)} · {peakDay.sessions}</Chip>
              )} />
            <div className="px-4 py-4">
              <div className="flex items-end gap-[2px] h-[130px]">
                {daySeries.map((d) => (
                  <span key={d.day} className="flex-1 flex flex-col justify-end
                                               items-center gap-[2px] group relative"
                    title={`${d.day} — ${d.sessions} sessions, ${d.people} people`}>
                    <span className="text-[9px] text-txt-light opacity-0
                                     group-hover:opacity-100 transition-opacity">
                      {d.sessions}
                    </span>
                    <span className="w-full rounded-t bg-gold/60 group-hover:bg-gold
                                     transition-colors"
                      style={{ height: `${(d.sessions / maxDaySessions) * 88}px` }} />
                    <span className="w-full rounded-t bg-teal"
                      style={{ height: `${Math.max(1, (d.people / maxDaySessions) * 88)}px` }} />
                  </span>
                ))}
              </div>
              <div className="flex justify-between mt-1.5 text-[10px] text-txt-light">
                <span>{when(daySeries[0]?.day, 10)}</span>
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-gold/60" /> sessions</span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-teal" /> people</span>
                </span>
                <span>{when(daySeries[daySeries.length - 1]?.day, 10)}</span>
              </div>
            </div>
          </Card>

          {/* How often people come. */}
          <Card>
            <CardHeader icon={Users} tone="indigo" subtitleOnIcon
              title={`How often people come · ${h?.provisioned ?? 0} on the register`}
              subtitle="Bands by number of sessions, with the rule for each printed underneath so the grouping can be checked rather than taken on trust. Click one to filter the People tab." />
            <div className="px-4 py-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {BANDS.map((b) => (
                <button key={b.key} type="button"
                  onClick={() => { setBand(band === b.key ? null : b.key); setTab("people"); }}
                  className={`text-left rounded-xl border px-3.5 py-3 transition-all
                              hover:shadow-md hover:-translate-y-px
                              ${band === b.key ? "border-gold ring-2 ring-gold/20"
                                               : "border-border-light"}`}>
                  <span className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${FILL[b.tone]}`} />
                    <span className="text-[10.5px] font-bold uppercase tracking-[.12em]
                                     text-txt-secondary">{b.label}</span>
                  </span>
                  <span className="block font-condensed font-extrabold text-[28px]
                                   leading-none mt-1.5 text-navy tabular-nums">
                    {bandCounts[b.key] ?? 0}
                  </span>
                  <span className="block text-[10.5px] text-txt-light mt-1">{b.rule}</span>
                </button>
              ))}
            </div>
            {(bandCounts["never"] ?? 0) > 0 && (
              <div className="border-t border-border-light px-4 py-2 text-[11.5px]
                              text-txt-muted">
                {bandCounts["never"]} people hold a live role and have not signed in
                during this range. That may be access nobody needed, or somebody
                nobody showed — the log cannot tell which.
              </div>
            )}
          </Card>

          {/* When. */}
          <div className="grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-5 items-start">
            <Card>
              <CardHeader icon={CalendarClock} tone="violet" subtitleOnIcon
                title="What hour, what day"
                subtitle="Sessions by weekday against hour. Two separate totals can tell you Thursday is busy and 3pm is busy; only the grid tells you about Thursday at 3pm."
                actions={businessShare.all > 0 && (
                  <Chip tone={businessShare.pct > 90 ? "sky" : "amber"}>
                    {businessShare.pct}% between 9 and 7
                  </Chip>
                )} />
              <div className="px-4 py-4 overflow-x-auto">
                <div className="min-w-[520px]">
                  <div className="flex gap-[3px] pl-9 mb-1">
                    {Array.from({ length: 24 }, (_, i) => (
                      <span key={i} className="flex-1 text-[8.5px] text-txt-light text-center">
                        {i % 3 === 0 ? i : ""}
                      </span>
                    ))}
                  </div>
                  {WEEK.map((d, wd) => (
                    <div key={d} className="flex items-center gap-[3px] mb-[3px]">
                      <span className="w-9 text-[10.5px] text-txt-muted shrink-0">{d}</span>
                      {Array.from({ length: 24 }, (_, hr) => {
                        const n = data.heatmap[wd]?.[hr] ?? 0;
                        const on = wd === nowWd && hr === nowHr;
                        return (
                          <span key={hr} className="flex-1 aspect-square rounded-[3px]
                                                    min-w-[9px] relative"
                            title={`${d} ${String(hr).padStart(2, "0")}:00 — ${n} session${
                              n === 1 ? "" : "s"}`}
                            style={{
                              backgroundColor: n
                                ? `rgba(59,130,246,${0.15 + (n / maxHeat) * 0.85})`
                                : "var(--bg-section, #f1f5f9)",
                              boxShadow: on ? "0 0 0 2px var(--gold, #c8960c)" : undefined,
                            }} />
                        );
                      })}
                    </div>
                  ))}
                  <div className="flex items-center gap-2 mt-2 pl-9 text-[10px] text-txt-light">
                    <span>fewer</span>
                    {[0.2, 0.4, 0.6, 0.8, 1].map((o) => (
                      <span key={o} className="w-3 h-3 rounded-[3px]"
                        style={{ backgroundColor: `rgba(59,130,246,${o})` }} />
                    ))}
                    <span>more</span>
                    <span className="ml-3 flex items-center gap-1">
                      <span className="w-3 h-3 rounded-[3px] ring-2 ring-gold" /> this hour
                    </span>
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader icon={CalendarClock} tone="teal" subtitleOnIcon
                title="By day of the week"
                subtitle="A mine runs seven days. A dashboard used only Monday to Saturday is one the Sunday shift does not have." />
              <div className="px-4 py-4 space-y-2.5">
                {WEEK.map((d, i) => {
                  const v = data.by_weekday_sessions[String(i)]
                    ?? { sessions: 0, people: 0 };
                  return (
                    <div key={d} className="flex items-center gap-2.5 text-[11.5px]">
                      <span className="w-9 text-txt-muted shrink-0">{d}</span>
                      <span className="flex-1">
                        <Bar value={v.sessions} max={maxWeekday} tone="teal" />
                      </span>
                      <span className="w-20 text-right tabular-nums text-txt-muted shrink-0">
                        {formatIndian(v.sessions)}
                        <span className="text-txt-light"> · {v.people}p</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Where the time goes. */}
          <div className="grid lg:grid-cols-2 gap-5 items-start">
            <Card>
              <CardHeader icon={LayoutGrid} tone="sky" subtitleOnIcon
                title="Which part of the platform"
                subtitle="Screens grouped the way the work is grouped. A fact about the registers is more useful than five facts about five pages." />
              <div className="px-4 py-4 space-y-3">
                {modules.map((m) => (
                  <div key={m.name}>
                    <div className="flex items-baseline justify-between text-[12px] mb-1">
                      <span className="font-semibold text-navy">{m.name}</span>
                      <span className="text-txt-muted tabular-nums">
                        {formatIndian(m.views)} views
                        <span className="text-txt-light"> · {hours(m.seconds / 60)}</span>
                      </span>
                    </div>
                    <Bar value={m.views} max={maxModule} tone="sky" />
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader icon={Users} tone="amber" subtitleOnIcon
                title="By department"
                subtitle="Active against everyone on the register in that department. A department at 0 of 3 is a conversation; a department at 3 of 3 is a reference." />
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr>
                    <Th>Department</Th><Th className="text-right">Using</Th>
                    <Th>Share</Th><Th className="text-right">Sessions</Th>
                    <Th className="text-right">Time</Th>
                  </tr></thead>
                  <tbody>
                    {departments.map((d) => (
                      <tr key={d.name} className="border-t border-border-light">
                        <Td className="text-[12px] font-semibold text-navy">{d.name}</Td>
                        <Td className="text-right text-[12px] font-mono tabular-nums">
                          {d.active}<span className="text-txt-light">/{d.total}</span>
                        </Td>
                        <Td className="w-[90px]">
                          <Bar value={d.active} max={d.total}
                            tone={d.active === 0 ? "rose"
                              : d.active === d.total ? "emerald" : "amber"} />
                        </Td>
                        <Td className="text-right text-[12px] font-mono tabular-nums
                                       text-txt-muted">{formatIndian(d.sessions)}</Td>
                        <Td className="text-right text-[12px] font-mono tabular-nums
                                       text-txt-muted">{hours(d.minutes)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

      {/* ═══ PEOPLE ═════════════════════════════════════════════════════════ */}
      {!loading && data && tab === "people" && (
        <Card>
          <CardHeader icon={Users} tone="sky" subtitleOnIcon
            title={`Everyone on the register · ${people.length}`}
            subtitle="Sessions say somebody was here; changes say they did something. Both on one row, because a manager asking whether this is used means the second. Click any row for that person's own record."
            actions={
              <span className="flex items-center gap-2">
                {band && (
                  <button type="button" onClick={() => setBand(null)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-gold-dark
                               bg-gold/10 ring-1 ring-gold/25 rounded-full px-2.5 py-1">
                    {BANDS.find((b) => b.key === band)?.label}
                    <X className="w-3 h-3" />
                  </button>
                )}
                <input value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder="Name, number, department, role…"
                  className={`${inputClass} w-[240px] py-1 text-[12px]`} />
              </span>
            } />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px]">
              <thead><tr>
                <Th>Person</Th><Th>Role</Th>
                <Th className="text-right">Sessions</Th>
                <Th className="text-right">Time</Th>
                <Th className="text-right">Screens</Th>
                <Th className="text-right">Changes</Th>
                <Th>Last seen</Th>
              </tr></thead>
              <tbody>
                {people.length === 0 && <EmptyRow colSpan={7}>Nobody matches.</EmptyRow>}
                {people.map((p) => (
                  <tr key={p.emp_id} onClick={() => void openPerson(p.emp_id)}
                    className="border-t border-border-light hover:bg-bg-soft/60 cursor-pointer">
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <Avatar name={p.name ?? p.emp_id} size="sm" />
                        <span className="min-w-0">
                          <span className="block font-semibold text-navy truncate">
                            {p.name ?? <span className="text-txt-light italic">
                              never signed in</span>}
                          </span>
                          <span className="block text-[10.5px] text-txt-light truncate">
                            {p.emp_id}{p.department ? ` · ${p.department}` : ""}
                          </span>
                        </span>
                      </span>
                    </Td>
                    <Td className="text-[11px] text-txt-muted max-w-[200px] truncate"
                      >{p.roles ?? p.role ?? "—"}</Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums">
                      {p.sessions || <span className="text-txt-light">0</span>}
                    </Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums">
                      {hours(p.minutes)}
                    </Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums text-txt-muted">
                      {p.views || "—"}
                    </Td>
                    <Td className="text-right text-[12px]">
                      {p.changes
                        ? <span className="font-mono font-bold text-violet tabular-nums">
                            {formatIndian(p.changes)}</span>
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
            Somebody with changes and no sessions changed things in a window they
            did not sign in during — the two logs cover the same days, not the
            same moments.
          </div>
        </Card>
      )}

      {/* ═══ SCREENS ════════════════════════════════════════════════════════ */}
      {!loading && data && tab === "screens" && (
        <Card>
          <CardHeader icon={LayoutGrid} tone="teal" subtitleOnIcon
            title="What gets opened"
            subtitle="Views say it was reached; people says how widely; the time says whether anybody stayed. A screen opened often by three people is not the same as one opened often by thirty." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead><tr>
                <Th>Screen</Th><Th className="text-right">Views</Th><Th>Share</Th>
                <Th className="text-right">People</Th><Th className="text-right">Avg stay</Th>
                <Th className="text-right">Total</Th>
              </tr></thead>
              <tbody>
                {data.screens.map((s, i) => (
                  <tr key={s.page_path} className="border-t border-border-light
                                                   hover:bg-bg-soft/50">
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-bg-section text-[10px]
                                         font-bold text-txt-muted flex items-center
                                         justify-center shrink-0">{i + 1}</span>
                        <span>
                          <span className="block font-semibold text-navy text-[12.5px]">
                            {s.screen}</span>
                          <span className="block text-[10px] font-mono text-txt-light">
                            {s.page_path}</span>
                        </span>
                      </span>
                    </Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums">
                      {formatIndian(s.views)}</Td>
                    <Td className="w-[140px]">
                      <Bar value={s.views} max={maxScreen} tone="teal" /></Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums text-txt-muted">
                      {s.people}</Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums">
                      {s.avg_seconds ? `${s.avg_seconds}s` : "—"}</Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums text-txt-muted">
                      {hours(s.total_seconds / 60)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ═══ CHANGES ════════════════════════════════════════════════════════ */}
      {!loading && data && tab === "changes" && (
        <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 items-start">
          <Card>
            <CardHeader icon={Pencil} tone="violet" title="By kind" subtitleOnIcon
              subtitle="What sort of thing is being altered, and by how many different people." />
            <div className="overflow-x-auto max-h-[560px]">
              <table className="w-full">
                <thead><tr><Th>Kind</Th><Th className="text-right">Count</Th>
                  <Th className="text-right">People</Th></tr></thead>
                <tbody>
                  {data.changes_by_kind.map((k) => (
                    <tr key={k.event_type} className="border-t border-border-light">
                      <Td className="text-[11.5px]">
                        {k.event_type.replace(/_/g, " ").toLowerCase()}</Td>
                      <Td className="text-right text-[12px] font-mono tabular-nums">
                        {formatIndian(k.count)}</Td>
                      <Td className="text-right text-[12px] font-mono tabular-nums text-txt-muted">
                        {k.people || "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader icon={Activity} tone="violet" title="The last 80 changes"
              subtitleOnIcon subtitle="Newest first, across every screen that records one." />
            <div className="max-h-[560px] overflow-auto">
              {data.latest_changes.map((c, i) => (
                <div key={`${c.occurred_at}-${i}`}
                  className="px-4 py-1.5 border-b border-border-light last:border-0
                             flex items-start gap-3 hover:bg-bg-soft/50">
                  <span className="text-[10.5px] font-mono text-txt-light tabular-nums
                                   shrink-0 pt-0.5 w-[82px]">
                    {String(c.occurred_at).slice(5, 16).replace("T", " ")}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11.5px] text-txt-primary">
                      {c.event_type.replace(/_/g, " ").toLowerCase()}</span>
                    <span className="block text-[10px] text-txt-light truncate">
                      {c.payload ? JSON.stringify(c.payload).slice(0, 120) : ""}</span>
                  </span>
                  <Chip tone="slate" dot={false}>
                    {data.people.find((p) => p.emp_id === c.emp_id)?.name ?? c.by ?? "—"}
                  </Chip>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ═══ SESSIONS ═══════════════════════════════════════════════════════ */}
      {!loading && data && tab === "sessions" && (
        <Card>
          <CardHeader icon={Monitor} tone="slate" title="Recent sign-ins" subtitleOnIcon
            subtitle="The last sixty, with how long each lasted, how it ended and what it was on. A timeout is somebody who walked away; a sign-out is somebody who finished."
            actions={
              <span className="flex flex-wrap gap-1.5">
                {Object.entries(data.browsers).slice(0, 4).map(([b, n]) => (
                  <Chip key={b} tone="slate" dot={false}>{b} {n}</Chip>
                ))}
              </span>
            } />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead><tr>
                <Th>Person</Th><Th>Signed in</Th><Th className="text-right">For</Th>
                <Th>Ended</Th><Th>On</Th><Th>From</Th>
              </tr></thead>
              <tbody>
                {data.recent_sessions.map((s) => (
                  <tr key={s.session_id + s.login_at}
                    onClick={() => s.emp_id && void openPerson(s.emp_id)}
                    className="border-t border-border-light hover:bg-bg-soft/50 cursor-pointer">
                    <Td>
                      <span className="text-[12px] font-semibold text-navy">
                        {s.emp_name ?? s.emp_id}</span>
                      <span className="block text-[10px] text-txt-light">{s.emp_id}</span>
                    </Td>
                    <Td className="text-[11.5px] text-txt-muted whitespace-nowrap">
                      {when(s.login_at)}</Td>
                    <Td className="text-right text-[12px] font-mono tabular-nums">
                      {s.duration_minutes != null ? hours(s.duration_minutes) : "—"}</Td>
                    <Td>
                      {s.is_active
                        ? <Chip tone="emerald">signed in</Chip>
                        : <span className="text-[11.5px] text-txt-muted">
                            {(s.end_reason ?? "—").replace(/_/g, " ").toLowerCase()}</span>}
                    </Td>
                    <Td className="text-[11px] text-txt-light">
                      {[s.browser, s.os].filter(Boolean).join(" · ") || "—"}</Td>
                    <Td className="text-[11px] font-mono text-txt-light">
                      {s.ip_address ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ═══ one person ═════════════════════════════════════════════════════ */}
      {(who || whoBusy) && (
        <div className="fixed inset-0 z-[10000] bg-navy/40 backdrop-blur-sm
                        flex items-start justify-center p-4 overflow-auto"
          onClick={() => { setWho(null); setWhoBusy(false); }}>
          <div className="bg-bg-base rounded-2xl shadow-2xl w-full max-w-[900px] my-8"
            onClick={(e) => e.stopPropagation()}>
            {whoBusy && (
              <div className="p-8 flex items-center gap-2 text-txt-muted text-[13px]">
                <Loader2 className="w-4 h-4 animate-spin" /> Reading their record…
              </div>
            )}
            {who && (
              <>
                <header className="px-5 py-4 border-b border-border-light flex
                                   items-start justify-between gap-3">
                  <span className="flex items-center gap-3">
                    <Avatar name={who.name ?? who.emp_id} />
                    <span>
                      <span className="block font-condensed font-extrabold text-[20px]
                                       text-navy leading-tight">
                        {who.name ?? who.emp_id}</span>
                      <span className="block text-[11.5px] text-txt-muted">
                        {who.emp_id}{who.department ? ` · ${who.department}` : ""}
                        {who.role ? ` · ${who.role}` : ""}</span>
                    </span>
                  </span>
                  <button type="button" onClick={() => setWho(null)}
                    className="p-1.5 rounded-lg hover:bg-bg-soft text-txt-muted">
                    <X className="w-4 h-4" />
                  </button>
                </header>

                <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x
                                divide-border-light border-b border-border-light">
                  {([
                    ["Sessions", who.sessions.length, "in this range"],
                    ["Screens opened",
                     who.screens.reduce((n, s) => n + s.views, 0),
                     `${who.screens.length} different`],
                    ["Changes", who.changes.length, "recorded in the event log"],
                  ] as const).map(([l, v, hint]) => (
                    <div key={l} className="px-5 py-3">
                      <div className="text-[10.5px] font-bold uppercase tracking-[.12em]
                                      text-txt-light">{l}</div>
                      <div className="font-condensed font-extrabold text-[26px] text-navy
                                      leading-none mt-1 tabular-nums">
                        {formatIndian(v)}</div>
                      <div className="text-[10.5px] text-txt-light mt-0.5">{hint}</div>
                    </div>
                  ))}
                </div>

                <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x
                                divide-border-light">
                  <div>
                    <div className="px-5 pt-4 pb-2 text-[11px] font-bold uppercase
                                    tracking-[.12em] text-txt-secondary">
                      Where they go</div>
                    <div className="px-5 pb-4 space-y-2 max-h-[300px] overflow-auto">
                      {who.screens.length === 0 && (
                        <p className="text-[12px] text-txt-light">No screens recorded.</p>
                      )}
                      {who.screens.map((s) => (
                        <div key={s.page_path} className="flex items-center gap-2 text-[11.5px]">
                          <span className="flex-1 truncate text-navy">{s.screen}</span>
                          <span className="tabular-nums text-txt-muted">{s.views}</span>
                          <span className="w-12 text-right tabular-nums text-txt-light">
                            {s.avg_seconds ? `${s.avg_seconds}s` : "—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="px-5 pt-4 pb-2 text-[11px] font-bold uppercase
                                    tracking-[.12em] text-txt-secondary">
                      What they changed</div>
                    <div className="px-5 pb-4 space-y-1.5 max-h-[300px] overflow-auto">
                      {who.changes.length === 0 && (
                        <p className="text-[12px] text-txt-light">
                          Nothing recorded — this person reads rather than edits,
                          in this range.</p>
                      )}
                      {who.changes.slice(0, 60).map((c, i) => (
                        <div key={i} className="text-[11px]">
                          <span className="font-mono text-txt-light tabular-nums mr-2">
                            {String(c.occurred_at).slice(5, 16).replace("T", " ")}</span>
                          <span className="text-txt-primary">
                            {c.event_type.replace(/_/g, " ").toLowerCase()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="border-t border-border-light">
                  <div className="px-5 pt-4 pb-2 text-[11px] font-bold uppercase
                                  tracking-[.12em] text-txt-secondary">
                    Their sessions</div>
                  <div className="max-h-[260px] overflow-auto">
                    <table className="w-full">
                      <thead><tr>
                        <Th>Signed in</Th><Th className="text-right">For</Th>
                        <Th>Ended</Th><Th>On</Th>
                      </tr></thead>
                      <tbody>
                        {who.sessions.map((s) => (
                          <tr key={s.session_id + s.login_at}
                            className="border-t border-border-light">
                            <Td className="text-[11.5px] text-txt-muted whitespace-nowrap">
                              {when(s.login_at)}</Td>
                            <Td className="text-right text-[12px] font-mono tabular-nums">
                              {s.duration_minutes != null ? hours(s.duration_minutes) : "—"}</Td>
                            <Td>{s.is_active
                              ? <Chip tone="emerald">signed in</Chip>
                              : <span className="text-[11.5px] text-txt-muted">
                                  {(s.end_reason ?? "—").replace(/_/g, " ").toLowerCase()}
                                </span>}</Td>
                            <Td className="text-[11px] text-txt-light">
                              {[s.browser, s.os].filter(Boolean).join(" · ") || "—"}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
