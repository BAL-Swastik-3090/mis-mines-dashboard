/**
 * How long ago something happened, said the way a person would say it.
 *
 * A register being filled in right now needs the near end of this scale:
 * "changed today" covered everything from a minute ago to twenty-three hours
 * ago, which is the difference between somebody editing the machine you are
 * looking at while you look at it and somebody editing it before breakfast.
 *
 * The scale coarsens as it goes back, because at three weeks the minute is
 * noise and the date is what you were going to ask for anyway. Whatever the
 * short form says, `exactly()` is put on the element's title, so the short
 * form never costs anyone the real timestamp.
 *
 * `now` is a parameter so this is a pure function of its inputs and can be
 * tested at a boundary rather than near one.
 */
export function ago(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return "never edited";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";

  const secs = Math.floor((now - then.getTime()) / 1000);

  // A clock a few seconds fast on one machine should not produce "in 4
  // seconds" on a register that only ever records the past.
  if (secs < 45) return "just now";

  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  // Past a day the time of day stops mattering and the day starts to.
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;

  return then.toLocaleDateString("en-IN",
    { day: "2-digit", month: "short", year: "numeric" });
}

/** The whole truth, for the tooltip behind the short form. */
export function exactly(iso?: string | null): string {
  if (!iso) return "This has never been edited";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  return then.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}
