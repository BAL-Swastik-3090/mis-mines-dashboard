"use client";
/**
 * Access Control — super-admin only.
 *
 * Two things are managed here:
 *   1. Who has which role (viewer / manager / admin).
 *   2. Which pages each role may open (the role x page matrix).
 *
 * Both are enforced server-side on the API prefixes behind each page, so what
 * this screen changes is real access, not just which sidebar entries appear.
 *
 * The screen is reachable only with the admin role: the sidebar hides the entry,
 * and every endpoint it calls sits behind the "/api/roles" admin rule in
 * main.py, so hitting them directly without admin returns 403.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Shield, Trash2, Check, Loader2, AlertCircle, ChevronDown, Users } from "lucide-react";
import api from "@/lib/api";
import { useAuth, type MinesRole } from "@/contexts/useAuth";

interface RoleRow {
  emp_id: string;
  role: MinesRole;
  name: string | null;
  department: string | null;
  designation: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

interface EmployeeHit {
  emp_id: string;
  name: string | null;
  department: string | null;
  designation: string | null;
}

interface PageDef { id: string; label: string }
type Matrix = Record<string, Record<string, boolean>>;

const ROLE_STYLE: Record<MinesRole, string> = {
  superadmin: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  admin: "bg-[#c8960c]/15 text-[#c8960c] border-[#c8960c]/30",
  manager: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  viewer: "bg-white/10 text-white/60 border-white/15",
};

const RANK: Record<MinesRole, number> = { viewer: 1, manager: 2, admin: 3, superadmin: 4 };

const ROLE_HELP: Record<MinesRole, string> = {
  superadmin: "Platform owner — everything admin can do, plus the MineHub platform modules.",
  admin: "Manages roles and page access. Sees this screen.",
  manager: "Elevated user. Page access is set by the matrix below.",
  viewer: "Default for anyone with valid intranet credentials.",
};

export default function AccessControlSection() {
  const me = useAuth((s) => s.user);

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [pages, setPages] = useState<PageDef[]>([]);
  const [roleNames, setRoleNames] = useState<MinesRole[]>([]);
  const [matrix, setMatrix] = useState<Matrix>({});
  const [savedMatrix, setSavedMatrix] = useState<Matrix>({});

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<EmployeeHit[]>([]);
  const [searching, setSearching] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<MinesRole | "">("");
  const [changing, setChanging] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, p] = await Promise.all([api.get("/roles"), api.get("/roles/pages")]);
      setRoles(r.data ?? []);
      setPages(p.data?.pages ?? []);
      setRoleNames(p.data?.roles ?? []);
      setMatrix(p.data?.matrix ?? {});
      setSavedMatrix(p.data?.matrix ?? {});
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Could not load access settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Employee search, debounced — this table is large and the DB is shared.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setHits([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get("/roles/employees", { params: { q: term } });
        setHits(res.data ?? []);
      } catch { setHits([]); }
      finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const dirty = useMemo(
    () => JSON.stringify(matrix) !== JSON.stringify(savedMatrix),
    [matrix, savedMatrix],
  );

  /** Roles this user is allowed to hand out. You can never grant above your own
   *  level — the server enforces the same rule, this just avoids offering it. */
  const grantable = useMemo<MinesRole[]>(() => {
    const all: MinesRole[] = ["viewer", "manager", "admin", "superadmin"];
    const mine = me?.mines_role;
    if (!mine) return [];
    return all.filter((r) => RANK[r] <= RANK[mine]);
  }, [me]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    roles.forEach((r) => { c[r.role] = (c[r.role] ?? 0) + 1; });
    return c;
  }, [roles]);

  const visibleRoles = useMemo(
    () => (roleFilter ? roles.filter((r) => r.role === roleFilter) : roles),
    [roles, roleFilter],
  );

  const assign = async (emp_id: string, role: MinesRole) => {
    setError(null);
    try {
      await api.put("/roles", { emp_id, role });
      setNotice(`${emp_id} is now ${role}.`);
      setQuery("");
      setHits([]);
      await load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Could not assign that role.");
    }
  };

  const revoke = async (emp_id: string) => {
    setError(null);
    try {
      await api.delete(`/roles/${emp_id}`);
      setNotice(`${emp_id} can no longer sign in.`);
      await load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Could not remove that role.");
    }
  };

  const toggle = (role: string, page: string) =>
    setMatrix((m) => ({ ...m, [role]: { ...m[role], [page]: !m[role]?.[page] } }));

  const saveMatrix = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put("/roles/pages", { matrix });
      setSavedMatrix(matrix);
      setNotice("Page access saved. It applies immediately.");
      // Our own allowed_pages may have changed — refresh so the sidebar matches.
      await useAuth.getState().refresh();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Could not save page access.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-[#c8960c]" />
      </div>
    );
  }

  return (
    <div className="px-4 md:px-6 py-5 space-y-5 max-w-[1200px]">
      {/* Banner — matches the Intelligence page treatment */}
      <div className="rounded-lg bg-gradient-to-r from-[#0b1b33] to-[#13294d] border border-[#c8960c]/25 px-5 py-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-[#c8960c] shrink-0" />
          <div>
            <h1 className="text-white font-semibold text-[15px] tracking-wide">Access Control</h1>
            <p className="text-white/55 text-[12px] mt-0.5">
              Assign roles and decide which pages each role can open. Changes apply
              immediately and are enforced on the data, not just the menu.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[12.5px] text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[12.5px] text-emerald-300">
          <Check className="w-4 h-4 shrink-0 mt-px" />
          <span>{notice}</span>
        </div>
      )}

      {/* ── People ─────────────────────────────────────────────── */}
      <section className="rounded-lg border border-white/10 bg-[#0e1c33]/60">
        <header className="px-4 py-3 border-b border-white/10">
          <h2 className="text-white/90 text-[13px] font-semibold tracking-wide">People</h2>
          <p className="text-white/45 text-[11.5px] mt-0.5">
            The dashboard is invite-only: only people listed here can sign in at
            all. Change a role from the dropdown on the row.
          </p>
        </header>

        <div className="p-4 space-y-4">
          {/* Who holds what, and a one-click filter. Clicking the active chip
              clears it, so the control explains itself without a reset button. */}
          <div className="flex flex-wrap gap-2">
            {(["superadmin", "admin", "manager", "viewer"] as MinesRole[]).map((r) => {
              const n = counts[r] ?? 0;
              const active = roleFilter === r;
              return (
                <button
                  key={r}
                  onClick={() => setRoleFilter(active ? "" : r)}
                  title={ROLE_HELP[r]}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-[11.5px] font-medium capitalize transition
                              ${active ? "ring-1 ring-[#c8960c]/60 " : "opacity-80 hover:opacity-100 "}${ROLE_STYLE[r]}`}
                >
                  <Users className="w-3 h-3" />
                  {r}
                  <span className="tabular-nums opacity-70">{n}</span>
                </button>
              );
            })}
            {roleFilter && (
              <span className="self-center text-[11.5px] text-white/40">
                showing {visibleRoles.length} of {roles.length}
              </span>
            )}
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search employee by name or ID (min. 2 characters)…"
              className="w-full bg-[#0a1526] border border-white/12 rounded-md pl-9 pr-3 py-2 text-[13px] text-white/90 placeholder:text-white/30 focus:outline-none focus:border-[#c8960c]/50"
            />
            {searching && (
              <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-white/35" />
            )}
          </div>

          {hits.length > 0 && (
            <ul className="rounded-md border border-white/10 divide-y divide-white/5 overflow-hidden">
              {hits.map((h) => (
                <li key={h.emp_id} className="flex items-center gap-3 px-3 py-2.5 bg-[#0a1526]">
                  <div className="min-w-0 flex-1">
                    <div className="text-white/90 text-[13px] truncate">
                      {h.name ?? h.emp_id}{" "}
                      <span className="text-white/35">· {h.emp_id}</span>
                    </div>
                    <div className="text-white/40 text-[11.5px] truncate">
                      {[h.designation, h.department].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {((me?.mines_role === "superadmin"
                       ? ["viewer", "manager", "admin", "superadmin"]
                       : ["viewer", "manager", "admin"]) as MinesRole[]).map((r) => (
                      <button
                        key={r}
                        onClick={() => assign(h.emp_id, r)}
                        title={ROLE_HELP[r]}
                        className={`px-2.5 py-1 rounded border text-[11px] font-medium capitalize transition-colors hover:brightness-125 ${ROLE_STYLE[r]}`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-md border border-white/10 overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead className="bg-white/[0.03] text-white/45">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Employee</th>
                  <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Department</th>
                  <th className="text-left font-medium px-3 py-2">Role</th>
                  <th className="text-right font-medium px-3 py-2">Revoke</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {visibleRoles.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-white/35">
                      {roles.length === 0
                        ? "Nobody has been given access yet."
                        : `No one currently holds the ${roleFilter} role.`}
                    </td>
                  </tr>
                )}
                {visibleRoles.map((r) => {
                  const isMe = r.emp_id === me?.emp_id;
                  return (
                    <tr key={r.emp_id} className="text-white/80">
                      <td className="px-3 py-2.5">
                        {r.name ?? r.emp_id}
                        <span className="text-white/35"> · {r.emp_id}</span>
                        {isMe && <span className="ml-2 text-[10.5px] text-[#c8960c]">(you)</span>}
                      </td>
                      <td className="px-3 py-2.5 text-white/50 hidden sm:table-cell">
                        {r.department ?? "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        {/* Change a role in place. Searching for someone you can
                            already see, just to change their role, was busywork. */}
                        <div className="relative inline-block">
                          <select
                            id={`role-${r.emp_id}`}
                            value={r.role}
                            disabled={changing === r.emp_id || grantable.length === 0}
                            onChange={async (e) => {
                              const next = e.target.value as MinesRole;
                              if (next === r.role) return;
                              setChanging(r.emp_id);
                              await assign(r.emp_id, next);
                              setChanging(null);
                            }}
                            title={ROLE_HELP[r.role]}
                            className={`appearance-none cursor-pointer pl-2 pr-6 py-0.5 rounded border text-[11px] font-medium capitalize
                                        focus:outline-none focus:ring-1 focus:ring-[#c8960c]/60 disabled:opacity-50
                                        ${ROLE_STYLE[r.role]}`}
                          >
                            {grantable.map((g) => (
                              <option key={g} value={g} className="bg-[#0a1526] text-white">{g}</option>
                            ))}
                            {/* Their current role may be above what we can grant —
                                show it so the control never misrepresents reality. */}
                            {!grantable.includes(r.role) && (
                              <option value={r.role} className="bg-[#0a1526] text-white">{r.role}</option>
                            )}
                          </select>
                          <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => revoke(r.emp_id)}
                          disabled={isMe}
                          title={isMe
                            ? "You cannot remove your own access"
                            : "Remove access — this person will no longer be able to sign in"}
                          className="text-white/40 hover:text-red-400 disabled:opacity-25 disabled:hover:text-white/40 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-4 h-4 inline" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Page access matrix ─────────────────────────────────── */}
      <section className="rounded-lg border border-white/10 bg-[#0e1c33]/60">
        <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-white/90 text-[13px] font-semibold tracking-wide">Page access</h2>
            <p className="text-white/45 text-[11.5px] mt-0.5">
              Which pages each role can open. Unticking a box also blocks that
              page&apos;s data, not just its sidebar entry.
            </p>
          </div>
          <button
            onClick={saveMatrix}
            disabled={!dirty || saving}
            className="shrink-0 px-3.5 py-1.5 rounded-md text-[12px] font-semibold bg-[#c8960c] text-[#0b1b33] hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </header>

        <div className="p-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12.5px]">
            <thead className="text-white/45">
              <tr>
                <th className="text-left font-medium px-3 py-2">Page</th>
                {roleNames.map((r) => (
                  <th key={r} className="font-medium px-3 py-2 capitalize text-center" title={ROLE_HELP[r]}>
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {pages.map((p) => (
                <tr key={p.id} className="text-white/80">
                  <td className="px-3 py-2.5">{p.label}</td>
                  {roleNames.map((r) => (
                    <td key={r} className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={matrix[r]?.[p.id] ?? true}
                        onChange={() => toggle(r, p.id)}
                        className="w-4 h-4 accent-[#c8960c] cursor-pointer"
                        aria-label={`${r} can open ${p.label}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-white/35 text-[11.5px] mt-3">
            Access Control itself is not listed — it is always admin-only, so this
            screen cannot be locked away from the people who administer it.
          </p>
        </div>
      </section>
    </div>
  );
}
