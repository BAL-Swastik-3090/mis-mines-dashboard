"use client";
import { useSyncExternalStore } from "react";

/**
 * "Everything is open right now, because we are about to photograph it."
 *
 * The HTML export clones the live DOM. Anything collapsed is not merely hidden
 * in that DOM — React never rendered it — so a downloaded Why-Why section
 * arrived with empty expanders: no Why chains, no per-machine detail, one
 * page of the register out of several. The file looked complete and was not.
 *
 * So before the clone, the page is put into export mode: every collapsible
 * thing renders open and every paged list renders whole. The clone is taken,
 * and the mode is dropped again. Readers of this flag should treat it as "show
 * all detail", never as a styling hook.
 *
 * A module-level store rather than a context because the components that need
 * it — the register rows, the machine list, the operator chips — sit at
 * different depths under three different sections, and threading a provider
 * through all of them to carry one boolean is more plumbing than the boolean
 * is worth.
 */
let exporting = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => exporting;
// The server renders the normal, collapsed page; export mode only ever exists
// in a browser that is mid-download.
const getServerSnapshot = () => false;

/** True while the page is being captured for download. */
export function useExporting(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * WAIT FOR THE PAGE TO STOP FETCHING BEFORE PHOTOGRAPHING IT.
 *
 * Expanding everything does not only reveal markup — it mounts components, and
 * a component that mounts starts its query. Capturing straight afterwards
 * catches those sections mid-flight and writes their loading skeletons into the
 * file: the OEE export arrived with `h-[280px] bg-bg-section animate-pulse`
 * where the KAM loss tree should have been, a grey box that looks like a broken
 * report rather than a section that had not loaded.
 *
 * `isFetching` is passed in rather than imported so this module stays free of
 * react-query — it is a plain store, and three export buttons already use it
 * without knowing anything about data fetching.
 *
 * It gives up after `timeoutMs`. A slow endpoint must not strand somebody on a
 * page frozen in export mode; a capture with one skeleton in it is better than
 * no capture and a stuck screen.
 */
async function waitForQuiet(isFetching: () => number, timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs;
  // Settle twice: one finished query often starts the next, and a single
  // zero-reading can fall in the gap between the two.
  let quiet = 0;
  while (Date.now() < until && quiet < 2) {
    quiet = isFetching() === 0 ? quiet + 1 : 0;
    await new Promise((r) => setTimeout(r, 120));
  }
}

/**
 * Open everything, run `capture`, then put it back — even if capture throws,
 * because a page left permanently expanded because an export failed is a worse
 * bug than the failed export.
 *
 * The two rAF waits let React commit the expanded tree and the browser lay it
 * out before anything is cloned; one frame is enough for the commit but not
 * reliably enough for layout, and the export reads computed sizes.
 *
 * `isFetching` is optional only so the one caller that predates it keeps
 * working; every caller should pass it.
 */
export async function withExportMode<T>(
  capture: () => Promise<T>,
  isFetching?: () => number,
): Promise<T> {
  exporting = true;
  emit();
  try {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    if (isFetching) await waitForQuiet(isFetching);
    // A second pair of frames: whatever arrived while waiting still has to be
    // committed and laid out before it can be measured.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    return await capture();
  } finally {
    exporting = false;
    emit();
  }
}
