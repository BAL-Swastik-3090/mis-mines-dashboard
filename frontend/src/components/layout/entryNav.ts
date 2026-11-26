import {
  Boxes, Droplet, Droplets, Hammer, Layers, Mountain,
  PencilLine, Pickaxe, Shuffle,
} from "lucide-react";
import type { AppPage } from "@/contexts/useAppPage";

/**
 * The forms the mine fills in, in the order the header menu listed them.
 *
 * ── WHY THIS IS ITS OWN FILE ─────────────────────────────────────────────────
 * Three places draw this list: the rail on the left, the strip across the top
 * of every entry screen, and the shortcut menu in the header. One copy, as
 * planNav and hotoNav already do it — a form added to one and forgotten in
 * another is a form that silently disappears for everybody.
 *
 * ── WHY ONE PAGE PER FORM, RATHER THAN ONE HUB WITH TABS INSIDE IT ───────────
 * Because the access matrix is keyed on AppPage. A single hub page with its own
 * tab state would need a second, parallel way to decide which tabs a person may
 * see — and the two would disagree, which is exactly the bug pageAccess was
 * written to end. As pages, canOpen answers it once for the rail, the strip and
 * the route guard; LANDING_RANK is a Record, so TypeScript refuses to compile a
 * form that was added without being given a position; and somebody holding one
 * permission lands on their own form rather than on somebody else's 403.
 *
 * ── WHERE THEY USED TO LIVE ──────────────────────────────────────────────────
 * Each dialog was mounted inside whichever dashboard section held the figures
 * it needed — stock in StockSection, de-silting in ProductionSection, the OEE
 * master in OEESection — so opening one ALSO threw you onto that dashboard:
 *
 *     setPage(which === "equipment-plan" ? "oee" : "mis");
 *
 * That line is what this hub removes. A form is now somewhere you can go.
 */
export interface EntryTab {
  id: AppPage;
  /** Short: the heading beside it already says Daily Entry. */
  label: string;
  icon: React.ElementType;
  /** The heading on the form's own screen, and the menu entry's wording. */
  title: string;
  /** What this records — one line, printed on the screen behind the form, so
   *  somebody who opened the wrong tab can tell before they start typing. */
  blurb: string;
}

export const ENTRY_TABS: EntryTab[] = [
  {
    id: "entry-prev-day", label: "Est Actual", icon: PencilLine,
    title: "Enter Est Actual",
    blurb: "The mine's own estimate for a day, typed against what production "
         + "and despatch recorded for it.",
  },
  {
    id: "entry-stock", label: "Mines Stock", icon: Boxes,
    title: "Enter Mines Stock",
    blurb: "What is standing at the mine on the morning of a day, bucket by "
         + "bucket.",
  },
  {
    // "Declare" rather than "Enter": this is not a day's figure being
    // recorded, it is a survey's statement, filed a few times a year, that
    // every remaining-reserve and valuation figure is derived from.
    id: "entry-reserve", label: "Resource Reserve", icon: Mountain,
    title: "Declare Resource Reserve",
    blurb: "The reserve still in the ground, as the latest survey states it.",
  },
  {
    id: "entry-rom", label: "Daywise ROM", icon: Hammer,
    title: "Entry Daywise ROM",
    blurb: "What came out of the ground that day, shift by shift, with the "
         + "assay of each parcel. Filed in two halves — production, then "
         + "Geology's block model.",
  },
  {
    id: "entry-rom-stack", label: "ROM Stack", icon: Layers,
    title: "Entry ROM Stack",
    blurb: "What the mine builds out of that ROM, and the number it despatches "
         + "under. A stack is assembled from several days' samples.",
  },
  {
    // An upload rather than a form, which is why it still reads "Enter": what
    // the user is doing is entering a plan, and the screen is where they find
    // out it wants a spreadsheet.
    id: "entry-desilting", label: "Desilting Plan", icon: Droplets,
    title: "Enter Desilting Plan",
    blurb: "The month's de-silting plan, uploaded as a spreadsheet.",
  },
  {
    // Not "Enter" like the others, because nothing behind it is a figure being
    // entered. It is three standing decisions the OEE and the Lost Cost Matrix
    // are calculated from.
    id: "entry-oee-master", label: "OEE Master", icon: Pickaxe,
    title: "OEE Master Selector",
    blurb: "Which machine digs what, which machines are on the tables and what "
         + "they are measured against, and who owns each loss head.",
  },
  {
    id: "entry-shifting-actual", label: "Shifting Actual", icon: PencilLine,
    title: "Enter Shifting Actual",
    blurb: "The day's three movements, typed against the plan beside them.",
  },
  {
    id: "entry-shifting-plan", label: "Shifting Plan", icon: Shuffle,
    title: "Enter Shifting Plan",
    blurb: "The plan those are read against: an upload, a month at a time, "
         + "re-uploaded whenever the month's plan changes.",
  },
  {
    id: "entry-dewatering", label: "Dewatering", icon: Droplet,
    title: "Enter Daily Dewatering Data",
    blurb: "One day of the dewatering sheet: twenty-one figures typed, six "
         + "computed from them.",
  },
];

export const ENTRY_PAGES: AppPage[] = ENTRY_TABS.map((t) => t.id);

/** Is this screen one of the entry forms? */
export const isEntryPage = (p: string): boolean =>
  (ENTRY_PAGES as string[]).includes(p);

/** The tab, by page id. Undefined for anything that is not an entry screen. */
export const entryTab = (p: string): EntryTab | undefined =>
  ENTRY_TABS.find((t) => t.id === p);
