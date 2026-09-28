"use client";
/**
 * Usage — who uses this dashboard, what they open, and what they change.
 *
 * THE NUMBER THAT MAKES THE OTHERS MEAN SOMETHING is the denominator. Reporting
 * on the 29 people who signed in reads well until you learn that 38 were given
 * the platform. The ones who never arrived are the finding; the 29 are the
 * consolation.
 *
 * THREE LOGS THAT HAD NEVER BEEN PUT TOGETHER. Sessions say somebody was here.
 * Page views say where they went. The event log says what they changed. Forty
 * sessions and no changes is somebody reading; six sessions and two hundred
 * changes is somebody working. Both are correct uses of a platform and no
 * single number tells them apart, which is why every row carries both.
 *
 * ONE DATE CONTROL, AND IT IS THE HEADER'S. This screen used to carry its own
 * range dropdown, so "Last 30 days" sat on a page whose header said 1–28
 * September. Two controls means two answers to "what am I looking at", and the
 * one nobody touched is the one they believe.
 *
 * ONE PAGE, NOT FIVE TABS. The sections read in order — how many people, when
 * they come, where they go, who they are, what they changed — and scrolling is
 * how you reach the next one. The bar at the top follows along and can also be
 * clicked; it says where you are rather than hiding four fifths of the answer
 * behind it.
 *
 * TWO APPLICATIONS. Twenty-five write to the shared session table. This screen
 * belongs to the mine and reports on MINES and IMOS; who reads the Leave
 * Management Application is somebody else's staff on somebody else's screen.
 *
 * WHAT THE NUMBERS ARE ALLOWED TO BE. Hours, counts and dates — quantities a
 * person can check. Where a threshold is used the threshold is printed beside
 * it. There is no engagement score: a number nobody can recompute gets quoted
 * in a meeting as though they could. And the screen never converts a low count
 * into a judgement about a person — somebody with a live role and no sessions
 * may have been given access they never needed, or never been shown the thing.
 * It names them. Whoever knows them says which.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, BarChart3, CalendarClock, Clock, Eye, Gauge,
  LayoutGrid, Loader2, LogOut, Monitor, MousePointerClick, Pencil, Trophy,
  TrendingUp, UserCheck, Users, X, ChevronRight, Wrench,
} from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";
import { matchesSearch } from "@/lib/search";
import { useDateFilter } from "@/contexts/useDateFilter";
import {
  Avatar, Card, CardHeader, Chip, EmptyRow, SortTh, StatBar, Td, Th, Tile,
  PageHeader, inputClass, sortRows, type SortWay, type Tone,
} from "@/components/minehub/ui";
import SearchSelect from "@/components/minehub/SearchSelect";

/* ── shapes ─────────────────────────────────────────────────────────────── */
interface Person {
  emp_id: string; name: string | null; department: string | null;
  role: string | null; roles?: string | null; provisioned?: boolean;
  designation?: string | null; active_days?: number; first_seen?: string | null;
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
interface Online {
  emp_id: string; emp_name: string | null; department: string | null;
  role: string | null; last_active_at: string; login_at: string;
  sessions: number;
}
interface Usage {
  app_source: string; from: string; to: string; days: number;
  headline: {
    sessions: number; people: number; minutes: number; avg_minutes: number;
    live: number; views: number; changes: number; screens: number;
    provisioned: number; dau: number; wau: number; mau: number;
    sessions_today: number; median_minutes: number; engaged_sessions: number;
  };
  people: Person[]; screens: Screen[]; online: Online[];
  heatmap: number[][];
  by_weekday_sessions: Record<string, { sessions: number; people: number }>;
  by_day_sessions: Record<string, { sessions: number; people: number }>;
  by_hour: Record<string, number>;
  by_day: { day: string; views: number; people: number }[];
  /** How many people are left out of every figure above. A count and no
   *  more: the reader needs to know the numbers exclude somebody, or they
   *  cannot reconcile them against the session log. They do not need to know
   *  who, and saying who published the platform's administrators to everybody
   *  holding usage.view. */
  excluded_count?: number;
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

/** A person, plus the two figures the leaderboard works out for itself.
 *
 *  `rank` is by total time and does NOT move when the table is sorted by
 *  something else — a number that changes meaning when you click a heading is
 *  worse than no number. `avg` exists as a field rather than only in the cell
 *  because a column that can be sorted needs a value to sort on. */
type Leader = Person & { rank: number; avg: number };

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Screens grouped the way somebody thinks about the platform. "Equipment 360
 *  had 284 views" is a fact about a page; "the registers had 431" is a fact
 *  about a part of the job. */
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

/** How often somebody came, in bands. The thresholds are printed beside each
 *  band, because a band whose rule is hidden is a judgement rather than a
 *  count. */
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
  { key: "never",   label: "Never",        rule: "a live role, no session",
    tone: "slate",   test: (n) => n === 0 },
];

/** The sections, in reading order. The nav follows the scroll through these. */
const SECTIONS = [
  { id: "adoption", label: "Adoption", icon: UserCheck },
  { id: "when",     label: "When",     icon: CalendarClock },
  { id: "where",    label: "Where",    icon: LayoutGrid },
  { id: "people",   label: "People",   icon: Users },
  { id: "changes",  label: "Changes",  icon: Pencil },
  { id: "sessions", label: "Sessions", icon: Monitor },
];

const FILL: Record<string, string> = {
  gold: "bg-gold", sky: "bg-sky", teal: "bg-teal", violet: "bg-violet",
  indigo: "bg-indigo", emerald: "bg-emerald", amber: "bg-amber",
  rose: "bg-rose", navy: "bg-navy", slate: "bg-txt-light",
};

/* ── small helpers ──────────────────────────────────────────────────────── */
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

/** A bar drawn in CSS. The fill classes are written out rather than built as
 *  `bg-${tone}`: Tailwind reads the source as text, so a class assembled at
 *  runtime is never generated and the bar loses its colour only in the
 *  production build, where nobody is looking for it. */
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

/** A section the nav can find, scroll to, and light up when you reach it. */
function Section({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <section id={`usage-${id}`} data-usage-section={id} className="scroll-mt-[150px]">
      {children}
    </section>
  );
}

/* ── the screen ─────────────────────────────────────────────────────────── */
export default function UsageSection() {
  // The range is the header's. There is no second date control on this page.
  const apiFrom = useDateFilter((s) => s.apiFrom);
  const apiTo = useDateFilter((s) => s.apiTo);
  const rangeLabel = useDateFilter((s) => s.label);

  const [app, setApp] = useState("MINES");
  /* The people who build and test this are out by default. They are not
     users, and counting them makes adoption look like something it is not.
     Named for what they do rather than what they hold: this screen has no
     business publishing who the administrators are, and "superadmin" beside a
     name invites everybody else to wonder whether their own access is lesser. */
  const [withBuilders, setWithBuilders] = useState(false);
  const [data, setData] = useState<Usage | null>(null);
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [band, setBand] = useState<string | null>(null);
  const [who, setWho] = useState<PersonDetail | null>(null);
  const [whoBusy, setWhoBusy] = useState(false);
  const [here, setHere] = useState<string>("adoption");
  const navLock = useRef(0);

  /* One sort per table. Each is {key, dir}; dir null means the table keeps the
     order the query gave it, which is itself meaningful — screens arrive most
     visited first, people by time spent. */
  const [sortPeople, setSortPeople] =
    useState<{ key: keyof Person | null; dir: SortWay | null }>({ key: null, dir: null });
  const [sortLead, setSortLead] =
    useState<{ key: keyof Leader | null; dir: SortWay | null }>({ key: "minutes", dir: "desc" });
  const [sortScreens, setSortScreens] =
    useState<{ key: keyof Screen | null; dir: SortWay | null }>({ key: null, dir: null });
  const [sortDept, setSortDept] =
    useState<{ key: string | null; dir: SortWay | null }>({ key: null, dir: null });
  const [sortSess, setSortSess] =
    useState<{ key: keyof Sess | null; dir: SortWay | null }>({ key: null, dir: null });

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const params = {
      day_from: apiFrom, day_to: apiTo, app_source: app,
      include_admins: withBuilders,
    };
    try {
      const [u, a] = await Promise.all([
        api.get("/usage", { params }),
        api.get("/usage/apps", { params: { day_from: apiFrom, day_to: apiTo } })
          .catch(() => ({ data: [] })),
      ]);
      setData(u.data ?? null);
      setApps(a.data ?? []);
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(d ?? "Could not read the usage logs.");
    } finally { setLoading(false); }
  }, [apiFrom, apiTo, app, withBuilders]);

  useEffect(() => { void load(); }, [load]);

  /* Which section the reader is in.
   *
   * Top-most visible wins, rather than "most visible": these sections are very
   * different heights, so a short one could never be the most-intersecting and
   * would never light up. Suppressed briefly after a click, because a smooth
   * scroll crosses every section on the way and the bar would flicker through
   * all of them before settling on the one asked for. */
  useEffect(() => {
    if (!data) return;
    const tops = new Map<string, number | null>();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const id = (e.target as HTMLElement).dataset.usageSection;
        if (id) tops.set(id, e.isIntersecting ? e.boundingClientRect.top : null);
      });
      if (Date.now() < navLock.current) return;
      const visible = SECTIONS.map((s) => s.id).filter((id) => tops.get(id) != null);
      if (visible.length) setHere(visible[0]!);
    }, { rootMargin: "-150px 0px -55% 0px", threshold: 0 });

    document.querySelectorAll("[data-usage-section]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [data]);

  const goTo = (id: string) => {
    navLock.current = Date.now() + 900;
    setHere(id);
    document.getElementById(`usage-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openPerson = async (emp: string) => {
    setWhoBusy(true); setWho(null);
    try {
      const r = await api.get(`/usage/person/${encodeURIComponent(emp)}`,
        { params: { day_from: apiFrom, day_to: apiTo, app_source: app } });
      setWho(r.data);
    } catch { setWho(null); } finally { setWhoBusy(false); }
  };

  const h = data?.headline;

  const people = useMemo(() => {
    let list = data?.people ?? [];
    if (band) {
      const b = BANDS.find((x) => x.key === band);
      if (b) list = list.filter((p) => b.test(p.sessions));
    }
    const found = list.filter((p) =>
      matchesSearch(q, [p.emp_id, p.name, p.department, p.role, p.roles]));
    return sortRows(found, sortPeople.key, sortPeople.dir);
  }, [data, q, band, sortPeople]);

  const bandCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const b of BANDS) {
      out[b.key] = (data?.people ?? []).filter((p) => b.test(p.sessions)).length;
    }
    return out;
  }, [data]);

  const never = useMemo(
    () => (data?.people ?? []).filter((p) => p.sessions === 0 && p.provisioned),
    [data]);

  /** The ten who spent the most time, with what they did while there. Ordered
   *  by a real quantity: hours are something a person can check and argue
   *  with, which a score is not. */
  const leaders = useMemo(() => {
    const been = (data?.people ?? []).filter((p) => p.sessions > 0);
    const ranked = [...been].sort((a, b) => b.minutes - a.minutes);
    // Rank is by time and stays by time however the table is then sorted: a
    // number that changes meaning when you click a column heading is worse
    // than no number at all.
    const withRank: Leader[] = ranked.map((p, i) => ({
      ...p, rank: i + 1,
      // Derived here rather than in the cell, because a column that can be
      // sorted has to have a value to sort ON.
      avg: p.sessions ? Math.round(p.minutes / p.sessions) : 0,
    }));
    return sortRows(withRank, sortLead.key, sortLead.dir);
  }, [data, sortLead]);
  const maxLeader = Math.max(1, ...leaders.map((p) => p.minutes));

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
    const rows = [...m.entries()].map(([name, v]) => ({
      ...v, name, share: v.total ? v.active / v.total : 0,
    })).sort((a, b) => b.sessions - a.sessions);
    return sortRows(rows, sortDept.key as keyof typeof rows[0], sortDept.dir);
  }, [data, sortDept]);

  const daySeries = useMemo(
    () => Object.entries(data?.by_day_sessions ?? {})
      .map(([day, v]) => ({ day, ...v })),
    [data]);
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

  const logoutPct = useMemo(() => {
    const e = data?.endings ?? {};
    const total = Object.values(e).reduce((a, b) => a + b, 0);
    return { pct: pct(e["LOGOUT"] ?? 0, total), n: e["LOGOUT"] ?? 0, total };
  }, [data]);

  return (
    <div className="py-6 space-y-5 max-w-[1500px]">
      <PageHeader
        lead="Us" rest="age" joined tone="gold" icon={BarChart3} tuck
        subtitle={`Who uses this platform, what they open and what they change — for ${rangeLabel}, the range set in the header.`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gold" />}
            {/* Two applications, not the twenty-five that share the session
                table. The rest belong to other departments. */}
            <SearchSelect value={app} onChange={setApp} narrow
              options={apps.map((a) => ({
                value: a.app_source, label: a.app_source,
                hint: `${a.people} people`,
                meta: <span className="text-txt-light">{a.sessions}</span>,
              }))} />
            <button type="button" onClick={() => setWithBuilders((v) => !v)}
              title={withBuilders
                ? "Counting the people who build and test this platform. Their sessions flatter every figure on the page."
                : "The people who build and test this platform are left out of every figure. Click to count them."}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px]
                          font-semibold ring-1 transition-colors
                          ${withBuilders
                            ? "bg-amber-bg text-amber ring-amber-ring"
                            : "bg-bg-section text-txt-muted ring-border-light hover:text-navy"}`}>
              <Wrench className="w-3.5 h-3.5" />
              {withBuilders ? "Counting build & test" : "Build & test excluded"}
            </button>
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

      {/* ── the four that matter ─────────────────────────────────────────── */}
      {h && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Using it" icon={UserCheck} tone="gold"
            value={<>{h.mau}<span className="text-txt-light text-[18px]"> / {h.provisioned}</span></>}
            hint={`${pct(h.mau, h.provisioned)}% of the people who were given it · ${
              Math.max(0, h.provisioned - h.mau)} have not signed in`} />
          <Tile label="Here now" icon={Activity}
            tone={h.live ? "emerald" : "slate"} value={h.live}
            hint={h.live ? "people, not browser tabs" : "nobody at the moment"} />
          <Tile label="Time on it" icon={Clock} tone="violet" value={hours(h.minutes)}
            hint={`${formatIndian(h.sessions)} sessions over ${data?.days ?? 0} days`} />
          <Tile label="Typical session" icon={Gauge} tone="sky"
            value={`${h.median_minutes}m`}
            hint={`median · mean ${h.avg_minutes}m${
              h.avg_minutes > h.median_minutes * 1.4
                ? " — a few long ones pull the mean up" : ""}`} />
        </div>
      )}

      {/* One chip per PERSON. Somebody with the dashboard open on their desk
          and again on a wall display is one colleague, not two. */}
      {data && data.online.length > 0 && (
        <Card>
          <div className="px-4 py-2.5 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase
                             tracking-[.14em] text-emerald shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald animate-pulse" />
              Here now
            </span>
            {data.online.map((o) => (
              <button key={o.emp_id} type="button"
                onClick={() => void openPerson(o.emp_id)}
                className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full
                           bg-bg-soft hover:bg-bg-section transition-colors">
                <Avatar name={o.emp_name ?? o.emp_id} size="sm" />
                <span className="text-[11.5px] font-semibold text-navy">
                  {o.emp_name ?? o.emp_id}
                </span>
                {o.sessions > 1 && (
                  <span className="text-[10px] text-txt-muted bg-bg-section rounded-full px-1.5"
                    title={`${o.sessions} tabs or devices open`}>
                    ×{o.sessions}
                  </span>
                )}
                <span className="text-[10px] text-txt-light">{ago(o.last_active_at)}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {data && (data.excluded_count ?? 0) > 0 && (
        <p className="text-[11.5px] text-txt-muted flex items-start gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-txt-light shrink-0 mt-0.5" />
          <span>
            These figures leave out{" "}
            <strong className="text-navy">
              {data.excluded_count} {data.excluded_count === 1 ? "person" : "people"}
              {" "}who build and test this platform
            </strong>
            {" "}— their time here is the work of making it, not of using it.
            Counting them roughly triples the sessions and the hours and tells
            you nothing about whether the mine has taken it up.
          </span>
        </p>
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
            value: h.engaged_sessions ? (h.views / h.engaged_sessions).toFixed(1) : "—",
            hint: `across ${h.engaged_sessions} that reached a screen` },
          { label: "Signed out", value: `${logoutPct.pct}%`, icon: LogOut, tone: "slate",
            hint: `${logoutPct.n} of ${logoutPct.total} — the rest timed out` },
        ]} />
      )}

      {/* ── the nav that follows the scroll ──────────────────────────────── */}
      {data && (
        // bg-bg-soft is the app's page ground, set on <body>. An invented
        // token resolves to nothing, and a sticky bar with no background lets
        // the content scroll straight through it.
        <div className="sticky top-[71px] z-[15] -mx-1 px-1 py-2 bg-bg-soft
                        border-b border-border-light">
          <div className="flex flex-wrap gap-1.5 p-1 bg-bg-section rounded-xl w-fit">
            {SECTIONS.map((s) => {
              const on = here === s.id;
              const Icon = s.icon;
              return (
                <button key={s.id} type="button" onClick={() => goTo(s.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12.5px]
                              font-semibold transition-all duration-150
                              ${on ? "bg-bg-base text-navy shadow-sm"
                                   : "text-txt-muted hover:text-navy hover:bg-bg-base/60"}`}>
                  <Icon className={`w-4 h-4 ${on ? "text-gold" : "text-txt-light"}`} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loading && !data && (
        <Card><div className="p-6 flex items-center gap-2 text-txt-muted text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading the logs…
        </div></Card>
      )}

      {!loading && data && (
        <div className="space-y-5">

          {/* ═══ ADOPTION ═════════════════════════════════════════════════ */}
          <Section id="adoption">
            <div className="space-y-5">
              <Card>
                <CardHeader icon={TrendingUp} tone="gold" subtitleOnIcon
                  title="Sessions, day by day"
                  subtitle="The tall bar is sessions; the block beneath it is how many different people those sessions belonged to. A tall bar over a thin block is one person working late, not the mine adopting a dashboard."
                  actions={peakDay && (
                    <Chip tone="gold">busiest {when(peakDay.day, 10)} · {peakDay.sessions}</Chip>
                  )} />
                <div className="px-4 py-4">
                  <div className="flex items-end gap-[2px] h-[130px]">
                    {daySeries.map((d) => (
                      <span key={d.day} className="flex-1 flex flex-col justify-end
                                                   items-center gap-[2px] group"
                        title={`${d.day} — ${d.sessions} sessions, ${d.people} people`}>
                        <span className="text-[9px] text-txt-light opacity-0
                                         group-hover:opacity-100 transition-opacity">
                          {d.sessions}
                        </span>
                        <span className="w-full rounded-t bg-gold/60 group-hover:bg-gold
                                         transition-colors"
                          style={{ height: `${(d.sessions / maxDaySessions) * 82}px` }} />
                        <span className="w-full rounded-t bg-teal"
                          style={{ height: `${Math.max(1, (d.people / maxDaySessions) * 82)}px` }} />
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

              <Card>
                <CardHeader icon={Users} tone="indigo" subtitleOnIcon
                  title={`How often people come · ${h?.provisioned ?? 0} hold a live role`}
                  subtitle="Everyone who has been given the platform, banded by how many sessions they had in this range. Each band prints its own rule, so the grouping can be checked rather than taken on trust." />

                {/* The whole register as one bar, so the proportions are a
                    shape rather than five numbers to hold in your head. */}
                <div className="px-4 pt-4">
                  <div className="flex h-3 rounded-full overflow-hidden bg-bg-section">
                    {BANDS.map((b) => {
                      const n = bandCounts[b.key] ?? 0;
                      if (!n) return null;
                      return (
                        <span key={b.key} className={FILL[b.tone]} title={`${b.label}: ${n}`}
                          style={{ width: `${pct(n, h?.provisioned || 1)}%` }} />
                      );
                    })}
                  </div>
                </div>

                <div className="px-4 py-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {BANDS.map((b) => (
                    <button key={b.key} type="button"
                      onClick={() => { setBand(band === b.key ? null : b.key); goTo("people"); }}
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

                {never.length > 0 && (
                  <div className="border-t border-border-light px-4 py-3">
                    <p className="text-[11.5px] text-txt-muted mb-2">
                      <strong className="text-navy">{never.length}</strong> hold a live
                      role and have not signed in during this range. That may be access
                      nobody needed, or somebody nobody showed — the log cannot tell
                      which, and neither can this screen.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {never.map((p) => (
                        <span key={p.emp_id} title={p.roles ?? ""}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-bg-soft
                                     text-txt-muted ring-1 ring-border-light">
                          {p.name ?? p.emp_id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </Card>

              <Card>
                <CardHeader icon={Trophy} tone="amber" subtitleOnIcon
                  title="Who spends the most time here"
                  subtitle="Rank is by hours — a quantity anybody can check, not a score. Every column sorts: 60 hours over 250 sessions is a quarter of an hour at a time, 60 over 12 is a working week, and only the columns beside the total tell them apart. Click a row for that person's record."
                  actions={<Chip tone="amber" dot={false}>{leaders.length} have signed in</Chip>} />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px]">
                    <thead><tr>
                      <Th className="w-8">#</Th>
                      {([
                        ["name", "Person", "left"], ["department", "Department", "left"],
                        ["sessions", "Logins", "right"], ["minutes", "Total time", "right"],
                        ["avg", "Avg", "right"], ["active_days", "Days", "right"],
                        ["views", "Screens", "right"], ["changes", "Changes", "right"],
                        ["last_seen", "Last seen", "left"],
                      ] as const).map(([key, label, align]) => (
                        <SortTh key={key} align={align}
                          active={sortLead.key === key} dir={sortLead.dir ?? undefined}
                          onSort={(d) => setSortLead({ key: d ? key : "minutes",
                                                       dir: d ?? "desc" })}>
                          {label}
                        </SortTh>
                      ))}
                      <Th />
                    </tr></thead>
                    <tbody>
                      {leaders.length === 0 && (
                        <EmptyRow colSpan={11}>Nobody has signed in during this range.</EmptyRow>
                      )}
                      {leaders.map((p) => (
                        <tr key={p.emp_id} onClick={() => void openPerson(p.emp_id)}
                          className="border-t border-border-light hover:bg-bg-soft/60
                                     cursor-pointer">
                          <Td>
                            <span className={`w-6 h-6 rounded-full text-[10.5px] font-bold
                                              flex items-center justify-center
                                              ${p.rank <= 3
                                                ? "bg-gold/15 text-gold-dark ring-1 ring-gold/25"
                                                : "bg-bg-section text-txt-light"}`}
                              title="rank by total time, whatever this table is sorted by">
                              {p.rank}
                            </span>
                          </Td>
                          <Td>
                            <span className="flex items-center gap-2.5">
                              <Avatar name={p.name ?? p.emp_id} size="sm" />
                              <span className="min-w-0">
                                <span className="block text-[12px] font-semibold text-navy truncate">
                                  {p.name ?? p.emp_id}</span>
                                <span className="block text-[10px] text-txt-light">
                                  {p.emp_id}{p.designation ? ` · ${p.designation}` : ""}</span>
                              </span>
                            </span>
                          </Td>
                          <Td className="text-[11px] text-txt-muted">{p.department ?? "—"}</Td>
                          <Td className="text-right text-[12px] font-mono tabular-nums">
                            {formatIndian(p.sessions)}</Td>
                          <Td className="text-right">
                            <span className="block text-[12px] font-mono tabular-nums text-navy">
                              {hours(p.minutes)}</span>
                            <span className="block mt-0.5">
                              <Bar value={p.minutes} max={maxLeader} tone="amber" /></span>
                          </Td>
                          <Td className="text-right text-[11.5px] font-mono tabular-nums
                                         text-txt-muted" title="average session">
                            {p.sessions ? `${Math.round(p.minutes / p.sessions)}m` : "—"}</Td>
                          <Td className="text-right text-[11.5px] font-mono tabular-nums
                                         text-txt-muted" title="separate days they came">
                            {p.active_days || "—"}</Td>
                          <Td className="text-right text-[11.5px] font-mono tabular-nums
                                         text-txt-muted">{formatIndian(p.views)}</Td>
                          <Td className="text-right text-[11.5px] font-mono tabular-nums">
                            {p.changes
                              ? <span className="text-violet font-bold">
                                  {formatIndian(p.changes)}</span>
                              : <span className="text-txt-light">—</span>}</Td>
                          <Td className="text-[11px] text-txt-muted whitespace-nowrap">
                            {ago(p.last_seen)}</Td>
                          <Td className="w-6 text-txt-light">
                            <ChevronRight className="w-3.5 h-3.5" /></Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </Section>

          {/* ═══ WHEN ═════════════════════════════════════════════════════ */}
          <Section id="when">
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
                            <span key={hr} className="flex-1 aspect-square rounded-[3px] min-w-[9px]"
                              title={`${d} ${String(hr).padStart(2, "0")}:00 — ${n} session${
                                n === 1 ? "" : "s"}`}
                              style={{
                                backgroundColor: n
                                  ? `rgba(59,130,246,${0.15 + (n / maxHeat) * 0.85})`
                                  : "#eef2f7",
                                boxShadow: on ? "0 0 0 2px #c8960c" : undefined,
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
                    const v = data.by_weekday_sessions[String(i)] ?? { sessions: 0, people: 0 };
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
          </Section>

          {/* ═══ WHERE ════════════════════════════════════════════════════ */}
          <Section id="where">
            <div className="space-y-5">
              <div className="grid lg:grid-cols-2 gap-5 items-start">
                <Card>
                  <CardHeader icon={LayoutGrid} tone="sky" subtitleOnIcon
                    title="Which part of the platform"
                    subtitle="Screens grouped the way the work is grouped. One fact about the registers is more useful than five facts about five pages." />
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
                    subtitle="Active against everyone on the register in that department. A department at 0 of 3 is a conversation; one at 3 of 3 is a reference." />
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead><tr>
                        {([
                          ["name", "Department", "left"], ["active", "Using", "right"],
                          ["share", "Share", "left"], ["sessions", "Sessions", "right"],
                          ["minutes", "Time", "right"],
                        ] as const).map(([key, label, align]) => (
                          <SortTh key={key} align={align}
                            active={sortDept.key === key} dir={sortDept.dir ?? undefined}
                            onSort={(d) => setSortDept({ key: d ? key : null, dir: d })}>
                            {label}
                          </SortTh>
                        ))}
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

              <Card>
                <CardHeader icon={LayoutGrid} tone="teal" subtitleOnIcon
                  title="Every screen"
                  subtitle="Views say it was reached; people says how widely; the time says whether anybody stayed. A screen opened often by three people is not the same as one opened often by thirty." />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px]">
                    <thead><tr>
                      <SortTh active={sortScreens.key === "screen"} dir={sortScreens.dir ?? undefined}
                        onSort={(d) => setSortScreens({ key: d ? "screen" : null, dir: d })}>
                        Screen</SortTh>
                      <SortTh align="right" active={sortScreens.key === "views"}
                        dir={sortScreens.dir ?? undefined}
                        onSort={(d) => setSortScreens({ key: d ? "views" : null, dir: d })}>
                        Views</SortTh>
                      <Th>Share</Th>
                      <SortTh align="right" active={sortScreens.key === "people"}
                        dir={sortScreens.dir ?? undefined}
                        onSort={(d) => setSortScreens({ key: d ? "people" : null, dir: d })}>
                        People</SortTh>
                      <SortTh align="right" active={sortScreens.key === "avg_seconds"}
                        dir={sortScreens.dir ?? undefined}
                        onSort={(d) => setSortScreens({ key: d ? "avg_seconds" : null, dir: d })}>
                        Avg stay</SortTh>
                      <SortTh align="right" active={sortScreens.key === "total_seconds"}
                        dir={sortScreens.dir ?? undefined}
                        onSort={(d) => setSortScreens({ key: d ? "total_seconds" : null, dir: d })}>
                        Total</SortTh>
                    </tr></thead>
                    <tbody>
                      {sortRows(data.screens, sortScreens.key, sortScreens.dir).map((s, i) => (
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
            </div>
          </Section>

          {/* ═══ PEOPLE ═══════════════════════════════════════════════════ */}
          <Section id="people">
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
                    {([
                      ["name", "Person", "left"], ["roles", "Role", "left"],
                      ["sessions", "Sessions", "right"], ["minutes", "Time", "right"],
                      ["active_days", "Days", "right"], ["views", "Screens", "right"],
                      ["changes", "Changes", "right"], ["last_seen", "Last seen", "left"],
                    ] as const).map(([key, label, align]) => (
                      <SortTh key={key} align={align}
                        active={sortPeople.key === key}
                        dir={sortPeople.dir ?? undefined}
                        onSort={(d) => setSortPeople({ key: d ? key : null, dir: d })}>
                        {label}
                      </SortTh>
                    ))}
                    <Th />
                  </tr></thead>
                  <tbody>
                    {people.length === 0 && <EmptyRow colSpan={9}>Nobody matches.</EmptyRow>}
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
                        <Td className="text-right text-[12px] font-mono tabular-nums text-txt-muted"
                          title="separate days they signed in">
                          {p.active_days || "—"}
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
                        <Td className="w-6 text-txt-light">
                          <ChevronRight className="w-3.5 h-3.5" />
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
          </Section>

          {/* ═══ CHANGES ══════════════════════════════════════════════════ */}
          <Section id="changes">
            <div className="space-y-5">
              <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 items-start">
                <Card>
                  <CardHeader icon={Pencil} tone="violet" title="By kind" subtitleOnIcon
                    subtitle="What sort of thing is being altered, and by how many different people." />
                  <div className="overflow-x-auto max-h-[520px]">
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
                  <div className="max-h-[520px] overflow-auto">
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
          </Section>

          {/* ═══ SESSIONS ═════════════════════════════════════════════════ */}
          <Section id="sessions">
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
                    {([
                      ["emp_name", "Person", "left"], ["login_at", "Signed in", "left"],
                      ["duration_minutes", "For", "right"], ["end_reason", "Ended", "left"],
                      ["browser", "On", "left"], ["ip_address", "From", "left"],
                    ] as const).map(([key, label, align]) => (
                      <SortTh key={key} align={align}
                        active={sortSess.key === key} dir={sortSess.dir ?? undefined}
                        onSort={(d) => setSortSess({ key: d ? key : null, dir: d })}>
                        {label}
                      </SortTh>
                    ))}
                  </tr></thead>
                  <tbody>
                    {sortRows(data.recent_sessions, sortSess.key, sortSess.dir).map((s) => (
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
          </Section>
        </div>
      )}

      {/* ═══ one person ═══════════════════════════════════════════════════ */}
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
