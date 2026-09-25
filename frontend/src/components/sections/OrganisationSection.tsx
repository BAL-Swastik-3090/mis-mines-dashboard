"use client";
/**
 * Who holds what.
 *
 * The platform has known departments since day one, as a dropdown on a form.
 * It has never known who runs one. Every module that has needed an accountable
 * person so far has settled for a typed-in name, and the material and
 * inventory work cannot: its whole premise is that the portal can tell a user
 * "this is held against your department" and can escalate an unanswered case
 * to the head of it. That needs a department, a post and a person, each of
 * them a row.
 *
 * ONE DELIBERATE PIECE OF FRICTION. The SAP import proposes a head from grade
 * seniority. A proposal is drawn in amber and the word "proposed", and the
 * department is still counted as having no head until somebody confirms it.
 * The temptation is to show the proposal as the answer — it is right most of
 * the time, and the screen would look finished. It would also put a name
 * against an escalation that nobody chose, and a wrong name is worse than a
 * blank one because a blank asks to be filled.
 */
import SearchSelect from "@/components/minehub/SearchSelect";
import { matchesSearch } from "@/lib/search";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2, Check, ChevronRight, CircleAlert, Crown, Loader2, Network,
  Package, Pencil, Plus, Search, ShieldQuestion, UserRound, Users, X,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import {
  Alert, Avatar, Button, Card, CardHeader, Chip, EmptyRow, Field, PageHeader,
  StatBar, Tabs, Td, Th, inputClass, type Tone,
} from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";

/* ── What the API sends ──────────────────────────────────────────────────── */
interface ProposedHead {
  name: string; emp_id: string | null; note: string | null; holding_id: number;
}
interface Unit {
  org_unit_id: number; code: string; name: string; parent_id: number | null;
  unit_type: string; status: string; purpose: string | null; sort_order: number;
  plant_code: string | null; plant_name: string | null;
  people: number; posts: number; accountabilities: number;
  post_id: number | null; post_title: string | null;
  head_name: string | null; head_emp_id: string | null; head_confirmed: boolean;
  proposed_head: ProposedHead | null;
  sap_labels: string | null;
}
interface Post {
  post_id: number; title: string; post_type: string; status: string;
  remarks: string | null; reports_to_title: string | null; reports_to_unit: string | null;
  holding_id: number | null; emp_id: string | null; basis: string | null;
  valid_from: string | null; source: string | null; derived_note: string | null;
  confirmed_by: string | null; confirmed_at: string | null;
  party_id: number | null; person: string | null; email: string | null;
  phone: string | null; designation: string | null;
}
interface Member {
  party_id: number; name: string; designation: string | null;
  employment_type: string | null; since: string | null; emp_id: string | null;
  employer: string | null;
}
interface Accountability {
  accountability_id: number; domain: string; scope_system: string | null;
  scope_ref: string | null; description: string | null; status: string;
  post_id: number | null; post_title: string | null;
}
interface UnitDetail {
  unit: Unit & { parent_name: string | null };
  posts: Post[]; people: Member[]; accountability: Accountability[];
  history: { holding_id: number; post_title: string; person: string; basis: string;
             valid_from: string; valid_to: string; confirmed_by: string | null }[];
  labels: { org_unit_source_id: number; system: string; external_label: string; note: string | null }[];
}
interface Gaps {
  no_head: { org_unit_id: number; name: string; unit_type: string; people: number }[];
  unconfirmed: { holding_id: number; org_unit_id: number; unit: string; post: string;
                 person: string; emp_id: string | null; derived_note: string | null }[];
  no_material_owner: { org_unit_id: number; name: string; people: number }[];
  unscoped_material: { accountability_id: number; org_unit_id: number; unit: string;
                       description: string | null }[];
  unmapped_to_sap: { org_unit_id: number; name: string }[];
}
interface PersonHit {
  party_id: number; name: string; emp_id: string | null;
  designation: string | null; unit: string | null;
}

/* ── Vocabulary ──────────────────────────────────────────────────────────── */
const POST_LABEL: Record<string, string> = {
  SITE_HEAD: "Head of site",
  FUNCTIONAL_HEAD: "Functional head",
  DEPARTMENT_HEAD: "Head of department",
  SECTION_INCHARGE: "Section in-charge",
  MATERIAL_CUSTODIAN: "Material custodian",
  MEMBER: "Member",
};
const POST_TONE: Record<string, Tone> = {
  SITE_HEAD: "gold", FUNCTIONAL_HEAD: "violet", DEPARTMENT_HEAD: "indigo",
  SECTION_INCHARGE: "teal", MATERIAL_CUSTODIAN: "amber", MEMBER: "slate",
};
/* Material first: it is the domain the inventory work reads, and the one most
   departments will be filling in. */
const DOMAINS = ["MATERIAL", "EQUIPMENT", "MANPOWER", "PRODUCTION",
                 "SAFETY", "STATUTORY", "BUDGET", "DATA"] as const;
const DOMAIN_LABEL: Record<string, string> = {
  MATERIAL: "Material & stores", EQUIPMENT: "Equipment", MANPOWER: "Manpower",
  PRODUCTION: "Production", SAFETY: "Safety", STATUTORY: "Statutory",
  BUDGET: "Budget", DATA: "Data",
};
const SCOPE_SYSTEMS = [
  { value: "", label: "Not tied to a source system yet" },
  { value: "SAP_COST_CENTRE", label: "SAP cost centre" },
  { value: "SAP_STORAGE_LOC", label: "SAP storage location" },
  { value: "SAP_PLANT_SECTION", label: "SAP plant section" },
  { value: "SAP_WBS", label: "SAP WBS element" },
  { value: "MINEHUB_ASSET", label: "MineHub asset register" },
  { value: "MINEHUB_LOCATION", label: "MineHub location" },
];

function errorOf(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback;
}

type Tab = "structure" | "attention" | "accountability";

/* ════════════════════════════════════════════════════════════════════════ */
export default function OrganisationSection() {
  const can = useAuth((s) => s.can);
  const mayManage = can("org.manage");

  const [tab, setTab] = useState<Tab>("structure");
  const [units, setUnits] = useState<Unit[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [gaps, setGaps] = useState<Gaps | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<UnitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [u, g] = await Promise.all([
        api.get("/organisation/units"),
        api.get("/organisation/gaps"),
      ]);
      setUnits(u.data?.units ?? []);
      setSummary(u.data?.summary ?? {});
      setGaps(g.data ?? null);
    } catch (e) {
      setError(errorOf(e, "Could not load the organisation."));
    } finally { setLoading(false); }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setDetailBusy(true);
    try {
      const r = await api.get(`/organisation/units/${id}`);
      setDetail(r.data);
    } catch (e) {
      setError(errorOf(e, "Could not open that department."));
    } finally { setDetailBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selected) void loadDetail(selected); else setDetail(null); }, [selected, loadDetail]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  const refresh = useCallback(async () => {
    await load();
    if (selected) await loadDetail(selected);
  }, [load, loadDetail, selected]);

  /* The tree, drawn from parent_id. Units whose parent is missing or inactive
     are rendered at the root rather than dropped — an orphan is a thing to fix,
     not a thing to hide. */
  const roots = useMemo(() => {
    const ids = new Set(units.map((u) => u.org_unit_id));
    const q = filter.trim().toLowerCase();
    const matches = (u: Unit) =>
      matchesSearch(q, [u.name, u.code, u.sap_labels, u.head_name,
                  u.proposed_head?.name]);

    const keep = new Set<number>();
    units.forEach((u) => {
      if (!matches(u)) return;
      keep.add(u.org_unit_id);
      // Keep the ancestors so a match never appears detached from its branch.
      let p = u.parent_id;
      let hops = 0;
      while (p && ids.has(p) && hops++ < 20) {
        keep.add(p);
        p = units.find((x) => x.org_unit_id === p)?.parent_id ?? null;
      }
    });

    const shown = units.filter((u) => keep.has(u.org_unit_id));
    const childrenOf = (id: number | null) =>
      shown.filter((u) => (u.parent_id && ids.has(u.parent_id) ? u.parent_id : null) === id);
    return { childrenOf, count: shown.length };
  }, [units, filter]);

  const stats = [
    { label: "Departments", value: units.filter((u) => u.unit_type !== "SITE").length,
      tone: "navy" as Tone, icon: Building2 },
    { label: "People placed", value: summary.people ?? 0, tone: "indigo" as Tone, icon: Users,
      hint: "On an open employment row" },
    { label: "Heads confirmed", value: summary.with_head ?? 0, tone: "emerald" as Tone, icon: Crown },
    { label: "Heads proposed", value: summary.proposed ?? 0, tone: "amber" as Tone,
      icon: ShieldQuestion, hint: "Waiting for somebody to agree",
      onClick: () => setTab("attention"), title: "Show what needs confirming" },
    { label: "No head at all", value: summary.vacant ?? 0, tone: "rose" as Tone, icon: CircleAlert,
      onClick: () => setTab("attention"), title: "Show the departments with nobody" },
    { label: "Material owners", value: units.filter((u) => u.accountabilities > 0).length,
      tone: "teal" as Tone, icon: Package, hint: "Departments answering for stock" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        lead="Organisation" rest="Structure" joined={false} tone="indigo" icon={Network}
        tuck
        subtitle={
          "Who runs each department, and what each department answers for. Read from the "
          + "SAP employee master and kept here, because SAP records which department pays "
          + "a person and not which person is accountable for what the department holds. "
          + "A head the import guessed is shown as proposed until somebody confirms it."
        }
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <StatBar items={stats} />

      <Tabs<Tab>
        value={tab} onChange={setTab}
        tabs={[
          { id: "structure", label: "Structure", icon: Network, tone: "indigo" },
          { id: "attention", label: "Needs an answer", icon: CircleAlert, tone: "amber" },
          { id: "accountability", label: "What each holds", icon: Package, tone: "teal" },
        ]}
      />

      {loading ? (
        <Card><div className="py-20 flex items-center justify-center gap-2 text-txt-light text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading the organisation…
        </div></Card>
      ) : tab === "structure" ? (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] gap-5 items-start">
          <Card>
            <CardHeader
              title="Departments" tone="indigo" icon={Building2}
              subtitle={`${roots.count} shown`}
              actions={mayManage ? <NewUnit units={units} onDone={(msg) => { setNotice(msg); void load(); }} /> : undefined}
            />
            <div className="px-4 pt-3 pb-2 border-b border-border-light">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-txt-light absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={filter} onChange={(e) => setFilter(e.target.value)}
                  placeholder="Department, code, SAP label or a person's name"
                  className={`${inputClass} pl-8`}
                />
              </div>
            </div>
            <div className="max-h-[640px] overflow-y-auto scrollbar-thin py-1">
              <Branch
                childrenOf={roots.childrenOf} parent={null} depth={0}
                selected={selected} onSelect={setSelected}
              />
              {roots.count === 0 && (
                <p className="px-4 py-12 text-center text-[13px] text-txt-light">
                  Nothing matches “{filter}”.
                </p>
              )}
            </div>
          </Card>

          <UnitPanel
            detail={detail} busy={detailBusy} mayManage={mayManage}
            onChanged={(msg) => { setNotice(msg); void refresh(); }}
            onError={setError}
          />
        </div>
      ) : tab === "attention" ? (
        <Attention
          gaps={gaps} mayManage={mayManage}
          onOpen={(id) => { setSelected(id); setTab("structure"); }}
          onChanged={(msg) => { setNotice(msg); void refresh(); }}
          onError={setError}
        />
      ) : (
        <AccountabilityMatrix units={units} onOpen={(id) => { setSelected(id); setTab("structure"); }} />
      )}
    </div>
  );
}

/* ── The tree ────────────────────────────────────────────────────────────── */
function Branch({ childrenOf, parent, depth, selected, onSelect }: {
  childrenOf: (id: number | null) => Unit[];
  parent: number | null; depth: number;
  selected: number | null; onSelect: (id: number) => void;
}) {
  const rows = childrenOf(parent);
  if (!rows.length) return null;
  return (
    <>
      {rows.map((u) => {
        const on = u.org_unit_id === selected;
        return (
          <React.Fragment key={u.org_unit_id}>
            <button
              onClick={() => onSelect(u.org_unit_id)}
              style={{ paddingLeft: 12 + depth * 16 }}
              className={`w-full text-left pr-3 py-2 flex items-center gap-2.5 transition-colors
                          ${on ? "bg-indigo-bg" : "hover:bg-bg-section"}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0
                                ${u.head_name ? "bg-emerald" : u.proposed_head ? "bg-amber" : "bg-rose"}`} />
              <span className="min-w-0 flex-1">
                <span className={`block text-[13px] font-semibold truncate
                                  ${on ? "text-navy" : "text-txt-primary"}`}>
                  {u.name}
                </span>
                <span className="block text-[11px] text-txt-light truncate">
                  {u.head_name
                    ? u.head_name
                    : u.proposed_head
                      ? `${u.proposed_head.name} — proposed`
                      : u.unit_type === "SITE" ? "No site head recorded" : "No head recorded"}
                </span>
              </span>
              <span className="text-[11px] text-txt-light tabular-nums shrink-0">{u.people}</span>
              <ChevronRight className={`w-3.5 h-3.5 shrink-0 ${on ? "text-indigo" : "text-txt-light"}`} />
            </button>
            <Branch childrenOf={childrenOf} parent={u.org_unit_id} depth={depth + 1}
                    selected={selected} onSelect={onSelect} />
          </React.Fragment>
        );
      })}
    </>
  );
}

/* ── One department ──────────────────────────────────────────────────────── */
function UnitPanel({ detail, busy, mayManage, onChanged, onError }: {
  detail: UnitDetail | null; busy: boolean; mayManage: boolean;
  onChanged: (msg: string) => void; onError: (msg: string) => void;
}) {
  const [holderFor, setHolderFor] = useState<Post | null>(null);
  const [addingPost, setAddingPost] = useState(false);
  const [addingAcc, setAddingAcc] = useState(false);
  const [editingPurpose, setEditingPurpose] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [confirming, setConfirming] = useState<number | null>(null);

  useEffect(() => { setPurpose(detail?.unit.purpose ?? ""); setEditingPurpose(false); }, [detail]);

  if (!detail) {
    return (
      <Card>
        <div className="py-24 text-center px-6">
          <Network className="w-8 h-8 text-txt-light mx-auto mb-3" />
          <p className="text-[13px] text-txt-muted">
            Pick a department to see who runs it, who is in it, and what it answers for.
          </p>
        </div>
      </Card>
    );
  }

  const u = detail.unit;

  const confirm = async (holdingId: number) => {
    setConfirming(holdingId);
    try {
      await api.post(`/organisation/holdings/${holdingId}/confirm`);
      onChanged("Confirmed. This person is now the accountable head on record.");
    } catch (e) { onError(errorOf(e, "Could not confirm that.")); }
    finally { setConfirming(null); }
  };

  const savePurpose = async () => {
    try {
      await api.patch(`/organisation/units/${u.org_unit_id}`, { purpose });
      setEditingPurpose(false);
      onChanged("Saved.");
    } catch (e) { onError(errorOf(e, "Could not save that.")); }
  };

  return (
    <div className="space-y-4">
      <Card tone="indigo">
        <div className="px-5 pt-4 pb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h2 className="font-condensed font-extrabold text-[22px] leading-tight text-navy">
                {u.name}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Chip tone="slate" dot={false}>{u.code}</Chip>
                <Chip tone="indigo" dot={false}>{u.unit_type.toLowerCase()}</Chip>
                {u.parent_name && <Chip tone="slate" dot={false}>under {u.parent_name}</Chip>}
                {u.plant_name && <Chip tone="teal" dot={false}>{u.plant_name}</Chip>}
                <Chip tone="navy" dot={false}>{detail.people.length} people</Chip>
              </div>
            </div>
            {busy && <Loader2 className="w-4 h-4 animate-spin text-txt-light mt-1" />}
          </div>

          {/* Purpose. Free text on purpose: what a department is for is not
              something a dropdown knows, and this is the sentence a user sees
              before being asked why their department is holding something. */}
          <div className="mt-3.5">
            {editingPurpose ? (
              <div className="space-y-2">
                <textarea
                  value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3}
                  placeholder="What is this department for?"
                  className={inputClass}
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => void savePurpose()}>Save</Button>
                  <Button size="sm" onClick={() => { setPurpose(u.purpose ?? ""); setEditingPurpose(false); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <p className={`text-[12.5px] leading-relaxed flex-1
                               ${u.purpose ? "text-txt-secondary" : "text-txt-light italic"}`}>
                  {u.purpose ?? "No purpose recorded yet."}
                </p>
                {mayManage && (
                  <button onClick={() => setEditingPurpose(true)}
                          className="text-txt-light hover:text-navy shrink-0" title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {detail.labels.length > 0 && (
            <div className="mt-3.5 pt-3 border-t border-border-light">
              <span className="text-[10.5px] font-bold uppercase tracking-[.14em] text-txt-light">
                Known elsewhere as
              </span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {detail.labels.map((l) => (
                  <Chip key={l.org_unit_source_id} tone="slate" dot={false}
                        title={l.note ?? undefined}>
                    {l.system.replace("SAP_", "SAP ").toLowerCase()}: {l.external_label}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Posts */}
      <Card>
        <CardHeader
          title="Posts" tone="violet" icon={Crown}
          subtitle="A chair, and who is in it"
          actions={mayManage
            ? <Button size="sm" onClick={() => setAddingPost(true)}><Plus className="w-3.5 h-3.5" /> Post</Button>
            : undefined}
        />
        <div className="divide-y divide-border-light">
          {detail.posts.length === 0 && (
            <p className="px-5 py-10 text-center text-[13px] text-txt-light">
              No posts here yet.
            </p>
          )}
          {detail.posts.map((p) => {
            const proposed = p.holding_id && !p.confirmed_at;
            return (
              <div key={`${p.post_id}-${p.holding_id ?? "none"}`} className="px-5 py-3.5">
                <div className="flex items-start gap-3 flex-wrap">
                  {p.person ? <Avatar name={p.person} /> : (
                    <span className="w-9 h-9 rounded-full bg-bg-section ring-1 ring-border
                                     flex items-center justify-center shrink-0">
                      <UserRound className="w-4 h-4 text-txt-light" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] font-semibold text-txt-primary">
                        {p.person ?? "Vacant"}
                      </span>
                      <Chip tone={POST_TONE[p.post_type] ?? "slate"} dot={false}>
                        {POST_LABEL[p.post_type] ?? p.post_type}
                      </Chip>
                      {p.basis && p.basis !== "SUBSTANTIVE" && (
                        <Chip tone="sky" dot={false}>{p.basis.toLowerCase()} charge</Chip>
                      )}
                      {proposed && <Chip tone="amber">proposed</Chip>}
                    </div>
                    <p className="text-[11.5px] text-txt-muted mt-0.5">
                      {p.title}
                      {p.designation ? ` · ${p.designation}` : ""}
                      {p.emp_id ? ` · ${p.emp_id}` : ""}
                      {p.reports_to_title ? ` · reports to ${p.reports_to_title}` : ""}
                    </p>
                    {proposed && p.derived_note && (
                      <p className="text-[11.5px] text-amber mt-1.5 leading-relaxed">
                        {p.derived_note}
                      </p>
                    )}
                    {p.confirmed_at && p.confirmed_by && (
                      <p className="text-[11px] text-txt-light mt-1">
                        Confirmed by {p.confirmed_by}
                        {p.valid_from ? ` · holding since ${p.valid_from}` : ""}
                      </p>
                    )}
                  </div>
                  {mayManage && (
                    <div className="flex gap-1.5 shrink-0">
                      {proposed && p.holding_id && (
                        <Button size="sm" variant="primary"
                                onClick={() => void confirm(p.holding_id!)}
                                disabled={confirming === p.holding_id}>
                          {confirming === p.holding_id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Check className="w-3.5 h-3.5" />}
                          Confirm
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setHolderFor(p)}>
                        {p.person ? "Change" : "Assign"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* What it answers for */}
      <Card>
        <CardHeader
          title="Answers for" tone="teal" icon={Package}
          subtitle="What this department holds, and where the source system keeps it"
          actions={mayManage
            ? <Button size="sm" onClick={() => setAddingAcc(true)}><Plus className="w-3.5 h-3.5" /> Add</Button>
            : undefined}
        />
        <table className="w-full">
          <thead><tr>
            <Th>Domain</Th><Th>Scope</Th><Th>Note</Th><Th>Answered by</Th>
          </tr></thead>
          <tbody>
            {detail.accountability.length === 0 && (
              <EmptyRow colSpan={4}>
                Nothing recorded. Until a department answers for something, the
                inventory portal has nowhere to send its questions.
              </EmptyRow>
            )}
            {detail.accountability.map((a) => (
              <tr key={a.accountability_id}>
                <Td><Chip tone={a.domain === "MATERIAL" ? "teal" : "slate"} dot={false}>
                  {DOMAIN_LABEL[a.domain] ?? a.domain}
                </Chip></Td>
                <Td>{a.scope_ref
                  ? <span className="tabular-nums">{a.scope_system?.replace("SAP_", "SAP ").toLowerCase()} {a.scope_ref}</span>
                  : <span className="text-amber">not tied to a source yet</span>}</Td>
                <Td className="max-w-[320px]">{a.description ?? "—"}</Td>
                <Td>{a.post_title ?? "the head of department"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* People */}
      <Card>
        <CardHeader title="People" tone="indigo" icon={Users}
                    subtitle={`${detail.people.length} on an open employment row`} />
        <div className="max-h-[360px] overflow-y-auto scrollbar-thin">
          <table className="w-full">
            <thead className="sticky top-0"><tr>
              <Th>Name</Th><Th>Designation</Th><Th>EMPID</Th><Th>Since</Th>
            </tr></thead>
            <tbody>
              {detail.people.length === 0 && <EmptyRow colSpan={4}>Nobody posted here.</EmptyRow>}
              {detail.people.map((m) => (
                <tr key={m.party_id}>
                  <Td><span className="font-medium text-txt-primary">{m.name}</span></Td>
                  <Td>{m.designation ?? "—"}</Td>
                  <Td className="tabular-nums">{m.emp_id ?? "—"}</Td>
                  <Td className="tabular-nums">{m.since ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {detail.history.length > 0 && (
        <Card>
          <CardHeader title="Who held it before" tone="slate" icon={UserRound}
                      subtitle="Kept so an old case can still name the right person" />
          <table className="w-full">
            <thead><tr><Th>Post</Th><Th>Person</Th><Th>From</Th><Th>Until</Th></tr></thead>
            <tbody>
              {detail.history.map((h) => (
                <tr key={h.holding_id}>
                  <Td>{h.post_title}</Td>
                  <Td>{h.person}</Td>
                  <Td className="tabular-nums">{h.valid_from}</Td>
                  <Td className="tabular-nums">{h.valid_to}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {holderFor && (
        <HolderDialog
          post={holderFor} onClose={() => setHolderFor(null)}
          onDone={(msg) => { setHolderFor(null); onChanged(msg); }}
          onError={onError}
        />
      )}
      {addingPost && (
        <PostDialog
          unitId={u.org_unit_id} unitName={u.name} onClose={() => setAddingPost(false)}
          onDone={(msg) => { setAddingPost(false); onChanged(msg); }} onError={onError}
        />
      )}
      {addingAcc && (
        <AccountabilityDialog
          unitId={u.org_unit_id} unitName={u.name} posts={detail.posts}
          onClose={() => setAddingAcc(false)}
          onDone={(msg) => { setAddingAcc(false); onChanged(msg); }} onError={onError}
        />
      )}
    </div>
  );
}

/* ── Putting somebody in a post ──────────────────────────────────────────── */
function HolderDialog({ post, onClose, onDone, onError }: {
  post: Post; onClose: () => void; onDone: (msg: string) => void; onError: (m: string) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [pick, setPick] = useState<PersonHit | null>(null);
  const [basis, setBasis] = useState("SUBSTANTIVE");
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  // Debounced so a search does not fire a request per keystroke against a
  // database that is a VPN hop away.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/organisation/people", { params: { q, limit: 25 } });
        setHits(r.data ?? []);
      } catch { /* the dialog stays usable without suggestions */ }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const save = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      await api.post(`/organisation/posts/${post.post_id}/holder`, {
        party_id: pick.party_id, basis, valid_from: from, remarks,
      });
      onDone(`${pick.name} now holds ${post.title}.`);
    } catch (e) { onError(errorOf(e, "Could not save that.")); }
    finally { setBusy(false); }
  };

  return (
    <Dialog
      open tone="info" title={post.person ? `Change who holds ${post.title}` : `Assign ${post.title}`}
      confirmLabel="Save" onCancel={onClose} onConfirm={() => void save()} busy={busy}
    >
      <div className="space-y-3.5">
        {post.person && basis === "SUBSTANTIVE" && (
          <Alert tone="warning">
            {post.person} is dated out of this post the day before the new holder starts.
            The record of their time in it is kept.
          </Alert>
        )}

        <Field label="Person" required>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-txt-light absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }}
                   placeholder="Name or EMPID" className={`${inputClass} pl-8`} autoFocus />
          </div>
        </Field>

        {pick ? (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-indigo-bg ring-1 ring-indigo-ring">
            <Avatar name={pick.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-navy truncate">{pick.name}</p>
              <p className="text-[11px] text-txt-muted truncate">
                {[pick.emp_id, pick.designation, pick.unit].filter(Boolean).join(" · ")}
              </p>
            </div>
            <button onClick={() => setPick(null)} className="text-txt-light hover:text-navy">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="max-h-[200px] overflow-y-auto scrollbar-thin rounded-lg border border-border-light">
            {hits.length === 0 && (
              <p className="px-3 py-6 text-center text-[12px] text-txt-light">
                {q ? "Nobody by that name." : "Start typing a name or an EMPID."}
              </p>
            )}
            {hits.map((h) => (
              <button key={h.party_id} onClick={() => setPick(h)}
                      className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-bg-section">
                <Avatar name={h.name} size="sm" />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-txt-primary truncate">{h.name}</span>
                  <span className="block text-[11px] text-txt-light truncate">
                    {[h.emp_id, h.designation, h.unit].filter(Boolean).join(" · ") || "no employment recorded"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Basis" hint="Acting and additional charge sit alongside the substantive holder.">
            <select value={basis} onChange={(e) => setBasis(e.target.value)} className={inputClass}>
              <option value="SUBSTANTIVE">Substantive</option>
              <option value="ACTING">Acting</option>
              <option value="ADDITIONAL">Additional charge</option>
            </select>
          </Field>
          <Field label="Holding from" required>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </Field>
        </div>

        <Field label="Remarks" hint="Optional — an order number, or why the change was made.">
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} />
        </Field>
      </div>
    </Dialog>
  );
}

/* ── New post ────────────────────────────────────────────────────────────── */
function PostDialog({ unitId, unitName, onClose, onDone, onError }: {
  unitId: number; unitName: string; onClose: () => void;
  onDone: (msg: string) => void; onError: (m: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("MEMBER");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.post("/organisation/posts", {
        org_unit_id: unitId, title: title.trim(), post_type: type, remarks,
      });
      onDone("Post created. Assign somebody to it when you are ready.");
    } catch (e) { onError(errorOf(e, "Could not create that post.")); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open tone="info" title={`New post in ${unitName}`} confirmLabel="Create"
            onCancel={onClose} onConfirm={() => void save()} busy={busy || !title.trim()}>
      <div className="space-y-3.5">
        <Field label="Title" required hint="What the post is called on site, e.g. “Store in-charge”.">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} autoFocus />
        </Field>
        <Field label="Kind" hint="A department may hold one head and one material custodian.">
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
            {Object.entries(POST_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Remarks">
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} />
        </Field>
      </div>
    </Dialog>
  );
}

/* ── New accountability ──────────────────────────────────────────────────── */
function AccountabilityDialog({ unitId, unitName, posts, onClose, onDone, onError }: {
  unitId: number; unitName: string; posts: Post[]; onClose: () => void;
  onDone: (msg: string) => void; onError: (m: string) => void;
}) {
  const [domain, setDomain] = useState<string>("MATERIAL");
  const [scopeSystem, setScopeSystem] = useState("");
  const [scopeRef, setScopeRef] = useState("");
  const [description, setDescription] = useState("");
  const [postId, setPostId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.post("/organisation/accountability", {
        org_unit_id: unitId, domain, scope_system: scopeSystem,
        scope_ref: scopeRef, description,
        post_id: postId ? Number(postId) : null,
      });
      onDone("Recorded.");
    } catch (e) { onError(errorOf(e, "Could not record that.")); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open tone="info" title={`What ${unitName} answers for`} confirmLabel="Record"
            onCancel={onClose} onConfirm={() => void save()} busy={busy}>
      <div className="space-y-3.5">
        <Field label="Domain" required>
          <select value={domain} onChange={(e) => setDomain(e.target.value)} className={inputClass}>
            {DOMAINS.map((d) => <option key={d} value={d}>{DOMAIN_LABEL[d]}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Where the source system keeps it">
            <select value={scopeSystem} onChange={(e) => setScopeSystem(e.target.value)} className={inputClass}>
              {SCOPE_SYSTEMS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Reference" hint="The cost centre, storage location or WBS itself.">
            <input value={scopeRef} onChange={(e) => setScopeRef(e.target.value)}
                   className={inputClass} disabled={!scopeSystem} />
          </Field>
        </div>
        <Field label="Answered by" hint="Leave as the head of department unless somebody narrower holds it.">
          <SearchSelect field value={postId} onChange={setPostId}
            allLabel="The head of department" searchPlaceholder="Type a post…"
            options={posts.map((p) => ({
              value: String(p.post_id), label: p.title,
            }))} />
        </Field>
        <Field label="Note">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                    rows={2} className={inputClass} />
        </Field>
      </div>
    </Dialog>
  );
}

/* ── New department ──────────────────────────────────────────────────────── */
function NewUnit({ units, onDone }: { units: Unit[]; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parent, setParent] = useState<string>("");
  const [type, setType] = useState("DEPARTMENT");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post("/organisation/units", {
        name: name.trim(), unit_type: type,
        parent_id: parent ? Number(parent) : null,
      });
      setOpen(false); setName(""); setParent("");
      onDone("Department created.");
    } catch (e) { setErr(errorOf(e, "Could not create that.")); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Plus className="w-3.5 h-3.5" /> Department</Button>
      {open && (
        <Dialog open tone="info" title="New department" confirmLabel="Create"
                onCancel={() => setOpen(false)} onConfirm={() => void save()}
                busy={busy || !name.trim()}>
          <div className="space-y-3.5">
            {err && <Alert tone="error">{err}</Alert>}
            <Field label="Name" required>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kind">
                <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
                  <option value="DEPARTMENT">Department</option>
                  <option value="SECTION">Section</option>
                  <option value="DIVISION">Division</option>
                  <option value="SITE">Site</option>
                </select>
              </Field>
              <Field label="Reports to">
                <SearchSelect field value={parent} onChange={setParent}
                  allLabel="Nothing above it" searchPlaceholder="Type a unit…"
                  options={units.map((u) => ({
                    value: String(u.org_unit_id), label: u.name,
                  }))} />
              </Field>
            </div>
            <p className="text-[11.5px] text-txt-muted leading-relaxed">
              The code is generated from the name and cannot be changed afterwards —
              other systems quote it.
            </p>
          </div>
        </Dialog>
      )}
    </>
  );
}

/* ── What still needs an answer ──────────────────────────────────────────── */
function Attention({ gaps, mayManage, onOpen, onChanged, onError }: {
  gaps: Gaps | null; mayManage: boolean;
  onOpen: (unitId: number) => void;
  onChanged: (msg: string) => void; onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  if (!gaps) return null;

  const confirm = async (holdingId: number, person: string) => {
    setBusy(holdingId);
    try {
      await api.post(`/organisation/holdings/${holdingId}/confirm`);
      onChanged(`${person} confirmed.`);
    } catch (e) { onError(errorOf(e, "Could not confirm that.")); }
    finally { setBusy(null); }
  };

  const nothing = !gaps.unconfirmed.length && !gaps.no_head.length
    && !gaps.no_material_owner.length && !gaps.unscoped_material.length
    && !gaps.unmapped_to_sap.length;

  if (nothing) {
    return (
      <Card>
        <div className="py-20 text-center px-6">
          <Check className="w-8 h-8 text-emerald mx-auto mb-3" />
          <p className="text-[14px] font-semibold text-navy">Nothing outstanding.</p>
          <p className="text-[12.5px] text-txt-muted mt-1">
            Every department has a confirmed head and a recorded scope.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {gaps.unconfirmed.length > 0 && (
        <Card tone="amber">
          <CardHeader
            title="Proposed, not agreed" tone="amber" icon={ShieldQuestion}
            subtitle="The import read these off grade seniority. Nobody has said yes."
          />
          <div className="divide-y divide-border-light">
            {gaps.unconfirmed.map((g) => (
              <div key={g.holding_id} className="px-5 py-3.5 flex items-start gap-3 flex-wrap">
                <Avatar name={g.person} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-txt-primary">
                    {g.person}
                    <span className="font-normal text-txt-muted"> — {g.post}</span>
                  </p>
                  <button onClick={() => onOpen(g.org_unit_id)}
                          className="text-[11.5px] text-indigo hover:underline">
                    {g.unit}
                  </button>
                  {g.derived_note && (
                    <p className="text-[11.5px] text-txt-muted mt-1 leading-relaxed">{g.derived_note}</p>
                  )}
                </div>
                {mayManage && (
                  <Button size="sm" variant="primary" disabled={busy === g.holding_id}
                          onClick={() => void confirm(g.holding_id, g.person)}>
                    {busy === g.holding_id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Check className="w-3.5 h-3.5" />}
                    Confirm
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {gaps.no_head.length > 0 && (
        <GapList
          title="No confirmed head" tone="rose" icon={CircleAlert}
          subtitle="An escalation raised against these has nobody to reach."
          rows={gaps.no_head.map((g) => ({
            id: g.org_unit_id, label: g.name, meta: `${g.people} people`,
          }))}
          onOpen={onOpen}
        />
      )}

      {gaps.no_material_owner.length > 0 && (
        <GapList
          title="Not answering for any material" tone="amber" icon={Package}
          subtitle="Either the department genuinely holds no stock, or nobody has said what it holds."
          rows={gaps.no_material_owner.map((g) => ({
            id: g.org_unit_id, label: g.name, meta: `${g.people} people`,
          }))}
          onOpen={onOpen}
        />
      )}

      {gaps.unscoped_material.length > 0 && (
        <GapList
          title="Material scope not tied to a source" tone="sky" icon={Package}
          subtitle="The department answers for material, but not yet for a cost centre or storage location — so the portal cannot tell which stock is theirs."
          rows={gaps.unscoped_material.map((g) => ({
            id: g.org_unit_id, label: g.unit, meta: g.description ?? "",
          }))}
          onOpen={onOpen}
        />
      )}

      {gaps.unmapped_to_sap.length > 0 && (
        <GapList
          title="No SAP department name" tone="slate" icon={Building2}
          subtitle="Nothing in the employee master maps here, so headcount will read zero."
          rows={gaps.unmapped_to_sap.map((g) => ({ id: g.org_unit_id, label: g.name, meta: "" }))}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}

function GapList({ title, subtitle, tone, icon, rows, onOpen }: {
  title: string; subtitle: string; tone: Tone; icon: React.ElementType;
  rows: { id: number; label: string; meta: string }[];
  onOpen: (id: number) => void;
}) {
  return (
    <Card>
      <CardHeader title={`${title} · ${rows.length}`} subtitle={subtitle} tone={tone} icon={icon} />
      <div className="px-4 py-3 flex flex-wrap gap-2">
        {rows.map((r) => (
          <button key={`${r.id}-${r.label}`} onClick={() => onOpen(r.id)}
                  title={r.meta}
                  className="px-3 py-1.5 rounded-lg border border-border-light bg-bg-section
                             hover:border-gold hover:bg-bg-base transition-colors text-left">
            <span className="block text-[12.5px] font-semibold text-txt-primary">{r.label}</span>
            {r.meta && <span className="block text-[11px] text-txt-light truncate max-w-[280px]">{r.meta}</span>}
          </button>
        ))}
      </div>
    </Card>
  );
}

/* ── What each department holds ──────────────────────────────────────────── */
function AccountabilityMatrix({ units, onOpen }: {
  units: Unit[]; onOpen: (id: number) => void;
}) {
  const rows = units.filter((u) => u.unit_type !== "SITE");
  return (
    <Card>
      <CardHeader
        title="What each department answers for" tone="teal" icon={Package}
        subtitle="The row the inventory portal will read: material held against a department, and the person it escalates to."
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead><tr>
            <Th>Department</Th><Th>People</Th><Th>Accountable</Th>
            <Th>Answers for</Th><Th>SAP name</Th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5}>No departments yet.</EmptyRow>}
            {rows.map((u) => (
              <tr key={u.org_unit_id} className="hover:bg-bg-section cursor-pointer"
                  onClick={() => onOpen(u.org_unit_id)}>
                <Td><span className="font-semibold text-txt-primary">{u.name}</span></Td>
                <Td className="tabular-nums">{u.people}</Td>
                <Td>
                  {u.head_name
                    ? <span className="text-txt-primary">{u.head_name}</span>
                    : u.proposed_head
                      ? <Chip tone="amber">{u.proposed_head.name} — proposed</Chip>
                      : <Chip tone="rose">nobody</Chip>}
                </Td>
                <Td>
                  {u.accountabilities > 0
                    ? <Chip tone="teal" dot={false}>{u.accountabilities} recorded</Chip>
                    : <span className="text-txt-light">—</span>}
                </Td>
                <Td className="text-[11.5px] text-txt-light max-w-[240px] truncate">
                  {u.sap_labels ?? "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
