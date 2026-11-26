"use client";
/** Who can sign in, and what each person may do. */
import { matchesSearch } from "@/lib/search";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Trash2, Loader2, UserPlus, Check, X, ChevronDown } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import { Alert, Chip, Button, Card, CardHeader, EmptyRow, Td, Th, Tile, inputClass } from "./ui";
import RoleGroupPicker from "./RoleGroupPicker";
import { roleNameWithin, splitRoleGroups, type RoleGroup } from "./roleGroups";

interface Role {
  role_id: number; code: string; name: string; description?: string | null;
  permissions: string[];
  // Migration 139. A grouped role is an ordinary role; the group only decides
  // that it is offered through one chip and a picker rather than a chip of
  // its own. See roleGroups.ts.
  group_code?: string | null;
  group_name?: string | null;
  group_description?: string | null;
  group_sort_order?: number | null;
}
interface AccessUser {
  emp_id: string; name?: string; department?: string; designation?: string;
  roles: { role_id: number; code: string; name: string }[];
  granted_by: string | null;
}
interface EmployeeHit {
  emp_id: string; name: string | null; department: string | null; designation: string | null;
}

export default function UsersPanel() {
  const me = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);
  const mayManage = can("access.users.manage");

  const [users, setUsers] = useState<AccessUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const [hits, setHits] = useState<EmployeeHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<number[]>([]);
  // "role:CODE" or "group:CODE" — a group tile filters on holding ANY of its
  // roles, which is the question the tile's own number answers.
  const [roleFilter, setRoleFilter] = useState<string>("");
  /** The open picker, if any. `target` is who it is for; `into` says whether
   *  applying edits the draft being edited or saves immediately. */
  const [picker, setPicker] = useState<
    { group: RoleGroup<Role>; target: string; label: string;
      value: number[]; into: "draft" | "save" } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [u, r] = await Promise.all([api.get("/access/users"), api.get("/access/roles")]);
      setUsers(u.data ?? []); setRoles(r.data ?? []);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not load users.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const term = addQuery.trim();
    if (term.length < 2) { setHits([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/access/employees", { params: { q: term } });
        const have = new Set(users.map((u) => u.emp_id));
        setHits((r.data ?? []).filter((h: EmployeeHit) => !have.has(h.emp_id)));
      } catch { setHits([]); } finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [addQuery, users]);

  const { loose, groups } = useMemo(() => splitRoleGroups(roles), [roles]);

  /** role_id → its group, for reading a person's held roles back. A person may
   *  hold a role this caller cannot see; it is simply not grouped, and falls
   *  through to a plain chip rather than disappearing. */
  const groupOf = useMemo(() => {
    const m = new Map<number, RoleGroup<Role>>();
    groups.forEach((g) => g.roles.forEach((r) => m.set(r.role_id, g)));
    return m;
  }, [groups]);

  /** What a person holds, split the same way the roles are. */
  const splitHeld = useCallback((held: { role_id: number; code: string; name: string }[]) => {
    const plain: typeof held = [];
    const inGroup = new Map<string, typeof held>();
    held.forEach((r) => {
      const g = groupOf.get(r.role_id);
      if (!g) { plain.push(r); return; }
      const list = inGroup.get(g.group_code) ?? [];
      list.push(r);
      inGroup.set(g.group_code, list);
    });
    return { plain, inGroup };
  }, [groupOf]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    users.forEach((u) => {
      u.roles.forEach((r) => { c[`role:${r.code}`] = (c[`role:${r.code}`] ?? 0) + 1; });
      // Counted once per person, not once per role they hold in it — the tile
      // says how many PEOPLE file something, and somebody filing four forms is
      // still one person.
      const seen = new Set<string>();
      u.roles.forEach((r) => {
        const g = groupOf.get(r.role_id);
        if (g) seen.add(g.group_code);
      });
      seen.forEach((gc) => { c[`group:${gc}`] = (c[`group:${gc}`] ?? 0) + 1; });
    });
    return c;
  }, [users, groupOf]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter) {
        const held = roleFilter.startsWith("group:")
          ? u.roles.some((r) => groupOf.get(r.role_id)?.group_code === roleFilter.slice(6))
          : u.roles.some((r) => r.code === roleFilter.slice(5));
        if (!held) return false;
      }
      if (!q) return true;
      return matchesSearch(q, [u.name, u.emp_id, u.department, u.designation]);
    });
  }, [users, query, roleFilter, groupOf]);

  const saveRoles = async (emp_id: string, role_ids: number[]) => {
    setError(null);
    try {
      await api.put(`/access/users/${emp_id}/roles`, { role_ids });
      setNotice(`Access updated for ${emp_id}.`);
      setEditing(null); setAddQuery(""); setHits([]);
      await load();
      if (emp_id === me?.emp_id) await useAuth.getState().refresh();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not update access.");
    }
  };

  /** What the picker hands back, put where the picker was opened from. */
  const applyPicker = (ids: number[]) => {
    if (!picker) return;
    if (picker.into === "save") {
      // Granting nothing is not a grant. Saving an empty set here would write
      // "no roles" for somebody who has none yet, which looks like it worked
      // and leaves them unable to sign in.
      if (ids.length) void saveRoles(picker.target, ids);
      setPicker(null);
      return;
    }
    const mine = new Set(picker.group.roles.map((r) => r.role_id));
    setDraft((d) => [...d.filter((x) => !mine.has(x)), ...ids]);
    setPicker(null);
  };

  const revoke = async (u: AccessUser) => {
    setError(null);
    try {
      await api.delete(`/access/users/${u.emp_id}`);
      setNotice(`${u.name ?? u.emp_id} can no longer sign in.`);
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not remove access.");
    }
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gold" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && (
        <Alert tone="success"><span className="inline-flex items-center gap-2"><Check className="w-4 h-4" />{notice}</span></Alert>
      )}

      {/* Distribution — also the filter */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ...loose.map((r) => ({ key: `role:${r.code}`, name: r.name })),
          // One tile for the whole group. Nine tiles for nine entry forms
          // pushed the roles that decide what SECTION a person sees off the
          // first screen, which is what this consolidation is for.
          ...groups.map((g) => ({ key: `group:${g.group_code}`, name: g.name })),
        ].map((r) => {
          const active = roleFilter === r.key;
          return (
            <button key={r.key} onClick={() => setRoleFilter(active ? "" : r.key)}
              className={`text-left bg-bg-base border rounded-lg shadow-sm px-4 py-3 transition
                ${active ? "border-gold ring-1 ring-gold/30" : "border-border-light hover:border-border-strong"}`}>
              <div className="font-condensed text-[10px] font-bold uppercase tracking-[.14em] text-txt-light truncate">
                {r.name}
              </div>
              <div className="font-condensed font-extrabold text-[26px] leading-none mt-1.5 text-navy tabular-nums">
                {counts[r.key] ?? 0}
              </div>
              <div className="text-[11px] text-txt-muted mt-1">
                {active ? "filtering — click to clear" : "click to filter"}
              </div>
            </button>
          );
        })}
      </div>

      {/* Grant access */}
      {mayManage && (
        <Card>
          <CardHeader title="Give someone access"
            subtitle="The dashboard is invite-only — a person who is not listed below cannot sign in at all." />
          <div className="p-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-txt-light" />
              <input id="mh-add-user" value={addQuery} onChange={(e) => setAddQuery(e.target.value)}
                placeholder="Search by name or employee ID…"
                className={`${inputClass} pl-9`} />
              {searching && <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-txt-light" />}
            </div>

            {hits.length > 0 && (
              <ul className="mt-3 border border-border-light rounded divide-y divide-border-light overflow-hidden">
                {hits.map((h) => (
                  <li key={h.emp_id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 bg-bg-light">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-txt-primary font-medium truncate">
                        {h.name ?? h.emp_id}
                        <span className="text-txt-light font-normal"> · {h.emp_id}</span>
                      </div>
                      <div className="text-[11.5px] text-txt-muted truncate">
                        {[h.designation, h.department].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {loose.map((r) => (
                        <Button key={r.role_id} size="sm" variant="secondary"
                          onClick={() => saveRoles(h.emp_id, [r.role_id])}
                          title={`Give ${h.name ?? h.emp_id} the ${r.name} role`}>
                          <UserPlus className="w-3 h-3" />{r.name}
                        </Button>
                      ))}
                      {/* A group cannot be granted by one click -- which forms
                          is the whole question -- so it opens the picker and
                          saves what comes back. */}
                      {groups.map((g) => (
                        <Button key={g.group_code} size="sm" variant="secondary"
                          onClick={() => setPicker({
                            group: g, target: h.emp_id, value: [], into: "save",
                            label: h.name ?? h.emp_id,
                          })}
                          title={`Choose which forms ${h.name ?? h.emp_id} files`}>
                          <UserPlus className="w-3 h-3" />{g.name}…
                        </Button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {addQuery.trim().length >= 2 && !searching && hits.length === 0 && (
              <p className="text-[12px] text-txt-muted mt-3">
                Nobody new matches “{addQuery.trim()}” — they may already have access.
              </p>
            )}
          </div>
        </Card>
      )}

      {/* The register */}
      <Card>
        <CardHeader
          title={`People with access · ${visible.length}${visible.length !== users.length ? ` of ${users.length}` : ""}`}
          subtitle="Roles decide what each person may open. Everything is enforced on the data, not just the menu."
          actions={
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-light" />
              <input id="mh-filter-user" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
                className="bg-bg-base border border-border rounded pl-8 pr-3 py-1.5 text-[12px] text-txt-primary placeholder:text-txt-light focus:outline-none focus:border-gold w-full sm:w-[320px] lg:w-[440px] xl:w-[520px]" />
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px]">
            <thead>
              <tr>
                <Th>Person</Th>
                <Th className="hidden md:table-cell">Department</Th>
                <Th>Roles</Th>
                {mayManage && <Th className="text-right">Revoke</Th>}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <EmptyRow colSpan={mayManage ? 4 : 3}>
                  {users.length === 0 ? "Nobody has access yet." : "Nobody matches that filter."}
                </EmptyRow>
              )}
              {visible.map((u) => {
                const isMe = u.emp_id === me?.emp_id;
                const isEditing = editing === u.emp_id;
                return (
                  <tr key={u.emp_id} className="hover:bg-bg-light">
                    <Td>
                      <div className="text-txt-primary font-medium">
                        {u.name ?? u.emp_id}
                        <span className="text-txt-light font-normal"> · {u.emp_id}</span>
                        {isMe && <span className="ml-2 text-[10.5px] text-gold-dark font-semibold">YOU</span>}
                      </div>
                      {u.designation && <div className="text-[11px] text-txt-light">{u.designation}</div>}
                    </Td>
                    <Td className="hidden md:table-cell">{u.department ?? "—"}</Td>
                    <Td>
                      {isEditing ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            {loose.map((r) => {
                              const on = draft.includes(r.role_id);
                              return (
                                <button key={r.role_id}
                                  onClick={() => setDraft(on ? draft.filter((x) => x !== r.role_id) : [...draft, r.role_id])}
                                  className={`px-2.5 py-1 rounded border text-[11.5px] font-semibold transition
                                    ${on ? "bg-gold/10 border-gold text-gold-dark"
                                         : "bg-bg-base border-border text-txt-muted hover:border-border-strong"}`}>
                                  {on && <Check className="w-3 h-3 inline mr-1" />}{r.name}
                                </button>
                              );
                            })}
                            {/* One chip for the group. It cannot be toggled —
                                there is nothing sensible for a single click to
                                mean when the choice is "which of nine" — so it
                                opens the picker and shows the tally. */}
                            {groups.map((g) => {
                              const ids = g.roles.map((r) => r.role_id);
                              const n = draft.filter((x) => ids.includes(x)).length;
                              return (
                                <button key={g.group_code}
                                  onClick={() => setPicker({
                                    group: g, target: u.emp_id, into: "draft",
                                    value: draft, label: u.name ?? u.emp_id,
                                  })}
                                  title={`Choose which of the ${ids.length} forms this person files`}
                                  className={`px-2.5 py-1 rounded border text-[11.5px] font-semibold transition
                                    ${n ? "bg-gold/10 border-gold text-gold-dark"
                                        : "bg-bg-base border-border text-txt-muted hover:border-border-strong"}`}>
                                  {n > 0 && <Check className="w-3 h-3 inline mr-1" />}
                                  {g.name} · {n} of {ids.length}
                                  <ChevronDown className="w-3 h-3 inline ml-1" />
                                </button>
                              );
                            })}
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="primary" onClick={() => saveRoles(u.emp_id, draft)}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(() => {
                            const { plain, inGroup } = splitHeld(u.roles);
                            return (
                              <>
                                {plain.map((r) => <Chip key={r.role_id} tone="gold">{r.name}</Chip>)}
                                {/* A person filing four forms reads as four
                                    chips of an entirely different kind next to
                                    their dashboard roles. One chip, and the
                                    forms themselves on hover. */}
                                {groups.map((g) => {
                                  const held = inGroup.get(g.group_code);
                                  if (!held?.length) return null;
                                  const names = held
                                    .map((r) => roleNameWithin(g.name, r.name))
                                    .sort((a, b) => a.localeCompare(b));
                                  const whole = held.length === g.roles.length;
                                  return (
                                    <Chip key={g.group_code} tone="amber" title={names.join(", ")}>
                                      {g.name} · {whole ? "all forms"
                                        : `${held.length} ${held.length === 1 ? "form" : "forms"}`}
                                    </Chip>
                                  );
                                })}
                              </>
                            );
                          })()}
                          {mayManage && (
                            <button onClick={() => { setEditing(u.emp_id); setDraft(u.roles.map((r) => r.role_id)); }}
                              className="text-[11.5px] text-accent hover:text-accent-dark underline underline-offset-2">
                              change
                            </button>
                          )}
                        </div>
                      )}
                    </Td>
                    {mayManage && (
                      <Td className="text-right">
                        <button onClick={() => revoke(u)} disabled={isMe}
                          title={isMe ? "You cannot remove your own access"
                                      : "Remove access — this person will no longer be able to sign in"}
                          className="text-txt-light hover:text-danger disabled:opacity-25 disabled:cursor-not-allowed">
                          <Trash2 className="w-4 h-4 inline" />
                        </button>
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {picker && (
        <RoleGroupPicker
          group={picker.group}
          value={picker.value}
          subject={picker.label}
          applyLabel={picker.into === "save" ? "Grant access" : "Apply"}
          onApply={applyPicker}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
