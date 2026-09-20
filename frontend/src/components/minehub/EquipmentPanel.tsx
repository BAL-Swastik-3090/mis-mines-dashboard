"use client";
/**
 * Equipment Registry.
 *
 * Opens with the machines that are transmitting telematics nobody can attribute
 * to anything, because clearing that list IS the task — 42 machines currently
 * send data under names no register claims. Registering from one of those rows
 * carries the telematics name across, so the common path never involves typing
 * a code twice and then wondering why the join does not work.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, Link2, Trash2, Check, Loader2, Radio, ChevronDown, ChevronRight,
  Cpu, Zap, Plus, Building2, X, Rows3, LayoutGrid, CircleSlash, Gauge,
  SlidersHorizontal, Layers,
} from "lucide-react";
import api from "@/lib/api";
import ColumnFilter, { optionsFrom, SortHeader, type SortDir } from "./ColumnFilter";
import CommentThread from "@/components/comments/CommentThread";
import { useAuth } from "@/contexts/useAuth";
import AssetForm from "./AssetForm";
import {
  Alert, Button, Card, CardHeader, Chip, EmptyRow, StatBar, Td, Th, TONE_DOT,
  inputClass, type Tone,
} from "./ui";

interface Summary {
  assets: number; assets_active: number; aliases: number; asset_types: number;
  people: number; organisations: number; events: number;
}
interface Asset {
  asset_id: number; asset_ref?: string | null; fleet_code: string; nickname?: string | null;
  registration_no: string | null; make: string | null; model: string | null;
  ownership: string; status: string; asset_type: string; category: string;
  propulsion?: string | null; fuel_type?: string | null;
  owner: string | null; alias_count: number; alias_systems: string | null;
  version?: number; approval_status?: string;
  updated_at?: string | null; created_at?: string | null;
  last_changed_by?: string | null;
}
interface Identity { asset_identity_id: number; system: string; external_code: string }
interface Unmapped { vehicle_desc: string; feed: string; rows_: number; last_seen: string }

/** Approval state is separate from operating state — a machine can be running
    while its record is still awaiting review. */
const APPROVAL_TONE: Record<string, Tone> = {
  DRAFT: "slate", SUBMITTED: "amber", SENT_BACK: "rose", APPROVED: "emerald",
};

/** When a row last moved, said the way somebody would say it. Anything older
 *  than a fortnight gets the date instead: "47 days ago" is a number people
 *  have to convert, and the date is what they were going to ask for. */
function changedWhen(iso?: string | null): string {
  if (!iso) return "never edited";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days < 1) return "changed today";
  if (days === 1) return "changed yesterday";
  if (days < 14) return `changed ${days} days ago`;
  return `changed ${then.toLocaleDateString("en-IN",
    { day: "2-digit", month: "short", year: "numeric" })}`;
}

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "emerald", MAINTENANCE: "amber", STANDBY: "sky", IDLE: "slate",
  OFF_ROAD: "amber", CANNIBALISED: "violet", SCRAPPED: "rose", DISPOSED: "rose",
};

/** How each stage is said out loud. */
const STAGE_LABEL: Record<string, string> = {
  ACTIVE: "Working", MAINTENANCE: "In workshop", STANDBY: "Standby",
  IDLE: "Idle", OFF_ROAD: "Off road", CANNIBALISED: "Cannibalised",
  SCRAPPED: "Scrapped", DISPOSED: "Disposed",
};

/** Still part of the working fleet. A scrapped tipper is a record, not a
 *  machine, and it should not be the first thing on the register — three of
 *  them sat at the top of the list purely because their codes begin with A. */
const IN_SERVICE = ["ACTIVE", "MAINTENANCE", "STANDBY", "IDLE"];

/** Everything that is no longer part of the working fleet. The register opens
 *  without these, and the count of them is the difference between "130
 *  machines" and "123 on the list" — a gap that went unexplained until it was
 *  given its own figure. */
const RETIRED = ["OFF_ROAD", "CANNIBALISED", "SCRAPPED", "DISPOSED"];

/** Sorting by status alphabetically puts Cannibalised above Working, which is
 *  nobody's idea of order. The useful order is how far through its life a
 *  machine is. */
const STAGE_RANK: Record<string, number> = {
  ACTIVE: 0, MAINTENANCE: 1, STANDBY: 2, IDLE: 3,
  OFF_ROAD: 4, CANNIBALISED: 5, SCRAPPED: 6, DISPOSED: 7,
};

const STATUS_VIEWS: { id: string; label: string }[] = [
  { id: "IN_SERVICE", label: "In service" },
  { id: "", label: "All machines" },
  { id: "ACTIVE", label: "Working" },
  { id: "MAINTENANCE", label: "In workshop" },
  { id: "STANDBY", label: "Standby" },
  { id: "IDLE", label: "Idle" },
  { id: "OFF_ROAD", label: "Off road" },
  { id: "CANNIBALISED", label: "Cannibalised" },
  { id: "SCRAPPED", label: "Scrapped" },
  { id: "DISPOSED", label: "Disposed" },
];

/** Equipment categories get their own hue so a long register stays scannable. */
const CATEGORY_TONE: Record<string, Tone> = {
  EXCAVATION: "violet", HAULAGE: "sky", DRILLING: "indigo", DOZING: "teal",
  GRADING: "emerald", LIFTING: "amber", WATER: "sky", PUMP: "teal",
  SUPPORT: "slate", LIGHTING: "amber", LMV: "slate", OTHER: "slate",
};

/** One place that knows what each stage selection means, because three
 *  separate copies of the same two lines is how "retired" ends up filtering
 *  the table and not the filter menus. */
function atStage(a: { status: string }, stage: string): boolean {
  if (stage === "IN_SERVICE") return IN_SERVICE.includes(a.status);
  if (stage === "RETIRED") return RETIRED.includes(a.status);
  if (stage) return a.status === stage;
  return true;
}

type SortKey = "machine" | "type" | "makemodel" | "owner" | "linked"
             | "changed" | "status";

/** SCREAMING_SNAKE is how the database says it and not how anybody reads it. */
function titleCase(v: string): string {
  return v.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

interface Section { key: string; label: string; tone: Tone; rows: Asset[] }

type GroupKey = "" | "category" | "asset_type" | "status" | "owner" | "make"
              | "propulsion" | "approval_status";

const GROUPS: { id: GroupKey; label: string }[] = [
  { id: "category",       label: "Category" },
  { id: "asset_type",     label: "Type" },
  { id: "status",         label: "Stage" },
  { id: "owner",          label: "Owner" },
  { id: "make",           label: "Make" },
  { id: "propulsion",     label: "Electric or not" },
  { id: "approval_status", label: "Approval" },
];

/** A stable hue per value, so the same contractor is the same colour every
 *  time the page is opened and a grouped list stays scannable. Categories and
 *  stages have meanings attached to their colours already and keep them. */
const HUES: Tone[] = ["violet", "indigo", "teal", "sky", "amber", "emerald", "rose"];
function hueFor(value: string): Tone {
  const h = [...value].reduce((a, c) => a + c.charCodeAt(0), 0);
  return HUES[h % HUES.length];
}

/** Which heading a machine falls under, said the way a person would say it. */
function groupOf(a: Asset, key: GroupKey): { value: string; tone: Tone } {
  switch (key) {
    case "category":
      return { value: titleCase(a.category || "Uncategorised"),
               tone: CATEGORY_TONE[a.category] ?? "slate" };
    case "asset_type":
      return { value: a.asset_type || "No type set", tone: hueFor(a.asset_type || "") };
    case "status":
      return { value: STAGE_LABEL[a.status] ?? titleCase(a.status),
               tone: STATUS_TONE[a.status] ?? "slate" };
    case "owner": {
      const v = a.ownership === "HIRED" ? (a.owner || "Hired, owner not recorded") : "BAL";
      return { value: v, tone: v === "BAL" ? "slate" : hueFor(v) };
    }
    case "make":
      return { value: a.make || "Make not recorded", tone: hueFor(a.make || "") };
    case "propulsion":
      return a.propulsion === "EV" ? { value: "Electric", tone: "emerald" }
           : a.propulsion === "HYBRID" ? { value: "Hybrid", tone: "sky" }
           : { value: "Diesel and the rest", tone: "slate" };
    case "approval_status":
      return { value: titleCase(a.approval_status || "Unknown"),
               tone: APPROVAL_TONE[a.approval_status ?? ""] ?? "slate" };
    default:
      return { value: "", tone: "slate" };
  }
}

/** What each column sorts on, and what the two directions are called there.
 *  "A to Z" on a date column is the reason people click sort twice. */
const SORT_WORDS: Record<SortKey, [string, string]> = {
  machine:   ["A to Z", "Z to A"],
  type:      ["A to Z", "Z to A"],
  makemodel: ["A to Z", "Z to A"],
  owner:     ["A to Z", "Z to A"],
  linked:    ["Fewest links first", "Most links first"],
  changed:   ["Oldest first", "Changed most recently"],
  status:    ["Working first", "Scrapped first"],
};

export default function EquipmentPanel({ addOpen, onAddOpenChange, onFormOpenChange, onChanged }: {
  addOpen?: boolean; onAddOpenChange?: (v: boolean) => void;
  /** The registration sheet is on screen — editing counts, not just adding. */
  onFormOpenChange?: (v: boolean) => void;
  onChanged?: () => void;
}) {
  const can = useAuth((s) => s.can);
  const mayManage = can("platform.registry.manage");

  const [summary, setSummary] = useState<Summary | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [unmapped, setUnmapped] = useState<Unmapped[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<number | null>(null);
  const [propulsion, setPropulsion] = useState("");
  // The register opens on the machines that still work. Everything ever
  // registered is one click away, but a list that leads with four scrapped
  // lorries is a list people stop trusting to show them the fleet.
  const [stage, setStage] = useState("IN_SERVICE");
  // Every column filters, and they narrow together: type Excavator and owner
  // DASHMESH is a question somebody actually asks, and answering it with two
  // separate screens is how people go back to the spreadsheet.
  // Category, fuel and approval have no column of their own — eight columns
  // is already a wide table — but they are three of the questions people
  // actually arrive with: what haulage have we got, what still runs on
  // diesel, what is sitting in draft. They get a toolbar instead.
  const [by, setBy] = useState({ type: "", owner: "", make: "", model: "",
                                 linked: "", category: "", fuel: "", approval: "" });
  // The server hands the list over in fleet-code order, so that is what the
  // table claims to be doing until somebody says otherwise.
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>(
    { key: "machine", dir: "asc" });
  const sortBy = (key: SortKey) => (dir: SortDir) => setSort({ key, dir });
  // A table is the right shape for comparing a column down the page; cards are
  // the right shape for reading one machine at a time, and for a phone, where
  // eight columns become a horizontal scroll nobody performs.
  const [view, setView] = useState<"table" | "cards">("table");
  // Clicking the unregistered figure should take you to the unregistered list,
  // not merely inform you that it exists.
  const queue = React.useRef<HTMLDivElement>(null);
  const set = (k: keyof typeof by) => (v: string) => setBy((b) => ({ ...b, [k]: v }));
  const clearAll = () => {
    setBy({ type: "", owner: "", make: "", model: "", linked: "",
            category: "", fuel: "", approval: "" });
    setStage("IN_SERVICE"); setPropulsion(""); setQuery("");
  };

  // What the list is cut into. Separate from sorting: sorting decides the
  // order of 123 rows, grouping decides how many lists there are.
  const [group, setGroup] = useState<GroupKey>("");

  // Hybrids count as electric here. A fleet that is going electric is asked
  // "how far along are we", and a machine that runs on a battery half the time
  // is part of the answer rather than neither.
  // How many the current view is leaving out, so the count in the title is
  // never quietly wrong about the size of the fleet.
  const hidden = React.useMemo(
    () => (stage === "IN_SERVICE"
      ? assets.filter((a) => !IN_SERVICE.includes(a.status)).length : 0),
    [assets, stage]);

  const inService = React.useMemo(
    () => assets.filter((a) => IN_SERVICE.includes(a.status)).length, [assets]);
  const retired = React.useMemo(
    () => assets.filter((a) => RETIRED.includes(a.status)).length, [assets]);

  // Built from the rows the other filters leave, so the menus never offer a
  // value that would return nothing — picking a make and finding an empty
  // table is the moment somebody decides the filter is broken.
  const pool = React.useMemo(() => assets.filter((a) => atStage(a, stage)),
    [assets, stage]);

  const menus = React.useMemo(() => ({
    type: optionsFrom(pool, (a) => a.asset_type),
    category: optionsFrom(pool, (a) => a.category, titleCase),
    fuel: optionsFrom(pool, (a) => a.fuel_type, titleCase),
    approval: optionsFrom(pool, (a) => a.approval_status, titleCase),
    owner: optionsFrom(pool, (a) => a.owner),
    make: optionsFrom(pool, (a) => a.make),
    model: optionsFrom(pool, (a) => a.model),
    linked: [
      { value: "LINKED", label: "Linked to another system",
        count: pool.filter((a) => a.alias_count).length },
      { value: "NONE", label: "Not linked yet",
        count: pool.filter((a) => !a.alias_count).length },
    ],
  }), [pool]);

  const narrowed = Boolean(by.type || by.owner || by.make || by.model
    || by.linked || by.category || by.fuel || by.approval
    || propulsion || query.trim() || stage !== "IN_SERVICE");

  const evCount = React.useMemo(
    () => assets.filter((a) => a.propulsion === "EV" || a.propulsion === "HYBRID").length,
    [assets]);

  const [identities, setIdentities] = useState<Identity[]>([]);
  const [prefill, setPrefill] = useState<{ fleet_code?: string; telematics_code?: string }>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  // Forty-two rows of telematics names is a queue, not a reading list. It opens
  // showing enough to judge the size of the job.
  const [allUnmapped, setAllUnmapped] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, a, u] = await Promise.all([
        api.get("/minehub/summary"),
        api.get("/minehub/assets"),
        api.get("/minehub/unmapped-telematics"),
      ]);
      setSummary(s.data); setAssets(a.data ?? []); setUnmapped(u.data ?? []);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not reach the platform database.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Whether the registration sheet is on screen. Declared with the other hooks
  // rather than beside the branch that uses it: a hook placed after an early
  // return runs on some renders and not others, and React counts them.
  const formOpen = Boolean(addOpen || editingId);
  useEffect(() => { onFormOpenChange?.(formOpen); }, [formOpen, onFormOpenChange]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (!atStage(a, stage)) return false;
      if (by.type && a.asset_type !== by.type) return false;
      if (by.category && (a.category ?? "") !== by.category) return false;
      if (by.fuel && (a.fuel_type ?? "") !== by.fuel) return false;
      if (by.approval && (a.approval_status ?? "") !== by.approval) return false;
      if (by.owner && (a.owner ?? "") !== by.owner) return false;
      if (by.make && (a.make ?? "") !== by.make) return false;
      if (by.model && (a.model ?? "") !== by.model) return false;
      if (by.linked === "LINKED" && !a.alias_count) return false;
      if (by.linked === "NONE" && a.alias_count) return false;
      if (propulsion === "EV" && a.propulsion !== "EV" && a.propulsion !== "HYBRID") return false;
      if (propulsion === "NON_EV" && a.propulsion === "EV") return false;
      if (!q) return true;
      return [a.fleet_code, a.nickname, a.registration_no, a.make, a.model, a.asset_type]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [assets, query, propulsion, stage, by]);

  // Ordered after filtering, so the sort applies to what is on screen rather
  // than to a list most of which is not.
  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const keyOf = (a: Asset): string | number => {
      switch (sort.key) {
        case "machine":   return (a.nickname || a.fleet_code || "").toLowerCase();
        case "type":      return (a.asset_type ?? "").toLowerCase();
        case "makemodel": return [a.make, a.model].filter(Boolean).join(" ").toLowerCase();
        // Our own machines group under one heading rather than scattering
        // through the contractors alphabetically.
        case "owner":     return a.ownership === "HIRED"
                                 ? (a.owner ?? "").toLowerCase() : "bal";
        case "linked":    return a.alias_count ?? 0;
        case "changed":   return new Date(a.updated_at ?? a.created_at ?? 0).getTime();
        case "status":    return STAGE_RANK[a.status] ?? 99;
      }
    };
    // A blank make is not the first make alphabetically, it is a gap in the
    // record. Gaps go to the end whichever way the column is pointing.
    const rank = (v: string | number) =>
      typeof v === "string" && v === "" ? "￿" : v;
    return [...filtered].sort((x, y) => {
      const a = rank(keyOf(x)), b = rank(keyOf(y));
      if (a === b) return (x.fleet_code || "").localeCompare(y.fleet_code || "");
      const cmp = typeof a === "number" && typeof b === "number"
        ? a - b : String(a).localeCompare(String(b));
      return cmp * dir;
    });
  }, [filtered, sort]);

  // The ordered rows, cut into headed sections. Ungrouped is one section with
  // no heading, so the table below has a single shape to render rather than
  // two.
  const sections = useMemo(() => {
    if (!group) return [{ key: "", label: "", tone: "slate" as Tone, rows: sorted }];
    const seen = new Map<string, { key: string; label: string; tone: Tone; rows: Asset[] }>();
    for (const a of sorted) {
      const { value, tone } = groupOf(a, group);
      let s = seen.get(value);
      if (!s) { s = { key: value, label: value, tone, rows: [] }; seen.set(value, s); }
      s.rows.push(a);
    }
    const out = [...seen.values()];
    // Stages run in life order; everything else leads with the biggest group,
    // because "which category do we have most of" is the question grouping by
    // category was asked in order to answer.
    if (group === "status") {
      const rank = (l: string) => {
        const code = Object.keys(STAGE_LABEL).find((k) => STAGE_LABEL[k] === l);
        return STAGE_RANK[code ?? ""] ?? 99;
      };
      out.sort((x, y) => rank(x.label) - rank(y.label));
    } else {
      out.sort((x, y) => y.rows.length - x.rows.length || x.label.localeCompare(y.label));
    }
    return out;
  }, [sorted, group]);

  // What is currently narrowing the list, each one removable on its own. The
  // filters live in the column headings, which is the right place to set them
  // and a poor place to notice five of them at once.
  const active: { label: string; clear: () => void }[] = [
    ...(stage !== "IN_SERVICE" ? [{
      label: stage === "" ? "All machines" : stage === "RETIRED" ? "Retired"
             : (STAGE_LABEL[stage] ?? stage),
      clear: () => setStage("IN_SERVICE") }] : []),
    ...(propulsion ? [{ label: propulsion === "EV" ? "Electric" : "Not electric",
                        clear: () => setPropulsion("") }] : []),
    ...(by.category ? [{ label: titleCase(by.category),
                         clear: () => set("category")("") }] : []),
    ...(by.type   ? [{ label: by.type,  clear: () => set("type")("") }] : []),
    ...(by.fuel   ? [{ label: titleCase(by.fuel), clear: () => set("fuel")("") }] : []),
    ...(by.approval ? [{ label: titleCase(by.approval),
                         clear: () => set("approval")("") }] : []),
    ...(by.make   ? [{ label: by.make,  clear: () => set("make")("") }] : []),
    ...(by.model  ? [{ label: by.model, clear: () => set("model")("") }] : []),
    ...(by.owner  ? [{ label: by.owner, clear: () => set("owner")("") }] : []),
    ...(by.linked ? [{ label: by.linked === "LINKED" ? "Linked to another system"
                              : "Not linked yet",
                       clear: () => set("linked")("") }] : []),
    ...(query.trim() ? [{ label: `matching “${query.trim()}”`,
                          clear: () => setQuery("") }] : []),
  ];

  const openIdentities = async (id: number) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    try { setIdentities((await api.get(`/minehub/assets/${id}/identities`)).data ?? []); }
    catch { setIdentities([]); }
  };

  const startRegister = (u?: Unmapped) => {
    setPrefill(u ? { fleet_code: u.vehicle_desc, telematics_code: u.vehicle_desc } : {});
    onAddOpenChange?.(true);
  };

  const addAlias = async (assetId: number, system: string, code: string) => {
    try {
      await api.post(`/minehub/assets/${assetId}/identities`, { system, external_code: code.trim() });
      setNotice("Identity linked.");
      setIdentities((await api.get(`/minehub/assets/${assetId}/identities`)).data ?? []);
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not link that identity.");
    }
  };

  const removeAlias = async (id: number, assetId: number) => {
    try {
      await api.delete(`/minehub/assets/identities/${id}`);
      setIdentities((await api.get(`/minehub/assets/${assetId}/identities`)).data ?? []);
      await load();
    } catch { setError("Could not remove that identity."); }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>;
  }

  // Registration takes the whole panel rather than sitting above the tiles and
  // the unregistered list. Filling a long form beneath a dashboard made it
  // unclear what the screen was for, and left the save button a scroll away
  // from anything explaining it.
  if (formOpen) {
    return (
      <Card tone="gold">
        <div className="p-5">
          <AssetForm
            assetId={editingId ?? undefined}
            prefill={prefill}
            onSaved={() => { void load(); onChanged?.(); }}
            onDone={() => {
              onAddOpenChange?.(false); setEditingId(null); setPrefill({});
              setNotice("Machine registered."); void load(); onChanged?.();
            }}
            onCancel={() => { onAddOpenChange?.(false); setEditingId(null); setPrefill({}); void load(); }} />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && (
        <Alert tone="success"><span className="inline-flex items-center gap-2"><Check className="w-4 h-4" />{notice}</span></Alert>
      )}


      {/* Registry state. One band, six figures, and the ones that are also
          controls say so by being clickable — the register's own numbers are
          the most natural filter on it. */}
      {summary && (
        <StatBar items={[
          { label: "Machines", value: assets.length, tone: "sky", icon: Cpu,
            hint: summary.organisations
              ? `${summary.organisations} contractors own hired ones`
              : "all owned by BAL",
            title: "Show every machine, whatever its stage",
            onClick: () => setStage(""), active: stage === "" },
          { label: "In service", value: inService, tone: "emerald", icon: Check,
            hint: stage === "IN_SERVICE"
              ? "working, in workshop, standby or idle — click to show all"
              : "working, in workshop, standby or idle",
            title: stage === "IN_SERVICE"
              ? "Stop filtering — show every machine on the register"
              : "Show only the machines still in service",
            // Every figure in this band is a toggle, including the one that
            // happens to be on when the screen opens. A control that does
            // nothing when you click it reads as a broken control, and the
            // way back to all 130 machines was buried in a column menu.
            onClick: () => setStage(stage === "IN_SERVICE" ? "" : "IN_SERVICE"),
            active: stage === "IN_SERVICE" },
          // The figure that explains why the register says 130 and the list
          // says 123. It was the difference nobody could account for.
          { label: "Retired", value: retired,
            tone: retired ? "slate" : "emerald", icon: CircleSlash,
            hint: "off road, cannibalised or scrapped",
            title: retired ? "Show the machines that have left service" : undefined,
            onClick: retired
              ? () => setStage(stage === "RETIRED" ? "" : "RETIRED")
              : undefined,
            active: stage === "RETIRED" },
          { label: "Electric", value: evCount,
            tone: evCount ? "emerald" : "slate", icon: Zap,
            hint: assets.length
              ? `${Math.round(100 * evCount / assets.length)}% of the register`
              : "nothing registered yet",
            title: evCount ? "Show only battery and hybrid machines" : undefined,
            onClick: evCount
              ? () => setPropulsion(propulsion === "EV" ? "" : "EV") : undefined,
            active: propulsion === "EV" },
          { label: "Identities linked", value: summary.aliases,
            tone: summary.aliases ? "violet" : "amber", icon: Link2,
            hint: summary.aliases
              ? "names other systems use"
              : "nothing joins to telematics yet",
            title: "Show the machines no other system can be joined to",
            onClick: () => set("linked")(by.linked === "NONE" ? "" : "NONE"),
            active: by.linked === "NONE" },
          { label: "Unregistered", value: unmapped.length,
            tone: unmapped.length ? "amber" : "emerald", icon: Radio,
            hint: "transmitting under unknown names",
            title: unmapped.length ? "Go to the unregistered list" : undefined,
            onClick: unmapped.length
              ? () => queue.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              : undefined },
        ]} />
      )}

      {/* The register */}
      <Card tone="sky">
        <CardHeader title={`Fleet register · ${filtered.length}`} icon={Cpu} tone="sky"
          subtitle={narrowed
            ? `${filtered.length} of ${assets.length} machines`
              + (hidden > 0 ? `, and ${hidden} retired ones are hidden` : "")
            : "Own and hired machines. Every heading both orders the list and "
              + "filters it; expand a row to link the names other systems use."}
          actions={
            <>
              {/* Two shapes for the same rows. The choice sits beside the
                  search rather than in a menu, because it is the kind of
                  thing people flip back and forth. */}
              <div className="inline-flex rounded-lg border border-border bg-bg-light p-0.5">
                {([["table", Rows3, "One row each, for comparing a column"],
                   ["cards", LayoutGrid, "One card each, for reading a machine"]] as const)
                  .map(([id, Icon, why]) => (
                  <button key={id} type="button" onClick={() => setView(id)}
                    title={why} aria-pressed={view === id}
                    className={`inline-flex items-center justify-center rounded-[6px] px-2 py-1
                                transition-colors
                                ${view === id
                                  ? "bg-bg-base text-navy shadow-sm ring-1 ring-border-light"
                                  : "text-txt-light hover:text-navy"}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-txt-light" />
                <input id="eq-search" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by reference, code, make…"
                  className="bg-bg-base border border-border rounded-lg pl-8 pr-3 py-1.5 text-[12px]
                             text-txt-primary placeholder:text-txt-light focus:outline-none focus:border-gold w-[180px]" />
              </div>
              {mayManage && (
                <Button size="sm" variant="primary" onClick={() => startRegister()}>
                  <Plus className="w-3.5 h-3.5" /> Add
                </Button>
              )}
            </>
          } />
        {/* The questions that have no column of their own, plus the control
            that decides how many lists this is. Kept on one line above the
            table rather than folded into a "Filters" drawer: a filter nobody
            can see is a filter nobody uses. */}
        <div className="px-5 py-2.5 border-b border-border-light
                        flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold
                           text-txt-light mr-0.5">
            <SlidersHorizontal className="w-3.5 h-3.5" /> Narrow by
          </span>
          {/* A control for a column that is empty in every row would open on
              "Nothing to filter by", which is a control that wasted a click. */}
          {menus.category.length > 1 && (
            <ColumnFilter variant="control" label="Category" allLabel="Any category"
              value={by.category} options={menus.category} onChange={set("category")} />
          )}
          {menus.fuel.length > 1 && (
            <ColumnFilter variant="control" label="Fuel" allLabel="Any fuel"
              value={by.fuel} options={menus.fuel} onChange={set("fuel")} />
          )}
          {menus.approval.length > 1 && (
            <ColumnFilter variant="control" label="Approval" allLabel="Any approval"
              value={by.approval} options={menus.approval} onChange={set("approval")} />
          )}

          <span className="w-px self-stretch bg-border-light mx-1" />

          {/* Grouping is not a filter — nothing is hidden by it — so it sits
              apart from the three that are. Same control, though: choosing
              nothing is the way back to one flat list, which is exactly what
              clearing a filter means. */}
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold
                           text-txt-light">
            <Layers className="w-3.5 h-3.5" /> Group by
          </span>
          <ColumnFilter variant="control" label="" allLabel="Nothing"
            value={group} onChange={(v) => setGroup(v as GroupKey)}
            options={GROUPS.filter((g) => g.id).map((g) => ({
              value: g.id, label: g.label,
              // How many headings this would make. "Category: 9" tells you
              // whether you are about to get a useful outline or a list of
              // one-row groups.
              count: new Set(pool.map((a) => groupOf(a, g.id).value)).size,
            }))} />
          {group && (
            <span className="text-[11px] text-txt-muted tabular-nums">
              {sections.length} {sections.length === 1 ? "group" : "groups"}
            </span>
          )}
        </div>

        {/* Set in the column headings, shown together here. Five filters you
            can only see by opening five menus is five filters somebody
            forgets is on, and then reports the register as missing rows. */}
        {active.length > 0 && (
          <div className="px-5 py-2.5 border-b border-border-light bg-bg-light/60
                          flex flex-wrap items-center gap-1.5">
            <span className="font-condensed text-[9.5px] font-bold uppercase
                             tracking-[.13em] text-txt-light mr-0.5">
              Showing only
            </span>
            {active.map((c) => (
              <button key={c.label} type="button" onClick={c.clear}
                title={`Stop filtering by ${c.label}`}
                className="group inline-flex items-center gap-1.5 rounded-full border
                           border-gold/40 bg-gold/[0.07] pl-2.5 pr-1.5 py-1
                           text-[11px] font-semibold text-gold-dark
                           hover:bg-gold/15 transition">
                {c.label}
                <X className="w-3 h-3 opacity-60 group-hover:opacity-100" />
              </button>
            ))}
            <button type="button" onClick={clearAll}
              className="ml-1 text-[11px] font-semibold text-txt-muted
                         hover:text-navy underline underline-offset-2">
              Clear all
            </button>
          </div>
        )}

        {view === "cards" ? (
          <CardGrid sections={sections} grouped={Boolean(group)}
            onOpen={setEditingId} empty={assets.length === 0} />
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr>
                <Th className="w-8" />
                <Th><SortHeader label="Machine" sort={sort.key === "machine" ? sort.dir : null}
                      onSort={sortBy("machine")} sortLabels={SORT_WORDS.machine} /></Th>
                <Th><ColumnFilter label="Type" value={by.type}
                      options={menus.type} onChange={set("type")}
                      sort={sort.key === "type" ? sort.dir : null}
                      onSort={sortBy("type")} sortLabels={SORT_WORDS.type} /></Th>
                <Th className="hidden md:table-cell">
                  <span className="inline-flex items-center gap-2">
                    <ColumnFilter label="Make" value={by.make}
                      options={menus.make} onChange={set("make")}
                      sort={sort.key === "makemodel" ? sort.dir : null}
                      onSort={sortBy("makemodel")} sortLabels={SORT_WORDS.makemodel} />
                    <span className="text-txt-light/40">/</span>
                    <ColumnFilter label="Model" value={by.model}
                      options={menus.model} onChange={set("model")} />
                  </span>
                </Th>
                <Th><ColumnFilter label="Owner" value={by.owner}
                      options={menus.owner} onChange={set("owner")}
                      sort={sort.key === "owner" ? sort.dir : null}
                      onSort={sortBy("owner")} sortLabels={SORT_WORDS.owner} /></Th>
                <Th><ColumnFilter label="Linked" value={by.linked}
                      options={menus.linked} onChange={set("linked")}
                      allLabel="Linked or not"
                      sort={sort.key === "linked" ? sort.dir : null}
                      onSort={sortBy("linked")} sortLabels={SORT_WORDS.linked} /></Th>
                <Th className="hidden lg:table-cell">
                  <SortHeader label="Changed" sort={sort.key === "changed" ? sort.dir : null}
                    onSort={sortBy("changed")} sortLabels={SORT_WORDS.changed} /></Th>
                {/* The column is the control. Somebody scanning the status
                    column is already asking "show me the ones that are…", and
                    making them look elsewhere for the control is the part that
                    gets missed. */}
                <Th className="text-right">
                  <ColumnFilter label="Status" value={stage === "IN_SERVICE" ? "" : stage}
                    align="right" allLabel="In service (default)"
                    sort={sort.key === "status" ? sort.dir : null}
                    onSort={sortBy("status")} sortLabels={SORT_WORDS.status}
                    options={[
                      { value: "ALL", label: "All machines", count: assets.length },
                      ...(retired
                        ? [{ value: "RETIRED", label: "Retired — any stage",
                             count: retired }]
                        : []),
                      ...STATUS_VIEWS
                        .filter((v) => v.id && v.id !== "IN_SERVICE")
                        .map((v) => ({
                          value: v.id, label: v.label,
                          count: assets.filter((a) => a.status === v.id).length,
                        }))
                        .filter((o) => o.count > 0),
                    ]}
                    onChange={(v) => setStage(
                      v === "" ? "IN_SERVICE" : v === "ALL" ? "" : v)} />
                </Th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <EmptyRow colSpan={8}>
                  {assets.length === 0
                    ? "No machine registered yet — start from the list above, those are transmitting already."
                    : "No machine matches that search."}
                </EmptyRow>
              )}
              {sections.map((sec) => (
                <React.Fragment key={sec.key || "_all"}>
                {group && (
                  <tr>
                    <td colSpan={8} className="px-4 py-2 bg-bg-light border-y border-border">
                      <span className="inline-flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-sm ${TONE_DOT[sec.tone]}`} />
                        <span className="font-semibold text-[12.5px] text-navy">{sec.label}</span>
                        <span className="text-[11px] text-txt-light tabular-nums">
                          {sec.rows.length}
                        </span>
                      </span>
                    </td>
                  </tr>
                )}
                {sec.rows.map((a) => (
                <React.Fragment key={a.asset_id}>
                  <tr className="hover:bg-bg-light transition-colors">
                    <Td className="pr-0">
                      <button onClick={() => openIdentities(a.asset_id)} aria-label="Show identities"
                        className="text-txt-light hover:text-navy">
                        {expanded === a.asset_id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                    </Td>
                    <Td>
                      <button onClick={() => setEditingId(a.asset_id)}
                        className="text-left group">
                        <div className="font-semibold text-navy text-[13px] group-hover:text-gold-dark
                                        group-hover:underline underline-offset-2 transition-colors">
                          {a.nickname || a.fleet_code}
                        </div>
                        <div className="text-[11px] text-txt-light font-mono flex flex-wrap items-center gap-1.5">
                          {a.asset_ref && (
                            <span className="text-violet font-bold">{a.asset_ref}</span>
                          )}
                          <span>{a.fleet_code}{a.registration_no ? ` · ${a.registration_no}` : ""}</span>
                        </div>
                        {/* How stale this row is. A register that cannot say
                            when a machine was last touched asks people to
                            trust every row equally, and a tipper last edited
                            in 2019 has not earned the same confidence as one
                            edited this morning. */}
                        <div className="text-[10.5px] text-txt-light/80 mt-0.5">
                          {changedWhen(a.updated_at ?? a.created_at)}
                          {a.last_changed_by ? ` by ${a.last_changed_by}` : ""}
                        </div>
                      </button>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <Chip tone={CATEGORY_TONE[a.category] ?? "slate"} dot={false}>{a.asset_type}</Chip>
                        {/* Only the electric ones are marked. Badging every
                            diesel machine as "not electric" is noise on a fleet
                            that is mostly diesel. */}
                        {(a.propulsion === "EV" || a.propulsion === "HYBRID") && (
                          <Chip tone={a.propulsion === "EV" ? "emerald" : "sky"} dot={false}
                                title={a.propulsion === "EV" ? "Electric" : "Hybrid"}>
                            <Zap className="w-3 h-3" />
                            {a.propulsion === "EV" ? "EV" : "Hybrid"}
                          </Chip>
                        )}
                      </span>
                    </Td>
                    <Td className="hidden md:table-cell text-txt-muted">
                      {[a.make, a.model].filter(Boolean).join(" ") || "—"}
                    </Td>
                    <Td>
                      {a.ownership === "HIRED"
                        ? <Chip tone="amber" dot={false}>{a.owner ?? "Hired"}</Chip>
                        : <span className="text-txt-muted">BAL</span>}
                    </Td>
                    <Td>
                      {a.alias_count === 0
                        ? <Chip tone="amber">none</Chip>
                        : <span className="text-[11px] font-mono text-txt-muted">{a.alias_systems}</span>}
                    </Td>
                    {/* Its own column rather than a third line under the
                        machine code. How stale a row is deserves to be
                        scannable down the page — a register that cannot say
                        when a machine was last touched asks people to trust
                        every row equally, and a tipper last edited in 2019 has
                        not earned the same confidence as one edited this
                        morning. */}
                    <Td className="hidden lg:table-cell whitespace-nowrap">
                      <span className="block text-[11.5px] text-txt-muted tabular-nums">
                        {changedWhen(a.updated_at ?? a.created_at)}
                      </span>
                      {a.last_changed_by && (
                        <span className="block text-[10.5px] text-txt-light">
                          {a.last_changed_by}
                        </span>
                      )}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {a.approval_status && a.approval_status !== "APPROVED" && (
                        <Chip tone={APPROVAL_TONE[a.approval_status] ?? "slate"} className="mr-1.5">
                          {a.approval_status.replace("_", " ").toLowerCase()}
                        </Chip>
                      )}
                      <Chip tone={STATUS_TONE[a.status] ?? "slate"}>
                        {STAGE_LABEL[a.status] ?? a.status.toLowerCase()}
                      </Chip>
                    </Td>
                  </tr>

                  {expanded === a.asset_id && (
                    <tr className="bg-bg-light">
                      <Td /><Td colSpan={7} className="pb-4">
                        <div className="text-[10.5px] font-bold uppercase tracking-[.12em] text-txt-light mb-2 font-condensed">
                          What other systems call this machine
                        </div>
                        {identities.length === 0 ? (
                          <p className="text-txt-muted text-[12px] mb-3">
                            Nothing linked yet — this machine&apos;s telematics, handover and
                            weighbridge records cannot be joined to it.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2 mb-3">
                            {identities.map((i) => (
                              <span key={i.asset_identity_id}
                                className="inline-flex items-center gap-2 rounded-lg bg-bg-base ring-1 ring-border px-2.5 py-1 text-[11.5px]">
                                <span className="text-txt-light font-semibold">{i.system}</span>
                                <span className="font-mono text-navy">{i.external_code}</span>
                                {mayManage && (
                                  <button onClick={() => removeAlias(i.asset_identity_id, a.asset_id)}
                                    className="text-txt-light hover:text-rose" aria-label="Remove">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                        {mayManage && <AliasAdder onAdd={(s, c) => addAlias(a.asset_id, s, c)} />}

                        {/* Notes live where the machine is, not on a screen
                            somebody has to remember to open. */}
                        <div className="mt-4">
                          <CommentThread entityType="ASSET" entityId={a.asset_id}
                            title={`Notes on ${a.fleet_code || a.asset_ref || "this machine"}`} />
                        </div>
                      </Td>
                    </tr>
                  )}
                </React.Fragment>
                ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </Card>
      {/* The queue: telematics with nothing to attribute it to */}
      {unmapped.length > 0 && (
        <div ref={queue}>
        <Card tone="amber">
          <CardHeader title={`${unmapped.length} machines transmitting but unregistered`}
            icon={Radio} tone="amber"
            subtitle="These send telematics the platform cannot attribute to anything. Registering one links its history in the same action."
            actions={unmapped.length > 8 && (
              <Button size="sm" variant="secondary" onClick={() => setAllUnmapped((v) => !v)}>
                {allUnmapped ? "Show fewer" : `Show all ${unmapped.length}`}
              </Button>
            )} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr><Th>Telematics name</Th><Th>Feed</Th><Th className="text-right">Records</Th>
                    <Th>Last seen</Th><Th className="text-right">Action</Th></tr>
              </thead>
              <tbody>
                {(allUnmapped ? unmapped : unmapped.slice(0, 8)).map((u) => (
                  <tr key={`${u.feed}-${u.vehicle_desc}`} className="hover:bg-bg-light transition-colors">
                    <Td className="font-mono text-[12px] text-navy font-semibold">{u.vehicle_desc}</Td>
                    <Td><Chip tone={u.feed === "MAN" ? "sky" : "violet"} dot={false}>{u.feed}</Chip></Td>
                    <Td className="text-right tabular-nums">{u.rows_.toLocaleString()}</Td>
                    <Td className="text-txt-muted">{String(u.last_seen ?? "").slice(0, 16).replace("T", " ")}</Td>
                    <Td className="text-right">
                      {mayManage && (
                        <Button size="sm" variant="primary" onClick={() => startRegister(u)}>
                          <Plus className="w-3.5 h-3.5" /> Register
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!allUnmapped && unmapped.length > 8 && (
            <button type="button" onClick={() => setAllUnmapped(true)}
              className="w-full px-5 py-3 text-[12.5px] font-semibold text-gold-dark
                         border-t border-border-light hover:bg-gold/[0.05] transition-colors">
              {unmapped.length - 8} more waiting to be registered
            </button>
          )}
        </Card>
        </div>
      )}


    </div>
  );
}

/**
 * The same register as cards.
 *
 * A table is for reading one column down a hundred rows; this is for reading
 * one machine. It is also what survives a phone, where eight columns become a
 * sideways scroll that nobody performs — so the same list is available in a
 * shape that wraps.
 *
 * Every card carries the same facts in the same places, so the eye can move
 * between them without re-reading: name and reference at the top, what it is
 * and what it runs on in the middle, who owns it and when it last moved along
 * the bottom.
 */
function CardGrid({ sections, grouped, onOpen, empty }: {
  sections: Section[]; grouped: boolean;
  onOpen: (id: number) => void; empty: boolean;
}) {
  if (sections.every((s) => s.rows.length === 0)) {
    return (
      <p className="px-5 py-12 text-center text-[13px] text-txt-light">
        {empty
          ? "No machine registered yet — start from the unregistered list below, those are transmitting already."
          : "No machine matches that search."}
      </p>
    );
  }
  return (
    <div className="p-4 space-y-5">
      {sections.map((sec) => (
        <section key={sec.key || "_all"}>
          {grouped && (
            <h3 className="flex items-center gap-2 mb-2.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${TONE_DOT[sec.tone]}`} />
              <span className="font-semibold text-[12.5px] text-navy">{sec.label}</span>
              <span className="text-[11px] text-txt-light tabular-nums">{sec.rows.length}</span>
              <span className="flex-1 h-px bg-border-light" />
            </h3>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {sec.rows.map((a) => (
        <button key={a.asset_id} type="button" onClick={() => onOpen(a.asset_id)}
          className="text-left rounded-xl border border-border-light bg-bg-base p-3.5
                     shadow-sm hover:border-gold hover:shadow-md hover:-translate-y-px
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40
                     transition-all flex flex-col gap-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-navy text-[13.5px] truncate">
                {a.nickname || a.fleet_code}
              </div>
              <div className="text-[11px] font-mono text-txt-light truncate">
                {a.asset_ref && <span className="text-violet font-bold">{a.asset_ref}</span>}
                {a.asset_ref && " · "}{a.fleet_code}
              </div>
            </div>
            <span className="shrink-0 flex flex-col items-end gap-1">
              <Chip tone={STATUS_TONE[a.status] ?? "slate"}>
                {STAGE_LABEL[a.status] ?? a.status.toLowerCase()}
              </Chip>
              {a.approval_status && a.approval_status !== "APPROVED" && (
                <Chip tone={APPROVAL_TONE[a.approval_status] ?? "slate"}>
                  {a.approval_status.replace("_", " ").toLowerCase()}
                </Chip>
              )}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={CATEGORY_TONE[a.category] ?? "slate"} dot={false}>{a.asset_type}</Chip>
            {(a.propulsion === "EV" || a.propulsion === "HYBRID") && (
              <Chip tone={a.propulsion === "EV" ? "emerald" : "sky"} dot={false}>
                <Zap className="w-3 h-3" />{a.propulsion === "EV" ? "EV" : "Hybrid"}
              </Chip>
            )}
            {a.ownership === "HIRED"
              ? <Chip tone="amber" dot={false}>{a.owner ?? "Hired"}</Chip>
              : <Chip tone="slate" dot={false}>BAL</Chip>}
          </div>

          {/* A dash rather than nothing: a card with a missing line reads as a
              card with a different shape, and the grid stops being scannable. */}
          <div className="text-[11.5px] text-txt-muted truncate">
            <Gauge className="w-3 h-3 inline-block mr-1.5 -mt-px text-txt-light" />
            {[a.make, a.model].filter(Boolean).join(" ") || "make and model not recorded"}
          </div>

          <div className="mt-auto pt-2 border-t border-border-light
                          flex items-center justify-between gap-2 text-[11px]">
            <span className="text-txt-light truncate">
              {changedWhen(a.updated_at ?? a.created_at)}
              {a.last_changed_by ? ` by ${a.last_changed_by}` : ""}
            </span>
            <span className="shrink-0 inline-flex items-center gap-1 text-txt-light font-mono">
              <Link2 className="w-3 h-3" />
              {a.alias_count ? a.alias_systems : "none"}
            </span>
          </div>
        </button>
      ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AliasAdder({ onAdd }: { onAdd: (system: string, code: string) => void }) {
  const [system, setSystem] = useState("TELEMATICS");
  const [code, setCode] = useState("");
  const submit = () => { if (code.trim()) { onAdd(system, code); setCode(""); } };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={system} onChange={(e) => setSystem(e.target.value)}
        className="bg-bg-base border border-border rounded-lg px-2.5 py-1.5 text-[12px] text-txt-primary focus:outline-none focus:border-gold">
        {["TELEMATICS", "HOTO", "WEIGHBRIDGE", "RFID", "SAP", "SECURITY", "LEGACY"].map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <input value={code} onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder="The name that system uses, e.g. MAN18"
        className={`${inputClass} font-mono w-[280px] max-w-full py-1.5`} />
      <Button size="sm" variant="secondary" onClick={submit} disabled={!code.trim()}>
        <Link2 className="w-3.5 h-3.5" /> Link
      </Button>
    </div>
  );
}
