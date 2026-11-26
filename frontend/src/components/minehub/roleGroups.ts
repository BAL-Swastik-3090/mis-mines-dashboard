/**
 * Roles that are one choice to the person granting them.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Migration 138 gave every Daily Entry form a role of its own, because the
 * access chain has no per-person permission grant: a person sees the forms
 * that are theirs only if they hold a role carrying exactly those forms. That
 * is still how it works and nothing here changes it.
 *
 * What it changes is the reading. Nine roles sitting beside Management, Shift
 * Supervisor and Access Manager buried the chips that decide which SECTION a
 * person sees among chips that decide which FORM they file — nine extra chips
 * in the picker, nine extra tiles above it, nine extra cards on the Roles
 * screen. So the nine are declared a group in the database (migration 139,
 * `role_group` + `role.group_code`) and both screens draw a group as one
 * thing with a picker behind it.
 *
 * ── DECLARED IN THE DATABASE, NOT HERE ───────────────────────────────────────
 * There is deliberately no list of entry roles in this file. A tenth form
 * added later joins the picker by setting one column, not by somebody
 * remembering that a .tsx file also needs editing — which is exactly the kind
 * of second place that goes stale and then quietly leaves a form out of the
 * screen that grants it.
 */

/** A role as both access screens receive it. */
export interface ApiRole {
  role_id: number;
  code: string;
  name: string;
  description?: string | null;
  group_code?: string | null;
  group_name?: string | null;
  group_description?: string | null;
  group_sort_order?: number | null;
}

export interface RoleGroup<T extends ApiRole> {
  group_code: string;
  name: string;
  description: string | null;
  sort_order: number;
  /** The roles it stands for. Never empty — a group is built from its members. */
  roles: T[];
}

/**
 * Split a role list into the groups it contains and the roles in no group.
 *
 * Order is preserved within a group, so the roles stay in whatever order the
 * server sent them (by name), and groups sort by the order the database gave
 * them rather than by where their first member happened to land.
 */
export function splitRoleGroups<T extends ApiRole>(
  roles: T[],
): { loose: T[]; groups: RoleGroup<T>[] } {
  const loose: T[] = [];
  const byCode = new Map<string, RoleGroup<T>>();

  for (const r of roles) {
    if (!r.group_code) {
      loose.push(r);
      continue;
    }
    let g = byCode.get(r.group_code);
    if (!g) {
      g = {
        group_code: r.group_code,
        // A group row always carries a name; the fallback is for the window
        // between a role being grouped and the group row existing, which the
        // foreign key makes impossible but a cached response could still show.
        name: r.group_name ?? r.group_code,
        description: r.group_description ?? null,
        sort_order: r.group_sort_order ?? 100,
        roles: [],
      };
      byCode.set(r.group_code, g);
    }
    g.roles.push(r);
  }

  const groups = [...byCode.values()].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
  return { loose, groups };
}

/**
 * The role's name with the group's own word taken off the front.
 *
 * "Entry · Daywise ROM" listed under a heading that already says Daily Data
 * Entry says Entry twice, and the sidebar calls that same screen "Daywise ROM"
 * — so trimming it also makes the picker read like the tabs it grants.
 *
 * Only a leading "<word> · " is removed, and only when the group's name
 * contains that word anywhere ("Daily Data Entry" contains "Entry"). A role
 * named something unrelated keeps its full name rather than being silently
 * trimmed to nothing recognisable.
 */
export function roleNameWithin(groupName: string, roleName: string): string {
  const cut = roleName.indexOf(" · ");
  if (cut <= 0) return roleName;
  const head = roleName.slice(0, cut).trim();
  if (!head) return roleName;
  return groupName.toLowerCase().includes(head.toLowerCase())
    ? roleName.slice(cut + 3)
    : roleName;
}
