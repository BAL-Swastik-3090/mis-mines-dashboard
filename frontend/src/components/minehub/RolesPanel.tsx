"use client";
/** Create roles and decide what each one carries. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Loader2, Check, Lock, ShieldAlert, X } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import { Alert, Chip, Button, Card, CardHeader, Field, inputClass } from "./ui";

interface Permission {
  permission_id: number; code: string; module: string; name: string;
  description: string | null; is_sensitive: boolean;
}
interface Role {
  role_id: number; code: string; name: string; description: string | null;
  is_system: boolean; status: string; user_count: number; permissions: string[];
}

export default function RolesPanel() {
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
      // One call, not two: each request pays the whole middleware round trip
      // again, which is the dominant cost when the database is far away.
      const r = await api.get("/access/catalogue");
      setRoles(r.data?.roles ?? []); setPerms(r.data?.permissions ?? []);
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
      setNotice("Role updated — it applies immediately.");
      setEditing(null);
      await load(); await useAuth.getState().refresh();
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
      await load();
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
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(d ?? "Could not delete the role.");
    }
  };

  const PermissionGrid = () => (
    <div className="space-y-4">
      {Object.entries(byModule).map(([module, list]) => (
        <div key={module}>
          <div className="font-condensed text-[10px] font-bold uppercase tracking-[.14em] text-txt-light mb-2">
            {module}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {list.map((p) => {
              const on = draft.includes(p.code);
              // The server refuses a permission you do not hold, so the control
              // says why rather than letting someone build a role that cannot save.
              const blocked = !myPerms.includes(p.code);
              return (
                <button key={p.permission_id} disabled={blocked}
                  onClick={() => setDraft(on ? draft.filter((c) => c !== p.code) : [...draft, p.code])}
                  title={blocked ? "You cannot grant a permission you do not hold yourself"
                                 : (p.description ?? undefined)}
                  className={`text-left px-3 py-2.5 rounded border transition
                    ${blocked ? "border-border-light bg-bg-section/50 opacity-60 cursor-not-allowed"
                      : on ? "border-gold bg-gold/[0.07]"
                           : "border-border bg-bg-base hover:border-border-strong"}`}>
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-0.5 w-4 h-4 rounded-sm border flex items-center justify-center shrink-0
                      ${on ? "bg-gold border-gold" : "border-border-strong bg-bg-base"}`}>
                      {on && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="text-[12.5px] font-medium text-txt-primary flex items-center gap-1.5">
                        {p.name}
                        {p.is_sensitive && (
                          <ShieldAlert className="w-3.5 h-3.5 text-warning" aria-label="Sensitive" />
                        )}
                      </span>
                      {p.description && (
                        <span className="block text-[11px] text-txt-muted leading-snug mt-0.5">
                          {p.description}
                        </span>
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
    return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gold" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && (
        <Alert tone="success"><span className="inline-flex items-center gap-2"><Check className="w-4 h-4" />{notice}</span></Alert>
      )}

      {mayManage && !creating && (
        <Button variant="primary" onClick={() => { setCreating(true); setDraft([]); }}>
          <Plus className="w-4 h-4" /> New role
        </Button>
      )}

      {creating && (
        <Card className="border-gold/40">
          <CardHeader title="Create a role"
            subtitle="Name it for what it lets someone do, not for seniority — job titles already carry that."
            actions={<Button variant="ghost" size="sm" onClick={() => { setCreating(false); setDraft([]); }}>
              <X className="w-4 h-4" />
            </Button>} />
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name *">
                <input id="mh-role-name" value={newRole.name} className={inputClass}
                  placeholder="e.g. Shift In-charge, Mine Planner"
                  onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} />
              </Field>
              <Field label="What it is for">
                <input id="mh-role-desc" value={newRole.description} className={inputClass}
                  placeholder="Short description"
                  onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} />
              </Field>
            </div>
            <PermissionGrid />
            <div className="flex gap-2">
              <Button variant="primary" onClick={createRole} disabled={saving}>
                {saving ? "Creating…" : "Create role"}
              </Button>
              <Button variant="ghost" onClick={() => { setCreating(false); setDraft([]); }}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}

      {roles.map((r) => {
        const isEditing = editing === r.role_id;
        const isOwner = r.code === "PLATFORM_OWNER";
        return (
          <Card key={r.role_id}>
            <CardHeader
              title={r.name}
              subtitle={r.description ?? undefined}
              actions={
                <>
                  {r.is_system && (
                    <Chip tone="slate" title="A system role — it cannot be renamed or deleted">
                      <Lock className="w-3 h-3" /> system
                    </Chip>
                  )}
                  <Chip tone="sky">
                    {r.user_count} {r.user_count === 1 ? "person" : "people"}
                  </Chip>
                  {mayManage && !isOwner && (
                    <Button size="sm" variant="secondary"
                      onClick={() => { setEditing(isEditing ? null : r.role_id); setDraft(r.permissions); }}>
                      {isEditing ? "Close" : "Edit permissions"}
                    </Button>
                  )}
                  {mayManage && !r.is_system && (
                    <Button size="sm" variant="danger" onClick={() => removeRole(r)}
                      title={r.user_count ? "Move its holders to another role first" : "Delete this role"}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </>
              }
            />
            <div className="p-4">
              {isOwner ? (
                <p className="text-[12.5px] text-txt-muted">
                  The Platform Owner holds every permission, including ones added later.
                  That is what makes it the role that can always restore access.
                </p>
              ) : isEditing ? (
                <div className="space-y-4">
                  <PermissionGrid />
                  <div className="flex gap-2">
                    <Button variant="primary" onClick={() => savePermissions(r.role_id)} disabled={saving}>
                      {saving ? "Saving…" : "Save permissions"}
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              ) : r.permissions.length === 0 ? (
                <p className="text-[12.5px] text-warning">
                  This role carries nothing — anyone holding only this role can sign in but see no page.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {r.permissions.map((code) => {
                    const p = perms.find((x) => x.code === code);
                    return (
                      <Chip key={code} tone={p?.is_sensitive ? "amber" : "slate"}
                             title={p?.description ?? code}>
                        {p?.name ?? code}
                      </Chip>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
