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
          {p.captured_lat != null
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

      {/* full size, with everything that makes it evidence */}
      {big && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
             onClick={() => setBig(null)}>
          <div className="bg-background rounded-lg max-w-3xl w-full max-h-full overflow-auto"
               onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/hoto/photos/${big.photo_id}`}
                 alt={big.item_label ?? "photograph"}
                 className="w-full object-contain max-h-[70vh] bg-black" />
            <div className="p-3 space-y-1 text-xs">
              <div className="font-semibold">
                {big.item_label ?? (big.kind === "OPERATOR" ? "The operator" : "The machine")}
              </div>
              <div className="text-muted-foreground">
                Taken {new Date(big.captured_at).toLocaleString("en-IN", {
                  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
                {" · "}{Math.round(big.size_bytes / 1024)} kB
              </div>
              {big.captured_lat != null ? (
                <a href={`https://www.google.com/maps?q=${big.captured_lat},${big.captured_lon}`}
                   target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 text-sky-700 hover:underline dark:text-sky-300">
                  <MapPin size={11} />
                  {big.captured_lat.toFixed(6)}, {big.captured_lon?.toFixed(6)}
                  {big.gps_accuracy_m != null && ` (±${Math.round(big.gps_accuracy_m)} m)`}
                </a>
              ) : (
                <div className="text-muted-foreground">
                  No position — taken before the app recorded one, or no fix was
                  available at the machine.
                </div>
              )}
              <button onClick={() => setBig(null)}
                      className="mt-1 rounded border px-2 py-1 text-[11px] hover:bg-accent">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

