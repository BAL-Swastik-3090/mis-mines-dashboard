/**
 * Which pages this person may open — decided once.
 *
 * There were two answers to this before, one in the sidebar and one in the
 * route guard, and they disagreed. Both read `allowed_pages` and both treated
 * an empty list as "show everything", which was written as tolerance for an
 * older session payload that did not carry the field.
 *
 * That is fine while everyone has at least one dashboard, and wrong the moment
 * somebody does not. An operator registrar holds four permissions, none of them
 * `dashboard.*`, so the server correctly sent `allowed_pages: []` — and the
 * sidebar read the empty list as "no restriction" and drew every dashboard tab.
 * The API refused the data behind each one, so the screens loaded and then
 * filled with 403s: the platform looked broken rather than closed.
 *
 * Absent and empty are now different things. A payload without the field is an
 * old session and still sees everything; a payload with an empty list is a
 * person with no dashboards, and sees none.
 *
 * TWO KINDS OF PAGE. The five dashboards are granted through the page matrix
 * and arrive as `allowed_pages`. The platform screens — MineHub, Shift Control,
 * Workforce, Access Control — are deliberately outside that matrix and gated on
 * the permission each one needs, because the screen that grants access must not
 * be something you can revoke from yourself. Both kinds are resolved here, so
 * "can I open this" has one answer.
 */
import type { AppPage } from "./useAppPage";

/**
 * Pages open to anyone signed in.
 *
 * A THIRD kind, alongside the dashboards (granted by `allowed_pages`) and the
 * platform screens (granted by permission). Weather reads no protected API at
 * all — Windy and Open-Meteo are both fetched by the browser directly — so
 * there is nothing behind it to protect. Gating it on a `dashboard.*`
 * permission would mean inventing a permission, seeding it against every role
 * in the database, and still guarding nothing; and whoever was missed would
 * simply lose the forecast for no reason.
 */
const OPEN_PAGES: ReadonlySet<AppPage> = new Set<AppPage>(["weather"]);

/** What each platform screen needs. The dashboards are not here — they come
 *  from the server as allowed_pages.
 *
 *  A page listing more than one permission opens with any of them. MineHub
 *  holds two registers that are different jobs: machines for the equipment
 *  registrar, people for the operator registrar. Requiring the machine
 *  permission to reach the page meant an operator registrar had to be given
 *  the machine register to do their own work, which is how a permission
 *  becomes meaningless. Each tab inside still states what it needs. */
export const PAGE_PERMISSION: Partial<Record<AppPage, string[]>> = {
  "minehub": ["platform.registry.browse"],
  "manpower": ["platform.operators.view"],
  "operations": ["ops.shift.view"],
  "workforce": ["ops.roster.view"],
  "access-control": ["access.users.view"],
  "market": ["market.view"],
  "organisation": ["org.view"],
  "weighbridge": ["wb.view"],
  // The gate is a different job from the weighbridge and a different
  // person: a security officer admits vehicles, a weighbridge operator
  // weighs loads. Gating the gate on wb.view would mean handing the
  // whole weighbridge to the man on the boundary.
  "gate": ["wb.gate"],
  // Capacity reads the same machines and faces the roster does, and is read
  // by the same people planning the day.
  "capacity": ["ops.roster.view"],
};

/**
 * Every page, in the order to offer it.
 *
 * A Record rather than an array, and deliberately: an array lets a page be
 * added to AppPage and to PAGE_PERMISSION without being given a position here,
 * and the result is silent. canOpen() says yes, so the sidebar draws the tab;
 * openablePages() filters this list, so the app concludes the person can open
 * nothing and shows them "No access yet" beside a menu containing the very
 * screen they have permission for.
 *
 * That is exactly what happened to an operator registrar when Manpower was
 * split out. As a Record, TypeScript refuses to compile until a new page has a
 * position, so the omission cannot be made again.
 *
 * Dashboards first because most people have one; the registers next, because
 * the people who have no dashboard are usually there to use one.
 */
const LANDING_RANK: Record<AppPage, number> = {
  "mis": 10,
  "oee": 20,
  "intelligence": 30,
  // Sits with the dashboards, right after Intelligence: what the fleet did,
  // then what the ore it produced is worth.
  "market": 35,
  "fuel-management": 40,
  "ev-tracking": 50,
  // Before the registers: a machine, a person and a material all have to be
  // held against a department, so the department is the thing to see first.
  "organisation": 55,
  "minehub": 60,
  "manpower": 65,
  // With the operational screens, not the registers: the weighbridge is
  // run all shift by the person sitting at it.
  "gate": 66,
  "weighbridge": 68,
  "operations": 70,
  "workforce": 80,
  // Next to the roster: both answer "what can we do tomorrow", one about
  // people and one about machines.
  "capacity": 82,
  // Below the dashboards on purpose: it is open to everyone, so ranking it
  // first would land every user on the weather map instead of their own work.
  "weather": 85,
  "access-control": 90,
};

const LANDING_ORDER = (Object.keys(LANDING_RANK) as AppPage[])
  .sort((a, b) => LANDING_RANK[a] - LANDING_RANK[b]);

export interface AccessLike {
  allowed_pages?: string[];
  permissions?: string[];
}

export function canOpen(user: AccessLike | null | undefined, page: AppPage): boolean {
  if (!user) return false;

  // Signed in is the whole requirement here.
  if (OPEN_PAGES.has(page)) return true;

  const needed = PAGE_PERMISSION[page];
  if (needed) {
    const held = user.permissions ?? [];
    return needed.some((code) => held.includes(code));
  }

  // A dashboard. Absent means an old session and is tolerated; an empty list
  // is an answer, and the answer is no.
  const allowed = user.allowed_pages;
  if (allowed === undefined) return true;
  return allowed.includes(page);
}

/** Everything this person may open, in the order to offer it. */
export function openablePages(user: AccessLike | null | undefined): AppPage[] {
  return LANDING_ORDER.filter((page) => canOpen(user, page));
}

/** Where to send somebody who is on a page that is not theirs.
 *
 *  Null when there is nowhere to send them — which is a real state, not an
 *  error: a person with access to nothing should be told so rather than
 *  bounced around an empty application. */
export function landingPage(user: AccessLike | null | undefined): AppPage | null {
  return openablePages(user)[0] ?? null;
}
