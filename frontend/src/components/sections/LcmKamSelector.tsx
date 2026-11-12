"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, History, Link2, Loader2, Network, UserPlus } from "lucide-react";
import api from "@/lib/api";
import KamPicker from "@/components/sections/KamPicker";

/**
 * The LCM KAM Selector — what each loss head is called, who owns it, whether
 * it is controllable, and which head of department it rolls up to.
 *
 * FOUR COLUMNS, THREE DIFFERENT CONSEQUENCES. The Loss Description is the
 * words on the matrix. The Loss Type decides the controllable /
 * non-controllable split of the rupee value at the foot of it. The KAM names
 * the owner on the row, and Rolls up to moves that row's money between the
 * nodes of the KAM Wise Loss Tree — which is why the two are separate and not
 * derived from each other: H.S.D shortage is owned by one person and reports
 * to another, and so do two other heads.
 *
 * THE DATE IS THE EDIT, NOT A FILTER — the same rule as the Equipment Status
 * Selector beside it. A choice applies from the day it is made until it is
 * changed, so an October matrix keeps October's owners after November has
 * been reassigned.
 *
 * WHAT IS NOT ON THIS SCREEN. Which loss heads exist. That is read from the
 * columns of the shift log, so a loss reason the mine starts recording
 * reaches the matrix on its own — as Unclassified, at the bottom — and
 * appears here once it has been classified. A fixed list here would let a new
 * head go missing, and the matrix would quietly stop footing.
 */

type LossType = "Controllable" | "Non Controllable" | "Unclassified";

interface Head {
  column_name: string;
  label: string;
  loss_type: LossType;
  kam_name: string | null;
  role_code: string | null;
  sl_order: number | null;
  is_active: boolean;
  effective_from: string;
  revision: number;
}

interface Kam {
  kam_name: string;
  emp_id: string | null;
  status: string;
  /** Read live from SAP on every request, never copied — a copied
   *  designation is wrong from the first promotion. */
  sap_name: string | null;
  designation: string | null;
  department: string | null;
  /** False for a name typed before the register was wired in. Shown rather
   *  than hidden: these are exactly the ones that need an employee attached. */
  in_sap: boolean;
}
interface Role {
  role_code: string;
  title: string;
  /** Who runs this node of the tree. Null is a vacant post, not an error. */
  owner_kam: string | null;
  /** The head this one reports to — Electrical and Store under Engineering,
   *  Security under Human Resource. Shown so somebody picking a node knows
   *  where it sits; never added through, because the tree draws all seven on
   *  one line and each carries only its own heads. */
  parent_role_code?: string | null;
  /** Where that name came from: the KAM holding the most loss heads under the
   *  node ("derived"), an explicit override the mine set ("selected"), or the
   *  registry's fixed name when neither applies ("default"). */
  owner_source?: "derived" | "selected" | "default";
  owner_heads?: number;
  node_heads?: number;
  /** Two KAMs level on head count — the node is not derived, and the mine has
   *  to say who runs it. */
  owner_tied?: boolean;
  effective_from?: string | null;
  revision?: number | null;
}

interface Read { on_date: string; heads: Head[]; kams: Kam[]; roles: Role[] }

interface Edit {
  column_name: string; effective_from: string; action: string;
  field: string | null; old_value: string | null; new_value: string | null;
  entry_id: string; entry_date: string;
}

const TYPES: LossType[] = ["Controllable", "Non Controllable", "Unclassified"];

/** Sentinel value for the "add somebody from SAP" row in a KAM dropdown. It
 *  is never stored: picking it opens the employee register instead. */
const ADD_FROM_SAP = "__ADD_FROM_SAP__";

function stamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function onDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

/** The first of the month now showing, which is the day the OEE page opens
 *  its window on.
 *
 *  WHY NOT TODAY, WHICH IS WHAT THIS DEFAULTED TO AT FIRST. The OEE and LCM
 *  pages report days that have ENDED, so their window always stops at
 *  yesterday. A setting saved as "from today" is therefore one day ahead of
 *  anything those pages can show, and a mine marking a machine inactive saw
 *  nothing change and reasonably concluded the screen was broken. Defaulting
 *  to the first of the month makes the common case -- correcting the fleet
 *  for the month being looked at -- do what it looks like it does. A genuine
 *  mid-month change is still one click on the date. */
function monthStartIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** The last day the OEE and LCM pages can report: yesterday, because they
 *  only count days that have finished. */
function lastReportableIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MONTH_START = monthStartIso();
const LAST_REPORTABLE = lastReportableIso();

const TH = "px-2 py-1.5 text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary";
const TD = "px-2 py-1.5 text-[12px]";

const TYPE_TONE: Record<LossType, string> = {
  "Controllable":     "text-[#c62828]",
  "Non Controllable": "text-txt-secondary",
  "Unclassified":     "text-[#c8960c]",
};

type Draft = Partial<Record<"label" | "loss_type" | "kam_name" | "role_code"
  | "sl_order" | "is_active", string | number | boolean | null>>;

export default function LcmKamSelector({ onSaved }: {
  onSaved: () => void | Promise<void>;
}) {
  const [effective, setEffective] = useState(MONTH_START);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  /** Pending owner per tree node. "" is a deliberate vacancy, not "untouched"
   *  — a key being absent is what means untouched. */
  const [roleDraft, setRoleDraft] = useState<Record<string, string>>({});
  /** null = closed; otherwise "add", or the KAM name being linked. */
  const [picker, setPicker] = useState<
    null | { mode: "add" | "link"; name?: string;
              /** Fill this tree node with whoever gets added. */
              forRole?: string;
              /** Fill this loss head's KAM with whoever gets added. */
              forHead?: string }>(null);

  useEffect(() => {
    setDraft({}); setRoleDraft({}); setError(null); setDone(null);
  }, [effective]);

  const q = useQuery<Read>({
    queryKey: ["oee-settings", "loss-heads", effective],
    queryFn: async () =>
      (await api.get("/oee-settings/loss-heads", { params: { on_date: effective } })).data,
    staleTime: 10 * 1000,
  });

  const hist = useQuery<{ history: Edit[] }>({
    queryKey: ["oee-settings", "loss-heads", "history"],
    queryFn: async () =>
      (await api.get("/oee-settings/loss-heads/history", { params: { limit: 120 } })).data,
    enabled: showHistory,
    staleTime: 10 * 1000,
  });

  const heads = useMemo(() => q.data?.heads ?? [], [q.data]);
  const kams = q.data?.kams ?? [];
  // The Chief and COB are not nodes a mines loss head reports to, and
  // Unmapped is where the unclassified fall rather than somewhere to put one
  // on purpose. Offering any of the three would let somebody file real money
  // outside the three heads the tree is drawn for.
  const roles = (q.data?.roles ?? []).filter(
    (r) => !["CHIEF", "COB", "UNMAPPED"].includes(r.role_code));
  /* The owner block covers every node the tree DRAWS, which is a different
     list: the Chief sits at the root and COB alongside, and both carry a name
     on a card. Unmapped is the only one left out — it is where unclassified
     heads fall, and it has no owner by design. */
  const allRoles = (q.data?.roles ?? []).filter((r) => r.role_code !== "UNMAPPED");

  /* WHO A NODE REPORTS TO, SHOWN BUT NEVER SUMMED. Electrical and Store sit
     under Engineering, Security under Human Resource, yet the tree draws all
     seven on one line and each card carries only its own heads. Rolling the
     money up as well would count Electrical's loss inside Engineering's too
     and the root would stop matching the matrix. So the reporting line is
     shown here — where somebody choosing a node needs to know it — and
     nowhere in the arithmetic. */
  function parentOf(code: string | null | undefined): string | null {
    if (!code) return null;
    return (q.data?.roles ?? []).find((r) => r.role_code === code)?.title ?? code;
  }

  function set(col: string, field: keyof Draft, value: string | number | boolean | null) {
    setDraft((d) => ({ ...d, [col]: { ...(d[col] ?? {}), [field]: value } }));
    setDone(null);
  }

  function shown<T>(h: Head, field: keyof Draft, fallback: T): T | string | number | boolean | null {
    const d = draft[h.column_name];
    return d && field in d ? d[field]! : fallback;
  }

  const changed = Object.entries(draft).filter(([, d]) => Object.keys(d).length > 0);
  const roleChanged = Object.entries(roleDraft).filter(
    ([code, owner]) => owner !== (allRoles.find((r) => r.role_code === code)?.owner_kam ?? ""));

  async function save() {
    setBusy(true); setError(null); setDone(null);
    try {
      const said: string[] = [];

      if (changed.length) {
        const changes = changed.map(([column_name, d]) => ({ column_name, ...d }));
        const r = await api.post("/oee-settings/loss-heads",
          { effective_from: effective, changes });
        const n = r.data?.fields ?? 0;
        const k = r.data?.written?.length ?? 0;
        if (n) said.push(`${n} setting${n === 1 ? "" : "s"} on ${k} loss head${k === 1 ? "" : "s"}`);
      }

      /* Saved as its own request against its own table, with the SAME date.
         The node owner is a different fact from a head's KAM — see the note
         above the block — and keeping the two writes apart means a rejected
         owner cannot roll back a head's classification. */
      if (roleChanged.length) {
        const r = await api.post("/oee-settings/roles", {
          effective_from: effective,
          changes: roleChanged.map(([role_code, owner]) => ({
            role_code, owner_kam: owner === "" ? null : owner,
          })),
        });
        const n = r.data?.fields ?? 0;
        if (n) said.push(`${n} tree node owner${n === 1 ? "" : "s"}`);
      }

      setDone(said.length === 0
        ? "Nothing had changed — nothing was written."
        : `${said.join(" and ")}, from ${onDay(effective)}.`);
      setDraft({});
      setRoleDraft({});
      await q.refetch();
      if (showHistory) await hist.refetch();
      await onSaved();
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "The loss heads could not be saved.");
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="px-4 py-2.5 border-b border-border-light bg-bg-soft flex items-end gap-3 flex-wrap">
        <div>
          <label htmlFor="lks-date"
            className="block text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary mb-1">
            Effective from
          </label>
          <input
            id="lks-date" type="date" value={effective}
            onChange={(e) => setEffective(e.target.value)}
            className="border border-border rounded px-2 py-1.5 text-[12px] font-semibold text-navy bg-white"
          />
        </div>
        <p className="text-[10px] leading-relaxed text-txt-muted max-w-sm">
          What is shown is what was in force on this day. What is saved applies
          from this day until it is changed again.
        </p>
        <button
          onClick={() => setPicker({ mode: "add" })}
          className="ml-auto flex items-center gap-1 text-[11px] text-steel hover:text-navy"
        >
          <UserPlus size={12} /> Add KAM
        </button>
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-steel hover:text-navy"
        >
          <History size={12} /> {showHistory ? "Hide" : "Show"} changes
        </button>
      </div>

      {picker && (
        <KamPicker
          mode={picker.mode}
          linkTo={picker.name}
          onClose={() => setPicker(null)}
          onDone={async (kamName) => {
            await q.refetch();
            /* Opened from a tree node, so put the person straight into that
               node rather than making the user find the name they just added
               in a dropdown. */
            if (kamName && picker.forRole) {
              setRoleDraft((d) => ({ ...d, [picker.forRole!]: kamName }));
              setDone(null);
            }
            if (kamName && picker.forHead) {
              set(picker.forHead, "kam_name", kamName);
            }
          }}
        />
      )}

      {/* THE NAMES THAT ARE NOT YET A PERSON. Eight were typed by hand before
          the register was wired in, and five of them match no employee at
          all. Named here rather than left to be discovered: a KAM with no
          employee id can be added again tomorrow under another spelling and
          own loss heads as two different people. */}
      {kams.some((k) => !k.in_sap) && (
        <div className="px-4 py-2 bg-[#e3f2fd] border-b border-[#90caf9]
                        flex items-start gap-2 flex-wrap">
          <Link2 size={13} className="text-[#1565c0] mt-0.5 shrink-0" />
          <p className="text-[11px] text-[#0d47a1] leading-relaxed">
            <strong>{kams.filter((k) => !k.in_sap).length} name(s) are not
            linked to an employee record.</strong>{" "}
            {kams.filter((k) => !k.in_sap).map((k, i, a) => (
              <span key={k.kam_name}>
                <button
                  type="button"
                  onClick={() => setPicker({ mode: "link", name: k.kam_name })}
                  className="underline font-semibold hover:text-[#1565c0]"
                >
                  {k.kam_name}
                </button>
                {i < a.length - 1 ? ", " : ""}
              </span>
            ))}
            {" "}— click one to find them in SAP.
          </p>
        </div>
      )}


      {/* THE ONE MISTAKE THIS SCREEN INVITES, caught before it is made.
          A date later than the last completed day cannot change any figure
          on the OEE or LCM pages, because those pages stop at yesterday.
          Saving it is legitimate -- a change can be scheduled -- but it must
          not look like nothing happened. */}
      {effective > LAST_REPORTABLE && (
        <div className="px-4 py-2 bg-[#e3f2fd] border-b border-[#90caf9] flex items-start gap-2">
          <AlertTriangle size={13} className="text-[#1565c0] mt-0.5 shrink-0" />
          <p className="text-[11px] text-[#0d47a1] leading-relaxed">
            <strong>This starts on {onDay(effective)}, which is after the last
            day those pages can report ({onDay(LAST_REPORTABLE)}).</strong>{" "}
            It will be saved, but the figures will not move until the window
            reaches it — the OEE and LCM pages count only days that have
            ended.{" "}
            <button
              type="button"
              onClick={() => setEffective(MONTH_START)}
              className="underline font-semibold hover:text-[#1565c0]"
            >
              Apply from {onDay(MONTH_START)} instead
            </button>
          </p>
        </div>
      )}

      {/* ── Who runs each node of the KAM Wise Loss Tree ──────────────────
          THE CARDS FOLLOW THIS TABLE ON THEIR OWN. A node's owner is the KAM
          holding the most loss heads under it, so changing a head's KAM below
          moves the name above too — which is what the mine expected, and what
          the tree did not do while its names sat in a fixed column nothing
          could write. This block is the OVERRIDE for what the heads cannot
          answer: Chief of Mines and Head COB have no heads under them, a
          department head may own none personally, and a tie is not something
          to resolve by guessing. */}
      {allRoles.length > 0 && (
        <div className="px-4 py-3 border-b border-border-light bg-[#fafbfd]">
          <div className="flex items-center gap-2 mb-2">
            <Network size={12} className="text-[#6a1b9a]" />
            <span className="text-[10px] font-condensed font-bold tracking-widest
                             uppercase text-navy">
              KAM Wise Loss Tree — node owners
            </span>
            <span className="text-[10px] font-mono text-txt-light">
              the names on the tree&rsquo;s cards, from {onDay(effective)}
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {allRoles.map((r) => {
              const cur = r.owner_kam ?? "";
              const val = r.role_code in roleDraft ? roleDraft[r.role_code] : cur;
              const dirty = val !== cur;
              return (
                <div key={r.role_code}
                     className={`border rounded px-2.5 py-2 ${
                       dirty ? "border-amber-300 bg-amber-50/60"
                             : "border-border bg-white"}`}>
                  <label htmlFor={`role-${r.role_code}`}
                         className="block text-[9px] font-condensed font-bold
                                    tracking-widest uppercase text-txt-secondary mb-1">
                    {r.title}
                    {r.parent_role_code && r.parent_role_code !== "CHIEF" && (
                      <span className="ml-1 font-normal normal-case tracking-normal
                                       text-[9px] text-txt-light">
                        · reports to {parentOf(r.parent_role_code)}
                      </span>
                    )}
                  </label>
                  <select
                    id={`role-${r.role_code}`}
                    value={val}
                    onChange={(e) => {
                      /* THE NAME COMES FROM SAP, NEVER FROM A TEXT BOX — the
                         same rule the KAM column below follows. Somebody not
                         yet on the list is added through the employee
                         register and then selected, so a node owner is always
                         an employee with an id behind the name. */
                      if (e.target.value === ADD_FROM_SAP) {
                        setPicker({ mode: "add", forRole: r.role_code });
                        return;
                      }
                      setRoleDraft((d) => ({ ...d, [r.role_code]: e.target.value }));
                      setDone(null);
                    }}
                    className="w-full border border-border rounded px-1.5 py-1
                               text-[12px] bg-white font-semibold text-navy"
                  >
                    {/* A vacant post is a real answer — a node whose head has
                        left should read as vacant, not as the last holder. */}
                    <option value="">— vacant —</option>
                    {kams.map((k) => (
                      <option key={k.kam_name} value={k.kam_name}>{k.kam_name}</option>
                    ))}
                    <option value={ADD_FROM_SAP}>+ Add from SAP…</option>
                  </select>
                  <p className="mt-1 text-[9px] font-mono text-txt-light">
                    {dirty
                      ? <span className="text-amber-700">was {cur || "vacant"}</span>
                      : r.owner_tied
                        ? <span className="text-[#c8960c]">
                            its heads tie — set it here
                          </span>
                        : r.owner_source === "derived"
                          ? <span className="text-[#2e7d32]">
                              follows the KAMs below · {r.owner_heads} of {r.node_heads} heads
                            </span>
                          : r.owner_source === "selected"
                            ? `set here on ${r.effective_from ? onDay(r.effective_from) : "—"}`
                            : "no loss heads under it — set it here"}
                  </p>
                </div>
              );
            })}
          </div>

          <p className="mt-2 text-[10px] text-txt-muted leading-relaxed">
            A node marked <span className="text-[#2e7d32] font-semibold">follows
            the KAMs below</span> needs nothing here — change a head&rsquo;s KAM in
            the table and the card changes with it. Setting one here
            <strong> overrides</strong> that for good, from the effective date
            above, so use it only where the heads cannot answer. Either way this
            renames a card and <strong>moves no money</strong> — which node a
            head&rsquo;s loss rolls up to is <em>Rolls up to</em> in the table below.
          </p>
        </div>
      )}

      <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
        <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
        <p className="text-[11px] text-amber-900 leading-relaxed">
          <strong>Loss Type</strong> decides the controllable / non-controllable
          split at the foot of the matrix. <strong>Rolls up to</strong> moves
          that head&rsquo;s money between the nodes of the KAM Wise Loss Tree —
          it is a separate question from who the KAM is, and three heads
          deliberately answer the two differently.
        </p>
      </div>

      <div className="max-h-[56vh] overflow-y-auto">
        {q.isLoading && (
          <div className="px-4 py-10 text-center text-[12px] text-txt-muted">
            <Loader2 size={16} className="inline animate-spin mr-2" />Loading…
          </div>
        )}

        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white shadow-[0_1px_0_0_var(--color-border-light)]">
            <tr>
              <th className={`${TH} text-right w-10`}>Sl</th>
              <th className={`${TH} text-left min-w-[180px]`}>Loss description</th>
              <th className={`${TH} text-left`}>Loss type</th>
              <th className={`${TH} text-left`}>KAM</th>
              <th className={`${TH} text-left`}>Rolls up to</th>
              <th className={`${TH} text-left`}>Set on</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {heads.map((h) => {
              const d = draft[h.column_name] ?? {};
              const dirty = Object.keys(d).length > 0;
              const lt = shown(h, "loss_type", h.loss_type) as LossType;
              return (
                <tr key={h.column_name}
                    className={dirty ? "bg-amber-50/60" : "hover:bg-bg-light"}>
                  <td className={`${TD} text-right tabular-nums text-txt-muted`}>
                    {h.sl_order ?? "—"}
                  </td>
                  <td className={TD}>
                    <input
                      type="text" maxLength={80}
                      value={shown(h, "label", h.label) as string}
                      onChange={(e) => set(h.column_name, "label", e.target.value)}
                      className="w-full border border-border rounded px-1.5 py-1
                                 text-[12px] font-semibold text-navy bg-white"
                    />
                    {/* THE COLUMN, NOT THE LABEL, IS THE KEY. Shown so that
                        renaming a head does not look like creating one. */}
                    <span className="block mt-0.5 text-[9px] font-mono text-txt-light">
                      {h.column_name}
                    </span>
                  </td>
                  <td className={TD}>
                    <select
                      value={lt}
                      onChange={(e) => set(h.column_name, "loss_type", e.target.value)}
                      className={`border border-border rounded px-1.5 py-1 text-[11px]
                                  font-semibold bg-white ${TYPE_TONE[lt]}`}
                    >
                      {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className={TD}>
                    <select
                      value={(shown(h, "kam_name", h.kam_name) as string) ?? ""}
                      onChange={(e) => {
                        // Same rule as the node owners above: a name that is
                        // not on the list is added FROM THE SAP REGISTER and
                        // then chosen, never typed.
                        if (e.target.value === ADD_FROM_SAP) {
                          setPicker({ mode: "add", forHead: h.column_name });
                          return;
                        }
                        set(h.column_name, "kam_name",
                          e.target.value === "" ? null : e.target.value);
                      }}
                      className="border border-border rounded px-1.5 py-1 text-[11px] bg-white"
                    >
                      <option value="">— none —</option>
                      {kams.map((k) => (
                        <option key={k.kam_name} value={k.kam_name}>
                          {k.kam_name}
                          {k.designation ? ` — ${k.designation}` : k.in_sap ? "" : " (not linked)"}
                        </option>
                      ))}
                      <option value={ADD_FROM_SAP}>+ Add from SAP…</option>
                    </select>
                  </td>
                  <td className={TD}>
                    <select
                      value={(shown(h, "role_code", h.role_code) as string) ?? ""}
                      onChange={(e) => set(h.column_name, "role_code",
                        e.target.value === "" ? null : e.target.value)}
                      className="border border-border rounded px-1.5 py-1 text-[11px] bg-white"
                    >
                      <option value="">— unmapped —</option>
                      {roles.map((r) => (
                        <option key={r.role_code} value={r.role_code}>
                          {r.title}
                          {/* Only the three that sit under another HEAD say so.
                              Every other node reports to the Chief, and
                              printing that on all of them would bury the one
                              distinction this line exists to make. */}
                          {r.parent_role_code && r.parent_role_code !== "CHIEF"
                            ? ` — under ${parentOf(r.parent_role_code)}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={`${TD} text-[10px] text-txt-light tabular-nums`}>
                    {onDay(h.effective_from)}
                    {h.effective_from !== effective && (
                      <span className="ml-1 text-txt-light/70">(carried)</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {showHistory && (
          <div className="border-t-2 border-border">
            <div className="px-4 py-1.5 bg-bg-section text-[10px] font-condensed
                            font-bold tracking-widest uppercase text-navy">
              Every change, newest first
            </div>
            {hist.isLoading && (
              <p className="px-4 py-3 text-[11px] text-txt-muted">Loading…</p>
            )}
            {!hist.isLoading && (hist.data?.history.length ?? 0) === 0 && (
              <p className="px-4 py-3 text-[11px] text-txt-muted">
                Nothing has been changed yet.
              </p>
            )}
            <ul className="divide-y divide-border-light">
              {(hist.data?.history ?? []).map((h, i) => (
                <li key={i} className="px-4 py-1.5 text-[11px] flex gap-2 flex-wrap">
                  <span className="font-semibold text-navy min-w-[110px]">
                    {h.column_name}
                  </span>
                  <span className="text-txt-secondary">{h.field}</span>
                  <span className="text-txt-muted">
                    {h.old_value ?? "—"} → <strong>{h.new_value ?? "—"}</strong>
                  </span>
                  <span className="ml-auto text-txt-light tabular-nums">
                    from {onDay(h.effective_from)} · {h.entry_id} · {stamp(h.entry_date)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-border-light flex items-center gap-3 flex-wrap">
        {error && (
          <p className="text-[11px] text-danger flex items-center gap-1">
            <AlertTriangle size={12} /> {error}
          </p>
        )}
        {done && !error && (
          <p className="text-[11px] text-[#2e7d32] flex items-center gap-1">
            <Check size={12} /> {done}
          </p>
        )}
        <span className="ml-auto text-[11px] text-txt-muted">
          {changed.length === 0 && roleChanged.length === 0 ? "No changes"
            : [changed.length
                 ? `${changed.length} loss head${changed.length === 1 ? "" : "s"}`
                 : null,
               roleChanged.length
                 ? `${roleChanged.length} node owner${roleChanged.length === 1 ? "" : "s"}`
                 : null].filter(Boolean).join(" and ") + " changed"}
        </span>
        <button
          onClick={save}
          disabled={busy || (changed.length === 0 && roleChanged.length === 0)}
          className="px-4 py-1.5 rounded bg-navy text-white text-[12px] font-semibold
                     disabled:opacity-40 disabled:cursor-not-allowed hover:bg-navy/90"
        >
          {busy ? <Loader2 size={13} className="inline animate-spin mr-1" /> : null}
          Save from {onDay(effective)}
        </button>
      </div>
    </>
  );
}
