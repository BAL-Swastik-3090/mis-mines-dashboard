"use client";

/**
 * One entry form, as a screen.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────────────
 * Every one of these forms used to be a dialog mounted inside whichever
 * dashboard section held the figures it needed — stock and ROM in
 * StockSection, de-silting and shifting in ProductionSection, the OEE master
 * in OEESection, dewatering in DewateringSection, est actual inside the
 * variance table. A dialog has to be mounted somewhere, and that was the only
 * somewhere there was, so the header menu had to navigate you to that section
 * before it could open anything:
 *
 *     setPage(which === "equipment-plan" ? "oee" : "mis");
 *
 * Asking to type yesterday's dewatering figures therefore moved you to the MIS
 * dashboard. The forms now have a place of their own and that line is gone.
 *
 * ── THE FORM IS THE PAGE, NOT A DIALOG OVER IT ───────────────────────────────
 * The first cut of this screen kept each form floating, over a card that said
 * what the form was for. That was wrong and the mine said so: a dialog is a
 * thing laid over the work you were doing, and the whole point of giving these
 * forms a section is that there is no longer any work underneath to go back
 * to. So the form renders in the page — no backdrop, no click-to-dismiss, no
 * close button. FormShell carries both modes; the forms themselves are
 * unchanged apart from which frame they ask for.
 *
 * CANCEL STILL MEANS SOMETHING. With nothing behind the form, "close" would
 * leave an empty screen, so Cancel remounts the form instead — which is what
 * Cancel means on a page: throw away what I have typed and start again. It is
 * done by changing the key rather than by reaching into ten forms to reset
 * their drafts, because every one of them already starts clean on mount.
 *
 * ── THE DIALOGS' CACHE CALLBACKS CAME ACROSS VERBATIM ────────────────────────
 * Each is a statement about what a save actually disturbs, and re-deriving
 * them from memory is how a section quietly stops refreshing. They are copied
 * with their comments, not rewritten.
 */

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Lock } from "lucide-react";
import { useAppPage, type AppPage } from "@/contexts/useAppPage";
import { useDateFilter } from "@/contexts/useDateFilter";
import { useAuth } from "@/contexts/useAuth";
import { canOpen } from "@/contexts/pageAccess";
import { reportDay } from "@/lib/prevDay";
import { entryTab } from "@/components/layout/entryNav";

import PrevDayEntryModal      from "@/components/tables/PrevDayEntryModal";
import MinesStockEntryModal   from "@/components/sections/MinesStockEntryModal";
import MinesReserveEntryModal from "@/components/sections/MinesReserveEntryModal";
import MinesRomEntryModal     from "@/components/sections/MinesRomEntryModal";
import MinesRomStackEntryModal from "@/components/sections/MinesRomStackEntryModal";
import DesiltingPlanModal     from "@/components/sections/DesiltingPlanModal";
import EquipmentPlanModal     from "@/components/sections/EquipmentPlanModal";
import ShiftingActualModal    from "@/components/sections/ShiftingActualModal";
import ShiftingPlanModal      from "@/components/sections/ShiftingPlanModal";
import DewateringEntryModal   from "@/components/sections/DewateringEntryModal";

export default function EntryHubSection({ form }: { form: AppPage }) {
  const tab = entryTab(form);
  const qc = useQueryClient();
  const { apiTo } = useDateFilter();
  const page = useAppPage((s) => s.page);
  const user = useAuth((s) => s.user);

  /* Cancel throws the draft away by remounting, which it does by changing the
     key below.

     IT NEVER RESETS, DELIBERATELY. An earlier version zeroed this on arrival,
     which looked tidy and mounted every form twice: moving from a form you had
     cancelled on (attempt 3) to another rendered the new one at
     "entry-rom:3" first, and the reset effect then ran and changed the key to
     "entry-rom:0" — tearing the form down and building it again, firing every
     query in it twice and discarding whatever had been focused. Nothing needs
     the reset: the key already carries the form's own id, so switching forms
     changes it whatever the counter says. */
  const [attempt, setAttempt] = useState(0);
  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  /* ── THE CONFIRMATION THE DIALOG USED TO BE ───────────────────────────────
     Seven of the ten forms say so themselves: they hold a `done` state and
     print what was written. Three did not, because they did not need to — the
     dialog vanishing WAS the confirmation, and they called onClose() on a
     successful save.

     Inline nothing vanishes, so without this a save looks identical to a save
     that silently failed: the figures sit there and nothing moves. Only those
     three get a flash; adding one to the seven would print the same news
     twice, which teaches people to stop reading both. */
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => { setFlash(null); }, [page]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  /* Where the est-actual date box starts. The variance table that used to own
     this form passed its own head day; this is the same derivation from the
     same filter, so the form still opens on the day the header asks for. */
  const headDay = reportDay(apiTo);

  /* ── What a save disturbs ──────────────────────────────────────────────── */

  // A saved position changes the stock section, and the form's own copy of the
  // day. Leaving ["stock-entry"] stale meant reopening the form within its
  // 30-second window showed the figures as they were BEFORE the save that had
  // just succeeded — which reads exactly like the save having failed.
  const afterStock = useCallback((day: string) => {
    void qc.invalidateQueries({ queryKey: ["stock"] });
    void qc.invalidateQueries({ queryKey: ["stock-entry"] });
    setFlash(`Stock position saved for ${day}.`);
  }, [qc]);

  // The remaining-reserve figures are derived and not stored, so only the
  // reserve queries need refreshing.
  const afterReserve = useCallback((day: string) => {
    void qc.invalidateQueries({ queryKey: ["resource-reserve"] });
    void qc.invalidateQueries({ queryKey: ["resource-reserve-entry"] });
    void qc.invalidateQueries({ queryKey: ["resource-reserve-value"] });
    setFlash(`Resource reserve declared as on ${day}.`);
  }, [qc]);

  // The day's ROM. The stock position is counted, not derived from this, and
  // must not be refreshed as though it were.
  const afterRom = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["rom-day"] });
    void qc.invalidateQueries({ queryKey: ["rom-range"] });
    void qc.invalidateQueries({ queryKey: ["rom-pending"] });
    void qc.invalidateQueries({ queryKey: ["rom-locations"] });
  }, [qc]);

  // A saved stack changes the stacks and how much of each ROM sample is left
  // to stack — and nothing else. ["rom-day"] is deliberately NOT in here:
  // building a stack does not touch what was dug, and refreshing it would say
  // the day's figures had moved when they had not.
  const afterStack = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["rom-stack"] });
    void qc.invalidateQueries({ queryKey: ["rom-stack-samples"] });
  }, [qc]);

  // The de-silting plan feeds the KPI card in the production section, the
  // day-wise silt_plan beneath it, and the Executive Summary's achievement.
  const afterDesilting = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["production"] }),
      qc.invalidateQueries({ queryKey: ["executive-summary"] }),
      qc.invalidateQueries({ queryKey: ["desilting-plan"] }),
    ]);
  }, [qc]);

  // One prefix covers the plan, the actual and their history: the plan screen
  // and the actual screen read each other's data, so a save on either must
  // refresh both.
  const afterShifting = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["shifting"] });
  }, [qc]);

  const afterDewatering = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["dewatering-entry"] }),
      qc.invalidateQueries({ queryKey: ["dewatering"] }),
    ]);
  }, [qc]);

  // KEYED ON THE DAY THAT WAS SAVED, not on the day this screen is showing.
  // Each prev-day query is keyed by the date it actually fetches, so whichever
  // of them holds savedDay is the one this invalidates — the same callback the
  // variance table used, and it must stay keyed this way or saving a figure
  // for a day other than the one on screen refreshes nothing.
  const afterPrevDay = useCallback(
    async (savedDay: string) => {
      await qc.invalidateQueries({ queryKey: ["prev-day", "entered", savedDay] });
      setFlash(`Estimated actuals saved for ${savedDay}.`);
    },
    [qc],
  );

  // ["oee"] is the prefix of the LCM and KAM-tree keys as well as the OEE
  // table's own, so one invalidation refetches every figure the selector can
  // move — on that page and on the LCM page.
  const afterOeeMaster = useCallback(
    () => qc.invalidateQueries({ queryKey: ["oee"] }),
    [qc],
  );

  /* A page that is not one of the ten. The route guard should never let this
     render, but a silent blank screen is the worst way to find out it did. */
  if (!tab) return null;

  /* ── Closed, rather than empty ─────────────────────────────────────────────
     MainLayout's guard catches this first and says "Not your page", so in
     practice nobody reaches the panel below. It is here anyway because this
     component decides what a person may type, and a screen that renders a form
     it has not checked is one refactor away from showing a form that cannot be
     saved. Said in this screen's own words rather than the generic ones: the
     question here is not "may I look at this" but "may I file this". */
  if (!canOpen(user, form)) {
    return (
      <section className="mx-auto mt-10 max-w-md rounded-lg border border-border
                          bg-white px-6 py-8 text-center shadow-sm">
        <Lock size={22} className="mx-auto text-txt-light" />
        <h2 className="mt-3 font-condensed text-[17px] font-extrabold text-navy">
          You do not have access to this section
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-txt-muted">
          {tab.title} has not been granted to your account. An Access Manager
          grants it under Access Control.
        </p>
      </section>
    );
  }

  const props = { open: true, inline: true, onClose: restart };

  return (
    <section className="pb-6">
      {flash && (
        <div
          role="status"
          className="mb-3 flex items-center gap-2 rounded border border-[#a5d6a7]
                     bg-[#e8f5e9] px-3 py-2 text-[12px] font-semibold text-[#2e7d32]"
        >
          <Check size={14} className="shrink-0" />
          {flash}
        </div>
      )}
      <div key={`${form}:${attempt}`}>
      {form === "entry-prev-day" && (
        <PrevDayEntryModal {...props} defaultDay={headDay} onSaved={afterPrevDay} />
      )}
      {form === "entry-stock" && (
        <MinesStockEntryModal {...props} onSaved={afterStock} />
      )}
      {form === "entry-reserve" && (
        <MinesReserveEntryModal {...props} onSaved={afterReserve} />
      )}
      {form === "entry-rom" && (
        <MinesRomEntryModal {...props} onSaved={afterRom} />
      )}
      {form === "entry-rom-stack" && (
        <MinesRomStackEntryModal {...props} onSaved={afterStack} />
      )}
      {form === "entry-desilting" && (
        <DesiltingPlanModal {...props} onSaved={afterDesilting} />
      )}
      {form === "entry-oee-master" && (
        <EquipmentPlanModal {...props} onSaved={afterOeeMaster} />
      )}
      {form === "entry-shifting-actual" && (
        <ShiftingActualModal {...props} onSaved={afterShifting} />
      )}
      {form === "entry-shifting-plan" && (
        <ShiftingPlanModal {...props} onSaved={afterShifting} />
      )}
      {form === "entry-dewatering" && (
        <DewateringEntryModal {...props} onSaved={afterDewatering} />
      )}
      </div>
    </section>
  );
}
