"use client";

/**
 * The photographs attached to a handover.
 *
 * ── WHY THIS DID NOT EXIST ───────────────────────────────────────────────────
 * The endpoints have been there since phase 11 and nothing in the dashboard
 * ever called them. So operators photographed cracked hoses, the pictures
 * reached the server, and nobody could look at them — which makes the whole
 * "add a photo" rule on the tablet a tax on the operator with nothing at the
 * other end.
 *
 * ── AN OPERATOR'S PHOTOGRAPH IS NOT EVIDENCE OF A FAULT ──────────────────────
 * It is shown apart from the evidence and labelled, because a picture of a
 * person must never sit in a row of pictures of defects where somebody
 * skim-reading would take it for one. The server refuses to let an operator
 * photo name a checklist item at all (migration 111); this is the same rule
 * on screen.
 *
 * Shared by the register and the defect queue: the workshop reading a defect
 * needs the picture far more than the office reading a handover does.
 */

import { useEffect, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import api from "@/lib/api";

/**
 * A number, whatever the API felt like sending.
 *
 * Postgres numeric reaches JSON as a string unless something converts it, and
 * a screen that called .toFixed() on a latitude crashed the whole detail page
 * on the first handover that had one. The server now converts them; this is
 * here so that the next column nobody remembers to add to that list costs a
 * missing line instead of a blank screen.
 */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

interface PhotoMeta {
  photo_id: number;
  item_id: number | null;
  item_label: string | null;
  kind: "ITEM" | "OPERATOR";
  captured_at: string;
  received_at: string;
  size_bytes: number;
  captured_lat: number | null;
  captured_lon: number | null;
  gps_accuracy_m: number | null;
}

/**
 * The photographs attached to a handover.
 *
 * ── WHY THIS SCREEN DID NOT EXIST ────────────────────────────────────────────
 * The endpoints have been there since phase 11 and nothing in the dashboard
 * ever called them. So operators photographed cracked hoses and the pictures
 * reached the server and no one could look at them — which makes the whole
 * "add a photo" rule on the tablet a tax on the operator with nothing at the
 * other end.
 *
 * ── AN OPERATOR'S PHOTOGRAPH IS NOT EVIDENCE OF A FAULT ──────────────────────
 * It is shown apart from the evidence and labelled, because a picture of a
 * person must never sit in a row of pictures of defects where somebody
 * skim-reading would take it for one.
 */
export function HotoPhotos({ sessionId, itemId, compact }: {
  sessionId: number;
  /** Only this check's evidence. Used by a defect, which is about one item. */
  itemId?: number | null;
  /** Inside a defect card, where there is less room and no operator photo. */
  compact?: boolean;
}) {
  const [photos, setPhotos] = useState<PhotoMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [big, setBig] = useState<PhotoMeta | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await api.get(`/hoto/register/${sessionId}/photos`);
        const all: PhotoMeta[] = r.data.photos ?? [];
        // A defect is about one check. Its evidence is that check's photos,
        // and never the operator's portrait.
        if (alive) setPhotos(itemId == null ? all
          : all.filter((p) => p.kind !== "OPERATOR" && p.item_id === itemId));
      } catch {
        if (alive) setError("Could not load the photographs.");
      }
    })();
    return () => { alive = false; };
  }, [sessionId, itemId]);

  // Escape closes it, because a reader whose first instinct is the keyboard
  // should not have to hunt for a button.
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBig(null); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [big]);

  if (error) return <p className="text-xs text-red-700">{error}</p>;
  if (!photos) return (
    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
      <Loader2 size={12} className="animate-spin" /> Loading photographs…
    </p>
  );
  if (photos.length === 0) return (
    <p className="text-xs text-muted-foreground">
      {itemId != null
        ? "No photograph reached the office for this check."
        : "No photographs reached the office for this handover."}
    </p>
  );

  const operator = photos.filter((p) => p.kind === "OPERATOR");
  const evidence = photos.filter((p) => p.kind !== "OPERATOR");

  const tile = (p: PhotoMeta) => (
    <button key={p.photo_id} onClick={() => setBig(p)}
            className="group text-left rounded border border-border overflow-hidden hover:border-foreground/40">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/hoto/photos/${p.photo_id}`}
           alt={p.item_label ?? "photograph"}
           className="w-full h-28 object-cover bg-muted" />
      <div className="px-1.5 py-1">
        <div className="text-[10px] font-medium truncate">
          {p.item_label ?? (p.kind === "OPERATOR" ? "The operator" : "The machine")}
        </div>
        <div className="text-[9px] text-muted-foreground flex items-center gap-1">
          {num(p.captured_lat) != null
            ? <><MapPin size={8} /> geotagged</>
            : <span className="opacity-60">no position</span>}
        </div>
      </div>
    </button>
  );

  return (
    <div className="space-y-3">
      {evidence.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Evidence ({evidence.length})
          </h4>
          <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(130px,1fr))]">
            {evidence.map(tile)}
          </div>
        </div>
      )}

      {!compact && operator.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Who took the machine on
          </h4>
          <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(130px,1fr))] max-w-xs">
            {operator.map(tile)}
          </div>
        </div>
      )}

      {/* ── full size ────────────────────────────────────────────────────
          A real panel, not a floating caption. The first version leaned on
          a theme token for its background and the token painted nothing, so
          the metadata and the Close button sat transparently over the dimmed
          page behind and could barely be read. An overlay that cannot be
          read is worse than no overlay: the reader cannot tell whether the
          photograph has a position or the screen has simply failed. */}
      {big && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={big.item_label ?? "Photograph"}
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 sm:p-8"
          onClick={() => setBig(null)}
        >
          <div
            className="flex flex-col max-w-4xl w-full max-h-full rounded-lg overflow-hidden
                       bg-white text-black dark:bg-neutral-900 dark:text-neutral-100
                       shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* The picture gets the room; the facts keep a fixed strip, so a
                tall photograph can never push them off the screen. */}
            <div className="flex-1 min-h-0 bg-black flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/hoto/photos/${big.photo_id}`}
                alt={big.item_label ?? "photograph"}
                className="max-h-full max-w-full object-contain"
              />
            </div>

            <div className="shrink-0 border-t border-black/10 dark:border-white/10 p-3
                            flex items-start justify-between gap-4">
              <div className="space-y-0.5 text-xs min-w-0">
                <div className="font-semibold text-sm">
                  {big.item_label
                    ?? (big.kind === "OPERATOR" ? "The operator" : "The machine")}
                </div>
                <div className="opacity-70">
                  Taken {new Date(big.captured_at).toLocaleString("en-IN", {
                    day: "2-digit", month: "short", hour: "2-digit",
                    minute: "2-digit", hour12: false })}
                  {" · "}{Math.round(big.size_bytes / 1024)} kB
                </div>
                {num(big.captured_lat) != null ? (
                  <a
                    href={`https://www.google.com/maps?q=${num(big.captured_lat)},${num(big.captured_lon)}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300 hover:underline"
                  >
                    <MapPin size={11} />
                    {num(big.captured_lat)!.toFixed(6)}, {num(big.captured_lon)?.toFixed(6)}
                    {num(big.gps_accuracy_m) != null
                      && ` (±${Math.round(num(big.gps_accuracy_m)!)} m)`}
                  </a>
                ) : (
                  <div className="opacity-70">
                    No position — taken before the app recorded one, or no fix
                    was available at the machine.
                  </div>
                )}
              </div>
              <button
                onClick={() => setBig(null)}
                className="shrink-0 rounded border border-black/20 dark:border-white/20
                           px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

