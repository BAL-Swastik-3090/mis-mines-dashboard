"use client";

/**
 * The frame every entry form sits in — as a dialog, or as the page itself.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────
 * All ten entry forms carried the same two divs, copied: a `fixed inset-0`
 * backdrop that closes on click, and a white panel inside it that swallows the
 * click so it does not. Ten copies of a frame is fine while the frame never
 * changes. It changed: the forms now have screens of their own under Daily
 * Entry Hub, and a form that floats over an empty page in a section built to
 * hold it is a dialog with nothing behind it to dismiss.
 *
 * So the frame became one component with two modes, rather than ten files
 * growing an `if` each.
 *
 * ── WHAT CHANGES BETWEEN THE MODES, AND WHAT DOES NOT ────────────────────────
 * Inline drops the backdrop, the fixed positioning, the click-to-dismiss and
 * the dialog role — there is nothing to dismiss and nothing being covered, and
 * announcing a page as `aria-modal` tells a screen reader the rest of the
 * application is inert when it is not.
 *
 * What does NOT change is the panel: same white ground, same border, same
 * widths, same content. The form a person has learnt is the same form.
 */

export default function FormShell({
  inline, maxW, inlineMax = "", label, onClose, panelClass = "", children,
}: {
  /** True on an entry screen, false in a dialog over a dashboard. */
  inline?: boolean;
  /** The Tailwind width class the form chose for itself, e.g. "max-w-4xl". */
  maxW: string;
  /** How wide this form's CONTENT may run inline, e.g. "max-w-[820px]".
   *
   *  Empty means "as wide as the page", which is right for the forms built
   *  around a wide table — ROM, ROM Stack, Mines Stock — where every column
   *  earns its width. It is wrong for the short ones. See the note below. */
  inlineMax?: string;
  /** What the dialog announces itself as. Unused inline, where the page's own
   *  heading and the strip across the top already say where you are. */
  label: string;
  onClose: () => void;
  /** Anything else the panel needs — PrevDayEntryModal caps its own height and
   *  scrolls inside, which only makes sense floating. */
  panelClass?: string;
  children: React.ReactNode;
}) {
  /* ── INLINE IGNORES maxW, DELIBERATELY ────────────────────────────────────
     Every one of those widths — max-w-xl through max-w-7xl — was chosen for a
     panel floating over a dashboard, where narrow is right: the thing
     underneath is still the page, and a dialog that covers all of it is a
     page replacement pretending to be a dialog.

     Inline there is nothing underneath. Keeping the cap put a 576px form in
     the middle of a 1690px screen with two thirds of it empty grey, which is
     what the mine saw and objected to. So the panel takes the width the page
     gives it, like every other section on this platform — the dashboard's own
     tables and cards are full-width too, and a form that is not reads as a
     dialog somebody forgot to finish.

     The page's container is what bounds it: MainLayout caps the content at
     1920px and pads the sides, so "full width" is still a measured width.

     ── BUT THE PANEL FILLING THE PAGE IS NOT THE SAME AS THE CONTENT DOING IT ──
     Stretching a short form to the full width is the opposite mistake, and a
     worse one, because it is paid for every time somebody types rather than
     once when they look. Measured on the Est Actual form at a 1690px window
     (a 1485px content area), the distance from a material's name to the box
     you type its figure into:

         dialog, 576px wide ............  235px
         panel capped at 1120px ........  591px
         panel running the full width ..  788px

     Three times the travel, six rows in a row, to save a glance at some grey.
     A row whose label and input are at opposite ends of a monitor is how a
     figure gets typed against the wrong material.

     So the PANEL takes the page — there is no grey left to object to — and the
     CONTENT keeps a width its own columns can use. Inside a full-width white
     card that reads as padding, which is what it is. Forms built around a wide
     table pass no cap and genuinely fill the page. */
  if (inline) {
    return (
      <div className="w-full bg-white rounded-lg border border-border shadow-sm">
        <div className={`mx-auto w-full ${inlineMax}`}>{children}</div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6
                 bg-black/45 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div
        className={`bg-white rounded-lg shadow-xl border border-border w-full
                    ${maxW} my-auto ${panelClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
