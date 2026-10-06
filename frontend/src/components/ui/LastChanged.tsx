/**
 * "last changed 10:28 by 3090" — for any panel fed by a hand-entry form.
 *
 * WHY THIS EXISTS. A figure somebody typed is not like a figure read out of
 * SAP: it can be corrected after the meeting that discussed it, and until the
 * screen says so, the correction is invisible. Two people then quote the same
 * panel and disagree, with nothing on the page to explain why. Showing when it
 * last moved is what makes an edit legible as an edit.
 *
 * IT SHOWS THE CHANGE, NOT THE ENTRY. `at` is the last time the day was
 * written, which is Updated_At in the database, never Entry_Date. The two are
 * equal until somebody edits — so a day filed once and left alone reads exactly
 * as it always did, and only a day that actually moved says anything new.
 *
 * ONE COMPONENT RATHER THAN THE SAME SPAN TWICE. The stock panel and the
 * Plan vs Actual panel both need it, and two copies would drift — one would end
 * up saying "entered" while the other said "changed", which is the distinction
 * the whole thing exists to draw.
 */
"use client";

/** Clock time for today, date and time for anything older. A timestamp on the
 *  panel is read at a glance to answer "has this moved since I looked", and on
 *  the day itself the date is noise. */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth()
    && d.getDate() === today.getDate();
  const time = d.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return sameDay
    ? time
    : `${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} ${time}`;
}

export default function LastChanged({
  at, by, tone = "dark", prefix = "last changed",
}: {
  /** ISO timestamp of the last change, or null when nothing is stored. */
  at: string | null | undefined;
  /** Employee id that made it. */
  by?: string | null;
  /** "dark" for the navy header band, "light" for a white panel. */
  tone?: "dark" | "light";
  prefix?: string;
}) {
  // Renders nothing at all when there is no entry. An empty day should look
  // empty, not like a day whose change time failed to load.
  if (!at) return null;
  const text = stamp(at);
  if (!text) return null;

  return (
    <span
      className={`text-[10px] font-mono ${
        tone === "dark" ? "text-white/60" : "text-txt-light"
      }`}
      // The full timestamp on hover — the short form is for scanning, and
      // anyone reconciling two screens needs the seconds.
      title={`Last changed ${new Date(at).toLocaleString("en-IN")}${
        by ? ` by ${by}` : ""
      }`}
    >
      {prefix} {text}{by ? ` by ${by}` : ""}
    </span>
  );
}
