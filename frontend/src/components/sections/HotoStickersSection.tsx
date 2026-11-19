"use client";

/**
 * Cab stickers — the QR codes that go on the machines.
 *
 * ── WHY SCANNING IS THE INTENDED PATH ────────────────────────────────────────
 * A fleet with MAN-50, MAN-51, MAN-52, MAN-53 and MAN-55 in it is a fleet where
 * typing the number picks the wrong machine eventually. A handover filed
 * against the wrong machine is worse than no handover at all: the right machine
 * looks checked. The app offers the scanner first and search as the fallback,
 * and that only works if somebody has printed the stickers.
 *
 * ── WHAT IS IN THE CODE ──────────────────────────────────────────────────────
 * The machine's asset reference (EQP-2026-0008), not its fleet code. The fleet
 * code is what the mine renames when a tipper is re-registered; the reference
 * is the row. A sticker printed today still finds the machine after it is
 * renumbered.
 *
 * The fleet code is printed in the largest type on the sticker anyway, because
 * the operator needs to read it to know he is at the right cab, and because a
 * sticker nobody can read without a phone is no use when the phone is flat.
 *
 * ── PRINTING ─────────────────────────────────────────────────────────────────
 * Plain browser printing, no PDF library. A print stylesheet drops everything
 * but the sheet, fixes three columns and keeps a sticker from being split
 * across a page break. Printed on A4 label stock or plain paper and laminated,
 * which is what a mine will actually do.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Printer, QrCode, Search } from "lucide-react";
import QRCode from "qrcode";
import api from "@/lib/api";
import Explainer from "@/components/hoto/Explainer";

interface Asset {
  asset_id: number;
  fleet_code: string;
  nickname: string | null;
  /** What is painted on the vehicle. Null on the machines that never go on a road. */
  registration_no: string | null;
  asset_type_name: string;
  qr_code: string | null;
  plant_name?: string | null;
}

/**
 * The nickname, only when it says something the fleet code does not.
 *
 * Most of this fleet's nicknames are the fleet code with the punctuation
 * changed -- "AL-1" is nicknamed "AL 1", "BD-80-15306" is nicknamed
 * "BD-80-15306". Printing both would put the same word twice on a sticker the
 * size of a postcard and teach an operator to stop reading it.
 */
function usefulNickname(a: Asset): string | null {
  const n = (a.nickname ?? "").trim();
  if (!n) return null;
  const flat = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return flat(n) === flat(a.fleet_code) ? null : n;
}

/** Error correction M: a sticker in a cab gets scratched and greasy. */
const QR_OPTS = { errorCorrectionLevel: "M" as const, margin: 0, width: 320 };

export default function HotoStickersSection() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [codes, setCodes] = useState<Map<number, string>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/hoto/assets");
      setAssets(r.data.assets ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail?.message ?? "Could not load the machines.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const types = useMemo(
    () => [...new Set(assets.map((a) => a.asset_type_name))].sort(),
    [assets]);

  // Separators are noise, the same as in the app's own machine search: the
  // sticker for MAN-11 is found by typing "man 11".
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  const shown = useMemo(() => {
    const q = norm(search);
    return assets.filter((a) =>
      (!type || a.asset_type_name === type) &&
      (!q || norm(a.fleet_code).includes(q) || norm(a.qr_code ?? "").includes(q)
           || norm(a.nickname ?? "").includes(q)
           // By the number painted on it, which is how somebody in a yard
           // knows which machine they are looking at.
           || norm(a.registration_no ?? "").includes(q)));
  }, [assets, search, type]);

  const sheet = useMemo(
    () => assets.filter((a) => picked.has(a.asset_id) && a.qr_code),
    [assets, picked]);

  // Rendered once per machine and kept: re-encoding sixty QR codes on every
  // keystroke in the search box is a visibly slow screen.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = new Map(codes);
      let added = false;
      for (const a of sheet) {
        if (next.has(a.asset_id) || !a.qr_code) continue;
        next.set(a.asset_id, await QRCode.toDataURL(a.qr_code, QR_OPTS));
        added = true;
      }
      if (alive && added) setCodes(next);
    })();
    return () => { alive = false; };
  }, [sheet, codes]);

  const toggle = (id: number) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  const withoutCode = shown.filter((a) => !a.qr_code);

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #sticker-sheet, #sticker-sheet * { visibility: visible; }
          #sticker-sheet {
            position: absolute; left: 0; top: 0; width: 100%;
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 8mm;
          }
          .sticker {
            break-inside: avoid; page-break-inside: avoid;
            border: 1.5pt solid #000 !important; color: #000 !important;
            background: #fff !important;
          }
          @page { margin: 10mm; }
        }
      `}</style>

      <header className="no-print">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <QrCode className="h-5 w-5" /> Cab stickers
          <Explainer>
            The QR code an operator scans to pick his machine. Scanning is the
            intended path — a fleet with MAN-50 through MAN-55 in it is one
            where typing the number picks the wrong machine eventually, and a
            handover filed against the wrong machine is worse than none: the
            right machine looks checked.
          </Explainer>
        </h1>
      </header>

      {error && (
        <div className="no-print rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      {/* ── choosing ──────────────────────────────────────────────────── */}
      <div className="no-print space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="man 11, OD 04 H…, EQP-2026…"
              className="pl-7 pr-2 py-1.5 text-sm rounded-md border border-border bg-background w-56"
            />
          </div>
          <select value={type} onChange={(e) => setType(e.target.value)}
                  className="text-sm px-2 py-1.5 rounded-md border border-border bg-background">
            <option value="">Every machine type</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={() => setPicked(new Set(shown.filter((a) => a.qr_code).map((a) => a.asset_id)))}
                  className="text-sm rounded-md border px-3 py-1.5 hover:bg-accent">
            Select these {shown.filter((a) => a.qr_code).length}
          </button>
          <button onClick={() => setPicked(new Set())}
                  className="text-sm rounded-md border px-3 py-1.5 hover:bg-accent">
            Clear
          </button>
          <button
            disabled={sheet.length === 0 || codes.size < sheet.length}
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 text-sm rounded-md bg-foreground text-background px-3 py-1.5 disabled:opacity-40"
          >
            <Printer className="h-4 w-4" />
            Print {sheet.length > 0 ? `${sheet.length} sticker${sheet.length === 1 ? "" : "s"}` : ""}
          </button>
        </div>

        {withoutCode.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50/60 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/20">
            <strong>{withoutCode.length} machine{withoutCode.length === 1 ? " has" : "s have"} no
            reference</strong>, so no sticker can be made:{" "}
            {withoutCode.slice(0, 8).map((a) => a.fleet_code).join(", ")}
            {withoutCode.length > 8 ? "…" : ""}. They are picked by search in the app
            until one is set on the machine record.
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="rounded-md border max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {shown.map((a) => (
                  <tr key={a.asset_id}
                      className={`border-b last:border-0 ${a.qr_code ? "cursor-pointer hover:bg-accent/40" : "opacity-50"}`}
                      onClick={() => a.qr_code && toggle(a.asset_id)}>
                    <td className="px-3 py-1.5 w-8">
                      <input type="checkbox" readOnly disabled={!a.qr_code}
                             checked={picked.has(a.asset_id)} />
                    </td>
                    <td className="px-2 py-1.5 font-medium">
                      {a.fleet_code}
                      {usefulNickname(a) && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          {usefulNickname(a)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">{a.asset_type_name}</td>
                    <td className="px-2 py-1.5 text-xs font-medium">
                      {a.registration_no ?? <span className="opacity-40">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground font-mono">
                      {a.qr_code ?? "no reference"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── the sheet ─────────────────────────────────────────────────── */}
      {sheet.length > 0 && (
        <div id="sticker-sheet"
             className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
          {sheet.map((a) => (
            <div key={a.asset_id}
                 className="sticker rounded-lg border-2 border-foreground/80 bg-white p-3 flex flex-col items-center gap-2 text-black">
              {/* The fleet code first and largest: the operator reads it to
                  know he is at the right cab, and a sticker nobody can read
                  without a phone is no use when the phone is flat. */}
              <div className="text-xl font-extrabold tracking-tight text-center leading-tight">
                {a.fleet_code}
              </div>
              {usefulNickname(a) && (
                <div className="text-[11px] font-medium text-center -mt-1 leading-tight">
                  {usefulNickname(a)}
                </div>
              )}
              <div className="text-[10px] uppercase tracking-wide text-center -mt-0.5">
                {a.asset_type_name}
              </div>
              {/* The number painted on the vehicle, boxed so it reads as the
                  one thing to check against the machine you are standing at.
                  Absent on the machines that never go on a road, and saying
                  so beats leaving a blank that looks like a printing fault. */}
              {a.registration_no ? (
                <div className="text-[13px] font-bold tracking-wide text-center border border-black/70 rounded px-2 py-0.5">
                  {a.registration_no}
                </div>
              ) : (
                <div className="text-[9px] uppercase tracking-wide text-center opacity-60">
                  not road registered
                </div>
              )}
              {codes.get(a.asset_id) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={codes.get(a.asset_id)} alt={`QR for ${a.fleet_code}`}
                     className="w-32 h-32" />
              ) : (
                <div className="w-32 h-32 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}
              <div className="text-[9px] font-mono">{a.qr_code}</div>
              <div className="text-[8px] uppercase tracking-wider text-center">
                Scan to start a handover
              </div>
            </div>
          ))}
        </div>
      )}

      {sheet.length === 0 && !loading && (
        <p className="no-print text-sm text-muted-foreground">
          Pick machines above to build a sheet. Stickers print three to a row on
          A4 — cut, laminate, and fix one inside each cab where an operator can
          reach it from the seat.
        </p>
      )}
    </div>
  );
}
