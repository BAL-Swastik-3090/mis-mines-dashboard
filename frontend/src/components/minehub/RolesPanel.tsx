"use client";
/** Create roles and decide what each one carries.
 *
 *  Roles are data, so a new one is a row rather than a deployment. The
 *  permission grid is grouped by module because that is how people reason about
 *  access — "can they see the dashboards" and "can they change who gets in" are
 *  different questions.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Loader2, Check, Lock, ShieldAlert, X } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";

interface Permission {
  permission_id: number; code: string; module: string; name: string;
  description: string | null; is_sensitive: boolean;
}
interface Role {
  role_id: number; code: string; name: string; description: string | null;
  is_system: boolean; status: string; user_count: number; permissions: string[];
}

export default function RolesPanel({ onChanged }: { onChanged?: () => void }) {
  const can = useAuth((s) => s.can);
  const myPerms = useAuth((s) => s.user?.permissions ?? []);
  const mayManage = can("access.roles.manage");

  const [roles, setRoles] = useState<Role[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, p] = await Promise.all([api.get("/access/roles"), api.get("/access/permissions")]);
      setRoles(r.data ?? []); setPerms(p.data ?? []);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not load roles.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const byModule = useMemo(() => {
    const m: Record<string, Permission[]> = {};
    perms.forEach((p) => { (m[p.module] ??= []).push(p); });
    return m;
  }, [perms]);

  const savePermissions = async (roleId: number) => {
    setSaving(true); setError(null);
    try {
      await api.put(`/access/roles/${roleId}`, { permissions: draft });
      setNotice("Role updated. It applies immediately.");
      setEditing(null);
      await load(); await useAuth.getState().refresh(); onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not update the role.");
    } finally { setSaving(false); }
  };

  const createRole = async () => {
    if (!newRole.name.trim()) { setError("Give the role a name."); return; }
    setSaving(true); setError(null);
    try {
      await api.post("/access/roles", { ...newRole, permissions: draft });
      setNotice(`Role “${newRole.name}” created.`);
      setCreating(false); setNewRole({ name: "", description: "" }); setDraft([]);
      await load(); onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not create the role.");
    } finally { setSaving(false); }
  };

  const removeRole = async (r: Role) => {
    setError(null);
    try {
      await api.delete(`/access/roles/${r.role_id}`);
      setNotice(`Role “${r.name}” deleted.`);
      await load(); onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not delete the role.");
    }
  };

  const PermissionGrid = () => (
    <div className="space-y-3">
      {Object.entries(byModule).map(([module, list]) => (
        <div key={module}>
          <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/40 mb-1.5 font-condensed">
            {module}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {list.map((p) => {
              const on = draft.includes(p.code);
              // You cannot put a permission into a role that you do not hold —
              // the server refuses it, so the control says why rather than
              // letting someone build a role that will not save.
              const blocked = !myPerms.includes(p.code);
              return (
                <button key={p.permission_id}
                  disabled={blocked}
                  onClick={() => setDraft(on ? draft.filter((c) => c !== p.code) : [...draft, p.code])}
                  title={blocked ? "You cannot grant a permission you do not hold yourself"
                                 : (p.description ?? undefined)}
                  className={`text-left px-3 py-2 rounded-md border transition
                    ${blocked ? "border-white/8 opacity-40 cursor-not-allowed"
                      : on ? "border-[#c8960c]/50 bg-[#c8960c]/10"
                           : "border-white/12 hover:border-white/25"}`}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0
                      ${on ? "bg-[#c8960c] border-[#c8960c]" : "border-white/25"}`}>
                      {on && <Check className="w-2.5 h-2.5 text-[#0b1b33]" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="text-[12.5px] text-white/85 flex items-center gap-1.5">
                        {p.name}
                        {p.is_sensitive && <ShieldAlert className="w-3 h-3 text-amber-400/80" />}
                      </span>
                      {p.description && (
                        <span className="block text-[11px] text-white/35 leading-snug">{p.description}</span>
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

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

      {mayManage && !creating && (
        <button onClick={() => { setCreating(true); setDraft([]); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[#c8960c] text-[#0b1b33] hover:brightness-110">
          <Plus className="w-3.5 h-3.5" /> New role
        </button>
      )}

      {creating && (
        <section className="rounded-lg border border-[#c8960c]/30 bg-[#0e1c33]/80 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-white/90 text-[13px] font-semibold">Create a role</h3>
            <button onClick={() => { setCreating(false); setDraft([]); }} className="text-white/40 hover:text-white/80">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/45 mb-1 font-condensed">
                Name *
              </span>
              <input id="mh-role-name" value={newRole.name}
                onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                placeholder="e.g. Shift In-charge, Mine Planner"
                className="w-full bg-[#0a1526] border border-white/12 rounded-md px-3 py-2 text-[13px] text-white/90 placeholder:text-white/25 focus:outline-none focus:border-[#c8960c]/50" />
            </label>
            <label className="block">
              <span className="block text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/45 mb-1 font-condensed">
                What it is for
              </span>
              <input id="mh-role-desc" value={newRole.description}
                onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                placeholder="Short description"
                className="w-full bg-[#0a1526] border border-white/12 rounded-md px-3 py-2 text-[13px] text-white/90 placeholder:text-white/25 focus:outline-none focus:border-[#c8960c]/50" />
            </label>
          </div>
          <PermissionGrid />
          <div className="flex gap-2">
            <button onClick={createRole} disabled={saving}
              className="px-4 py-2 rounded-md text-[12.5px] font-semibold bg-[#c8960c] text-[#0b1b33] disabled:opacity-40">
              {saving ? "Creating…" : "Create role"}
            </button>
            <button onClick={() => { setCreating(false); setDraft([]); }}
              className="px-4 py-2 rounded-md text-[12.5px] text-white/60 border border-white/12">Cancel</button>
          </div>
        </section>
      )}

      <div className="space-y-3">
        {roles.map((r) => {
          const isEditing = editing === r.role_id;
          const isOwner = r.code === "PLATFORM_OWNER";
          return (
            <section key={r.role_id} className="rounded-lg border border-white/10 bg-[#0e1c33]/60">
              <header className="px-4 py-3 flex flex-wrap items-start justify-between gap-3 border-b border-white/10">
                <div className="min-w-0">
                  <h3 className="text-white/90 text-[13.5px] font-semibold flex items-center gap-2">
                    {r.name}
                    {r.is_system && (
                      <span title="A system role — it cannot be renamed or deleted"
                            className="inline-flex items-center gap-1 text-[10.5px] text-white/40 border border-white/15 rounded px-1.5 py-0.5">
                        <Lock className="w-2.5 h-2.5" /> system
                      </span>
                    )}
                  </h3>
                  {r.description && <p className="text-white/45 text-[11.5px] mt-0.5">{r.description}</p>}
                  <p className="text-white/35 text-[11px] mt-1">
                    {r.user_count} {r.user_count === 1 ? "person holds" : "people hold"} this ·{" "}
                    {isOwner ? "every permission" : `${r.permissions.length} permissions`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {mayManage && !isOwner && (
                    <button
                      onClick={() => { setEditing(isEditing ? null : r.role_id); setDraft(r.permissions); }}
                      className="px-3 py-1.5 rounded-md text-[11.5px] font-medium border border-white/15 text-white/70 hover:text-white hover:border-white/30">
                      {isEditing ? "Close" : "Edit permissions"}
                    </button>
                  )}
                  {mayManage && !r.is_system && (
                    <button onClick={() => removeRole(r)}
                      title={r.user_count ? "Move its holders to another role first" : "Delete this role"}
                      className="text-white/35 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </header>

              <div className="p-4">
                {isOwner ? (
                  <p className="text-white/45 text-[12px]">
                    The Platform Owner holds every permission, including ones added later.
                    That is what makes it the role that can always restore access.
                  </p>
                ) : isEditing ? (
                  <div className="space-y-3">
                    <PermissionGrid />
                    <div className="flex gap-2">
                      <button onClick={() => savePermissions(r.role_id)} disabled={saving}
                        className="px-4 py-2 rounded-md text-[12.5px] font-semibold bg-[#c8960c] text-[#0b1b33] disabled:opacity-40">
                        {saving ? "Saving…" : "Save permissions"}
                      </button>
                      <button onClick={() => setEditing(null)}
                        className="px-4 py-2 rounded-md text-[12.5px] text-white/60 border border-white/12">Cancel</button>
                    </div>
                  </div>
                ) : r.permissions.length === 0 ? (
                  <p className="text-amber-300/70 text-[12px]">
                    This role carries nothing — anyone holding only this role can sign in but see no page.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {r.permissions.map((code) => {
                      const p = perms.find((x) => x.code === code);
                      return (
                        <span key={code} title={p?.description ?? code}
                          className="px-2 py-0.5 rounded border border-white/12 bg-white/[0.03] text-[11px] text-white/65">
                          {p?.name ?? code}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
