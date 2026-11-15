/**
 * The handover screens, in the order somebody actually opens them.
 *
 * ── WHY THIS IS ITS OWN FILE ─────────────────────────────────────────────────
 * Two places draw this list: the rail on the left and the strip across the top
 * of every handover screen. If each kept its own copy, adding a screen would
 * mean remembering both, and the one that was forgotten would be the one that
 * silently hid a page from everybody — which is exactly how the whole section
 * vanished from the rail once already.
 *
 * ── THE ORDER IS A CLAIM ABOUT USE, NOT A TIDY LIST ──────────────────────────
 * The running shift first, because it is what the morning opens on; then the
 * record of what happened; then the workshop's queue. Checklists change weeks
 * apart rather than daily. Devices and Cab Stickers are setup — a tablet is
 * approved once and a sticker printed once per machine — so they sit at the
 * end rather than in the path of daily work.
 */

import { BookOpen, CalendarRange, CircleAlert, Cpu, Printer, Smartphone, SquareCheck }
  from "lucide-react";
import type { AppPage } from "@/contexts/useAppPage";

export interface HotoTab {
  id: AppPage;
  /** Short, because the heading beside it already says HOTO. */
  label: string;
  icon: React.ElementType;
}

export const HOTO_TABS: HotoTab[] = [
  { id: "hoto-board",      label: "Shift Board",  icon: CalendarRange },
  { id: "hoto-register",   label: "Register",     icon: BookOpen      },
  { id: "hoto-defects",    label: "Defects",      icon: CircleAlert   },
  { id: "hoto-checklists", label: "Checklists",   icon: SquareCheck   },
  { id: "hoto-devices",    label: "Devices",      icon: Cpu           },
  { id: "hoto-stickers",   label: "Cab Stickers", icon: Printer       },
  { id: "hoto-app",        label: "App",          icon: Smartphone    },
];

export const HOTO_PAGES: AppPage[] = HOTO_TABS.map((t) => t.id);

/** Is this screen part of the handover section? */
export const isHotoPage = (p: string): boolean =>
  (HOTO_PAGES as string[]).includes(p);
