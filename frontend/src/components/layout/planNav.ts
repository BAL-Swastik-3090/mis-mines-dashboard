import { CalendarRange, Factory, Mountain, Pickaxe } from "lucide-react";
import type { AppPage } from "@/contexts/useAppPage";

/**
 * The three plans, in the order somebody opens them.
 *
 * ── WHY THIS IS ITS OWN FILE ─────────────────────────────────────────────────
 * Two places draw this list: the rail on the left and the strip across the top
 * of every plan screen. One copy, as hotoNav does it — a screen added to one
 * and forgotten in the other is a screen that silently disappears for
 * everybody, which has happened here once already.
 *
 * ── THE ORDER IS BY WHO FILES THEM ───────────────────────────────────────────
 * Despatch and COB first, because PPIC files both and files them together;
 * the excavation plan last, because Geology files that one and nobody files
 * all three. That is not a guess: every despatch and COB row carries entry_id
 * 2627 and every excavation row 2971.
 */
export interface PlanTab {
  id: AppPage;
  /** Short, because the heading beside it already says Plans. */
  label: string;
  icon: React.ElementType;
}

export const PLAN_TABS: PlanTab[] = [
  { id: "plan-despatch",   label: "Despatch",   icon: CalendarRange },
  { id: "plan-cobp",       label: "COB Plant",  icon: Factory       },
  { id: "plan-excavation", label: "Excavation", icon: Mountain      },
  // Last, because it is maintained rarely and read often: the list the
  // excavation plan picks from, not a plan of its own.
  { id: "plan-faces",      label: "Faces",      icon: Pickaxe       },
];

export const PLAN_PAGES: AppPage[] = PLAN_TABS.map((t) => t.id);

/** Is this screen one of the plans? */
export const isPlanPage = (p: string): boolean =>
  (PLAN_PAGES as string[]).includes(p);
