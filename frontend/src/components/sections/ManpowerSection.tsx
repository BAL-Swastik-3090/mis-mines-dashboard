"use client";
/**
 * Manpower — the people side of the mine, on its own screen.
 *
 * It was a tab inside Equipment 360, wedged between the equipment register
 * and the machine alerts. That made sense when the operator register held
 * eleven people and existed mainly so a machine could be handed to somebody.
 * It holds 211 now, covering tipper drivers, fitters, welders, a time keeper
 * and a gardener, and most of the questions asked of it — how many, of what
 * trade, how old, how long served, who is cleared for what — have nothing to
 * do with any particular machine.
 *
 * Three tabs, because there are three jobs:
 *
 *   REGISTER    who is on strength, and the record behind each of them.
 *   ASSESSMENT  who is cleared to run what, who is overdue, who has never
 *               been looked at. Its own screen rather than a button on a row,
 *               because assessing is a morning's work for one person and a row
 *               at a time is the wrong shape for it.
 *   ANALYTICS   the shape of the workforce, and the gaps in it.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarCheck, Grid3x3, HardHat, Plus, ShieldCheck, Users } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import { Button, Card, PageHeader, Tabs, type Tone } from "@/components/minehub/ui";
import { Factory, SlidersHorizontal, X } from "lucide-react";
import ColumnFilter, { optionsFrom } from "@/components/minehub/ColumnFilter";
export interface ManpowerFilter {
  plantId: string; plantName: string | null;
  employer: string; department: string; trade: string; worker: string;
}
import OperatorPanel from "@/components/minehub/OperatorPanel";
import AssessmentPanel from "@/components/minehub/AssessmentPanel";
import ManpowerAnalytics from "@/components/minehub/ManpowerAnalytics";
import AttendancePanel from "@/components/minehub/AttendancePanel";

type TabId = "register" | "capability" | "attendance" | "assessment" | "analytics";

const TABS: { id: TabId; label: string; icon: React.ElementType; tone: Tone; hint: string }[] = [
  { id: "register", label: "Register", icon: Users, tone: "emerald",
    hint: "Everyone on strength at the mine, whatever they do — operators, trades, supervision and support." },
  // Lifted out of the register, which had its own Register/Capability switcher
  // directly beneath this strip — two tab bars, both starting with the word
  // Register, one inside the other.
  { id: "capability", label: "Capability", icon: Grid3x3, tone: "indigo",
    hint: "The grid: every person against every machine class, and the level they hold on each." },
  // Read-only for now: it shows what the gate readers recorded and stores
  // nothing, because how much history to hold and what a missing punch means
  // are decisions the mine has not taken yet.
  { id: "attendance", label: "Activity", icon: CalendarCheck, tone: "sky",
    hint: "What the gate readers recorded — punch behaviour day by day, and the month at a glance. Not an attendance sheet: a missing punch is a gap in the record, not a claim that somebody was absent." },
  { id: "assessment", label: "Assessment", icon: ShieldCheck, tone: "violet",
    hint: "Who is cleared to run what, who is overdue, and who has never been assessed at all." },
  { id: "analytics", label: "Analytics", icon: BarChart3, tone: "sky",
    hint: "The shape of the workforce — trade, age, service, coverage — and where the gaps are." },
];

export default function ManpowerSection() {
  const can = useAuth((s) => s.can);
  const mayManage = can("platform.operators.manage");

  const [tab, setTab] = useState<TabId>("register");
  const [addOpen, setAddOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  // Bumped whenever something is written, so a tab that was not on screen at
  // the time reloads when you next open it rather than showing yesterday.
  const [changed, setChanged] = useState(0);

  // Plant belongs to the screen, not to one tab. It used to be a select that
  // only the Register and Capability tabs drew, so narrowing to a plant and
  // then opening Assessment silently showed you everybody again — the filter
  // looked like it was still applied because the tab strip had not moved.
  const [plants, setPlants] = useState<
    { plant_id: number; code: string; name: string; operators: number }[]>([]);
  const [plantId, setPlantId] = useState("");
  const plantName = plants.find((p) => String(p.plant_id) === plantId)?.name ?? null;

  // The rest of the bar — contractor, department, trade, person. One set for
  // the whole screen, the same as plant: asking "what about Automobile?" is
  // one question, and re-answering it on each of five tabs is how two of the
  // five end up showing something else.
  const [by, setBy] = useState({ employer: "", department: "", trade: "", worker: "" });
  const set = (k: keyof typeof by) => (v: string) => setBy((b) => ({ ...b, [k]: v }));
  const narrowed = Boolean(plantId) || Object.values(by).some(Boolean);

  // The options are master data, not whatever rows happen to be loaded.
  // Contractors come from the party master, departments from org_unit, trades
  // from the trade master, people from the register — which is the party
  // master for persons. Deriving them from the visible rows instead made the
  // bar change shape as you used it, and hid a contractor or a trade that is
  // real but currently unstaffed.
  const [masters, setMasters] = useState<{
    parties: { party_id: number; display_name: string; org_category: string | null }[];
    orgUnits: { org_unit_id: number; name: string }[];
    trades: { trade_id: number; name: string; people: number }[];
    people: { display_name: string; employer: string | null;
              department: string | null; trade: string | null }[];
  }>({ parties: [], orgUnits: [], trades: [], people: [] });

  useEffect(() => {
    const nil = { data: [] };
    void Promise.all([
      api.get("/minehub/parties", { params: { party_type: "ORGANISATION" } }).catch(() => nil),
      api.get("/minehub/org-units").catch(() => nil),
      api.get("/minehub/trades").catch(() => nil),
      api.get("/operators", { params: plantId ? { plant_id: plantId } : {} }).catch(() => nil),
    ]).then(([pa, ou, tr, op]) => setMasters({
      parties: pa.data ?? [], orgUnits: ou.data ?? [],
      trades: tr.data ?? [], people: op.data ?? [],
    }));
  }, [plantId, changed]);

  const menus = useMemo(() => {
    const { parties, orgUnits, trades, people } = masters;
    // Counted against who is actually on strength right now, so a master row
    // with nobody behind it still appears but says so.
    const tally = (get: (o: typeof people[number]) => string | null) => {
      const m = new Map<string, number>();
      for (const o of people) {
        const k = (get(o) ?? "").trim();
        if (k) m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    };
    const byEmployer = tally((o) => o.employer);
    const byDept = tally((o) => o.department);
    const byTrade = tally((o) => o.trade);
    const opt = (name: string, count: number) => ({ value: name, label: name, count });
    return {
      // Only organisations that can actually employ somebody here.
      employer: parties
        .filter((x) => x.org_category === "CONTRACTOR" || x.org_category === "INTERNAL")
        .map((x) => opt(x.display_name, byEmployer.get(x.display_name) ?? 0)),
      department: orgUnits.map((x) => opt(x.name, byDept.get(x.name) ?? 0)),
      trade: trades.map((x) => opt(x.name, byTrade.get(x.name) ?? x.people ?? 0)),
      worker: optionsFrom(people, (o) => o.display_name, (v) => v, null),
    };
  }, [masters]);

  const people = masters.people;

  const filter: ManpowerFilter = { plantId, plantName, ...by };
  useEffect(() => {
    void api.get("/minehub/plants")
      // Only plants that actually have people. Five plants exist as SAP
      // master data but every workman is posted to Kaliapani, so offering
      // the other four is offering four ways to empty the screen. They
      // appear on their own the day somebody is posted to them.
      .then((r) => setPlants((r.data ?? [])
        .filter((p: { operators?: number }) => (p.operators ?? 0) > 0)))
      .catch(() => setPlants([]));
  }, []);
  const [overdue, setOverdue] = useState<number | null>(null);

  const active = useMemo(() => TABS.find((t) => t.id === tab), [tab]);

  const loadOverdue = useCallback(async () => {
    try {
      const r = await api.get("/operators/meta/due");
      setOverdue((r.data ?? []).filter((d: { days_left: number }) => d.days_left <= 0).length);
    } catch { setOverdue(null); }
  }, []);

  useEffect(() => { void loadOverdue(); }, [loadOverdue, changed]);

  const tabs = TABS.map((t) =>
    t.id === "assessment" && overdue ? { ...t, label: `Assessment · ${overdue}` } : t);

  // With a profile open, the banner and the tab strip are a hundred vertical
  // pixels telling you where you already are, pushing the fields being filled
  // in below the fold. The sheet carries its own way back.
  return (
    <div className={`py-6 space-y-5 ${formOpen ? "max-w-[1600px]" : "max-w-[1500px]"}`}>
      {!formOpen && (
        <PageHeader
          lead="Man" rest="power" joined tone="emerald" icon={HardHat}
          subtitle={active?.hint} tuck
          actions={
            tab === "register" && mayManage ? (
              <Button variant="primary" size="lg" onClick={() => setAddOpen(true)}>
                <Plus className="w-4 h-4" /> Add a worker
              </Button>
            ) : null
          } />
      )}

      {!formOpen && (
        <>
          <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as TabId)} />

          {/* One bar for the screen. Every tab below reads it. */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border
                          border-border-light bg-bg-base px-3 py-2 shadow-sm">
            <SlidersHorizontal className="w-3.5 h-3.5 text-txt-light shrink-0"
              aria-hidden />
            <span className="text-[11px] font-semibold text-txt-light mr-1">
              Narrow every tab
            </span>
            {plants.length > 1 && (
              <label className="flex items-center gap-1.5 text-[12px] text-txt-muted">
                <Factory className="w-3.5 h-3.5 text-txt-light" />
                <select value={plantId} onChange={(e) => setPlantId(e.target.value)}
                  className="bg-bg-base border border-border rounded-lg px-2.5 py-1.5
                             text-[12px] font-semibold text-txt-secondary
                             focus:outline-none focus:border-gold">
                  <option value="">All plants</option>
                  {plants.map((p) => (
                    <option key={p.plant_id} value={p.plant_id}>
                      {p.code} · {p.name} · {p.operators}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ColumnFilter variant="control" label="Contractor" allLabel="All contractors"
              value={by.employer} options={menus.employer} onChange={set("employer")} />
            <ColumnFilter variant="control" label="Department" allLabel="All departments"
              value={by.department} options={menus.department} onChange={set("department")} />
            <ColumnFilter variant="control" label="Trade" allLabel="All trades"
              value={by.trade} options={menus.trade} onChange={set("trade")} />
            <ColumnFilter variant="control" label="Worker" allLabel="Everybody"
              value={by.worker} options={menus.worker} onChange={set("worker")} />
            {narrowed && (
              <button type="button"
                onClick={() => { setPlantId("");
                                 setBy({ employer: "", department: "", trade: "", worker: "" }); }}
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold
                           text-gold-dark hover:underline underline-offset-2">
                <X className="w-3 h-3" /> Clear
              </button>
            )}
            <span className="ml-auto text-[11.5px] text-txt-light tabular-nums">
              {people.length} on strength
            </span>
          </div>
        </>
      )}

      {(tab === "register" || tab === "capability") && (
        <OperatorPanel view={tab} addOpen={addOpen} onAddOpenChange={setAddOpen}
          onFormOpenChange={setFormOpen} filter={filter}
          onChanged={() => setChanged((n) => n + 1)} />
      )}

      {tab === "assessment" && (
        <AssessmentPanel key={changed} filter={filter}
          onChanged={() => setChanged((n) => n + 1)} />
      )}

      {tab === "attendance" && <AttendancePanel filter={filter} />}

      {tab === "analytics" && <ManpowerAnalytics key={changed} filter={filter} />}

      {!mayManage && tab === "register" && (
        <Card>
          <p className="px-5 py-3 text-[12px] text-txt-muted">
            You can read the register but not change it. An Access Manager
            grants <code>platform.operators.manage</code>.
          </p>
        </Card>
      )}
    </div>
  );
}
