"use client";
/** Who can sign in, and what each person may do. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Trash2, Loader2, Users, X, Check } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";

interface Role { role_id: number; code: string; name: string; permissions: string[] }
interface AccessUser {
  emp_id: string; name?: string; department?: string; designation?: string;
  roles: { role_id: number; code: string; name: string }[];
  granted_by: string | null;
}
interface EmployeeHit {
  emp_id: string; name: string | null; department: string | null; designation: string | null;
}

export default function UsersPanel({ onChanged }: { onChanged?: () => void }) {
  const me = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);

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
  const [draftRoles, setDraftRoles] = useState<number[]>([]);
  const [roleFilter, setRoleFilter] = useState<string>("");

  const mayManage = can("access.users.manage");

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

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    users.forEach((u) => u.roles.forEach((r) => { c[r.code] = (c[r.code] ?? 0) + 1; }));
    return c;
  }, [users]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter && !u.roles.some((r) => r.code === roleFilter)) return false;
      if (!q) return true;
      return [u.name, u.emp_id, u.department, u.designation]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [users, query, roleFilter]);

  const saveRoles = async (emp_id: string, role_ids: number[]) => {
    setError(null);
    try {
      await api.put(`/access/users/${emp_id}/roles`, { role_ids });
      setNotice(`Access updated for ${emp_id}.`);
      setEditing(null); setAddQuery(""); setHits([]);
      await load();
      if (emp_id === me?.emp_id) await useAuth.getState().refresh();
      onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not update access.");
    }
  };

  const revoke = async (emp_id: string) => {
    setError(null);
    try {
      await api.delete(`/access/users/${emp_id}`);
      setNotice(`${emp_id} can no longer sign in.`);
      await load(); onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not remove access.");
    }
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-[#c8960c]" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[12.5px] text-red-300">{error}</div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[12.5px] text-emerald-300">
          <Check className="w-4 h-4" />{notice}
        </div>
      )}

      {/* Role distribution, doubling as a filter */}
      <div className="flex flex-wrap gap-2">
        {roles.map((r) => {
          const active = roleFilter === r.code;
          return (
            <button key={r.role_id}
              onClick={() => setRoleFilter(active ? "" : r.code)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-[11.5px] font-medium transition
                          ${active ? "border-[#c8960c]/60 bg-[#c8960c]/15 text-[#c8960c]"
                                   : "border-white/12 text-white/60 hover:text-white/90"}`}>
              <Users className="w-3 h-3" />{r.name}
              <span className="tabular-nums opacity-70">{counts[r.code] ?? 0}</span>
            </button>
          );
        })}
        {roleFilter && (
          <button onClick={() => setRoleFilter("")} className="self-center text-[11.5px] text-white/40 hover:text-white/70">
            clear
          </button>
        )}
      </div>

      {/* Add someone */}
      {mayManage && (
        <div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
            <input
              id="mh-add-user"
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              placeholder="Give someone access — search by name or employee ID…"
              className="w-full bg-[#0a1526] border border-white/12 rounded-md pl-9 pr-3 py-2 text-[13px] text-white/90 placeholder:text-white/30 focus:outline-none focus:border-[#c8960c]/50"
            />
            {searching && <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-white/35" />}
          </div>
          {hits.length > 0 && (
            <ul className="mt-2 rounded-md border border-white/10 divide-y divide-white/5 overflow-hidden">
              {hits.map((h) => (
                <li key={h.emp_id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 bg-[#0a1526]">
                  <div className="min-w-0 flex-1">
                    <div className="text-white/90 text-[13px] truncate">
                      {h.name ?? h.emp_id} <span className="text-white/35">· {h.emp_id}</span>
                    </div>
                    <div className="text-white/40 text-[11.5px] truncate">
                      {[h.designation, h.department].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {roles.map((r) => (
                      <button key={r.role_id}
                        onClick={() => saveRoles(h.emp_id, [r.role_id])}
                        title={`Give ${h.name ?? h.emp_id} the ${r.name} role`}
                        className="px-2.5 py-1 rounded border border-white/15 text-white/70 text-[11px] font-medium hover:border-[#c8960c]/50 hover:text-[#c8960c]">
                        {r.name}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* The list */}
      <div className="rounded-md border border-white/10 overflow-hidden">
        <div className="px-3 py-2 border-b border-white/10 bg-white/[0.03] flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 font-condensed">
            {visible.length} of {users.length} with access
          </span>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
            <input
              id="mh-filter-user"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
              className="bg-[#0a1526] border border-white/12 rounded-md pl-8 pr-3 py-1 text-[12px] text-white/90 placeholder:text-white/30 focus:outline-none focus:border-[#c8960c]/50 w-[150px]"
            />
          </div>
        </div>

        <table className="w-full text-[12.5px]">
          <thead className="text-white/45">
            <tr>
              <th className="text-left font-medium px-3 py-2">Person</th>
              <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Department</th>
              <th className="text-left font-medium px-3 py-2">Roles</th>
              {mayManage && <th className="text-right font-medium px-3 py-2">Revoke</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {visible.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-white/35">
                {users.length === 0 ? "Nobody has access yet." : "Nobody matches that filter."}
              </td></tr>
            )}
            {visible.map((u) => {
              const isMe = u.emp_id === me?.emp_id;
              const isEditing = editing === u.emp_id;
              return (
                <tr key={u.emp_id} className="text-white/80 align-top">
                  <td className="px-3 py-2.5">
                    {u.name ?? u.emp_id}
                    <span className="text-white/35"> · {u.emp_id}</span>
                    {isMe && <span className="ml-2 text-[10.5px] text-[#c8960c]">(you)</span>}
                    {u.designation && (
                      <div className="text-white/35 text-[11px]">{u.designation}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-white/50 hidden md:table-cell">{u.department ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    {isEditing ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          {roles.map((r) => {
                            const on = draftRoles.includes(r.role_id);
                            return (
                              <button key={r.role_id}
                                onClick={() => setDraftRoles(on
                                  ? draftRoles.filter((x) => x !== r.role_id)
                                  : [...draftRoles, r.role_id])}
                                className={`px-2.5 py-1 rounded border text-[11px] font-medium transition
                                  ${on ? "border-[#c8960c]/60 bg-[#c8960c]/15 text-[#c8960c]"
                                       : "border-white/15 text-white/50 hover:text-white/80"}`}>
                                {on ? "✓ " : ""}{r.name}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => saveRoles(u.emp_id, draftRoles)}
                            className="px-3 py-1 rounded text-[11.5px] font-semibold bg-[#c8960c] text-[#0b1b33]">
                            Save
                          </button>
                          <button onClick={() => setEditing(null)}
                            className="px-3 py-1 rounded text-[11.5px] text-white/60 border border-white/12">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {u.roles.map((r) => (
                          <span key={r.role_id}
                            className="px-2 py-0.5 rounded border border-white/15 bg-white/[0.04] text-[11px] text-white/75">
                            {r.name}
                          </span>
                        ))}
                        {mayManage && (
                          <button
                            onClick={() => { setEditing(u.emp_id); setDraftRoles(u.roles.map((r) => r.role_id)); }}
                            className="text-[11px] text-white/35 hover:text-[#c8960c] underline underline-offset-2">
                            change
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  {mayManage && (
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => revoke(u.emp_id)} disabled={isMe}
                        title={isMe ? "You cannot remove your own access"
                                    : "Remove access — this person will no longer be able to sign in"}
                        className="text-white/40 hover:text-red-400 disabled:opacity-25 disabled:cursor-not-allowed">
                        <Trash2 className="w-4 h-4 inline" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
