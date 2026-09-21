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
  "minehub": 60,
  "manpower": 65,
  "operations": 70,
  "workforce": 80,
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
