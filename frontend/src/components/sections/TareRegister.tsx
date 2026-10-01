"use client";

/* Every empty weight ever taken, as a series per vehicle.
 *
 * WHY A SERIES AND NOT A NUMBER. asset.standing_tare_kg holds one figure and
 * every new tare overwrites it — and that one figure produces every net weight
 * for the vehicle until it is taken again. Getting it wrong is not one bad
 * trip, it is a fortnight of them, and there was no way to see what it used to
 * be or when it changed.
 *
 * A tare drifts for honest reasons: a body repair, a spare wheel, mud packed
 * into the chassis after a wet week. A tipper that has gained 400 kg across
 * three months has something in it, and nobody sees that from a column of
 * absolute numbers. So the change between readings is what this screen leads
 * with.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Scale, ChevronDown, ChevronRight, TrendingUp, Search } from "lucide-react";
import api from "@/lib/api";
import { Card, CardHeader, Th, Td, EmptyRow, Chip, Button,
         inputClass, filterSelectClass, Alert } from "@/components/minehub/ui";

interface Reading {
  tare_reading_id: number; asset_id: number | null;
  fleet_code: string | null; registration_no: string | null;
  nickname: string | null;
  weight_kg: number; taken_at: string; taken_by: string | null;
  /** The name behind taken_by, when the employee master has one. */
  taken_by_name: string | null;
  capture_mode: string; manual_reason: string | null; note: string | null;
  bridge: string | null;
  previous_kg: number | null; change_kg: number | null;
  days_since_previous: number | null;
  superseded_at: string | null; is_current: boolean; is_big_change: boolean;
  payload_capacity_kg: number | null;
}
interface VehicleRow {
  fleet_code: string | null; registration_no: string | null;
  nickname: string | null; asset_id: number | null;
  readings: number; current_kg: number | null; current_taken_at: string | null;
  first_kg: number | null; lowest_kg: number | null; highest_kg: number | null;
  drift_kg: number | null; spread_kg: number | null;
  payload_capacity_kg: number | null;
}
interface Register {
  readings: Reading[]; vehicles: VehicleRow[]; stale_after_days: number;
}

const KG = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const when = (iso: string | null) =>
  !iso ? "—" : new Date(iso).toLocaleString("en-IN",
    { day: "2-digit", month: "short", year: "2-digit",
      hour: "2-digit", minute: "2-digit" });

const days = (iso: string | null) => {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
};

export default function TareRegister({ onError }: { onError?: (m: string) => void }) {
  const [reg, setReg] = useState<Register | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<Register>("/weighbridge/tare-register",
        { params: { days: 730 } });
      setReg(r.data);
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      onError?.(d ?? "Could not read the tare register.");
    } finally { setLoading(false); }
  }, [onError]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (reg?.vehicles ?? []).filter((v) => {
      const hay = `${v.fleet_code ?? ""} ${v.registration_no ?? ""}`.toLowerCase();
      if (s && !hay.includes(s)) return false;
      const age = days(v.current_taken_at);
      if (only === "STALE") {
        return age != null && age > (reg?.stale_after_days ?? 14);
      }
      if (only === "DRIFT") return v.drift_kg != null && Math.abs(v.drift_kg) >= 500;
      if (only === "ONCE") return v.readings === 1;
      return true;
    });
  }, [reg, q, only]);

  const byVehicle = useMemo(() => {
    const m: Record<string, Reading[]> = {};
    for (const r of reg?.readings ?? []) {
      const k = r.fleet_code ?? r.registration_no ?? "—";
      (m[k] ??= []).push(r);
    }
    return m;
  }, [reg]);

  const stale = reg?.stale_after_days ?? 14;

  return (
    <Card>
      <CardHeader icon={Scale} tone="gold" subtitleOnIcon
        title="Tare register"
        subtitle="Every empty weight ever taken, and what changed between them. One overwritten number cannot show a drift — and a tipper that has quietly gained half a tonne is carrying it on every net weight since."
        actions={
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="px-2.5 py-1 rounded-lg bg-bg-soft">
              <span className="font-mono text-[13px] font-bold text-navy">
                {rows.length}
              </span>
              <span className="text-[10.5px] text-txt-muted ml-1">vehicles</span>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-bg-soft">
              <span className="font-mono text-[13px] font-bold text-navy">
                {reg?.readings.length ?? 0}
              </span>
              <span className="text-[10.5px] text-txt-muted ml-1">readings</span>
            </span>
          </span>
        } />

      <div className="px-4 py-2.5 border-b border-border-light
                      flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[190px] max-w-[300px]">
          <Search className="w-3.5 h-3.5 text-txt-light absolute left-2.5
                             top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Fleet code or registration"
            className={`${inputClass} pl-8 py-1.5 text-[12px] ${q ? "border-gold" : ""}`} />
        </div>
        <select value={only} onChange={(e) => setOnly(e.target.value)}
          className={filterSelectClass(!!only)}>
          <option value="">Every vehicle</option>
          <option value="STALE">Tare older than {stale} days</option>
          <option value="DRIFT">Moved 500 kg or more</option>
          <option value="ONCE">Only ever weighed once</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px]">
          <thead>
            <tr>
              <Th>Vehicle</Th>
              <Th className="text-right">Tare now</Th>
              <Th>Taken</Th>
              <Th className="text-right">Since first</Th>
              <Th className="text-right">Spread</Th>
              <Th className="text-right">Readings</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {loading && !reg && <EmptyRow colSpan={7}>Reading the register…</EmptyRow>}
            {!loading && rows.length === 0 && (
              <EmptyRow colSpan={7}>
                No vehicle has an empty weight on record yet.
              </EmptyRow>
            )}
            {rows.map((v) => {
              const key = v.fleet_code ?? v.registration_no ?? "—";
              const isOpen = open === key;
              const age = days(v.current_taken_at);
              const isStale = age != null && age > stale;
              return (
                <Fragment key={key}>
                  <tr
                    className={`border-t border-border-light hover:bg-bg-soft/50
                                cursor-pointer ${isStale ? "bg-amber-bg/20" : ""}`}
                    onClick={() => setOpen(isOpen ? null : key)}>
                    <Td>
                      {/* The name the mine uses, then the plate that confirms
                          it. Nobody at the bridge says OD-04-B-8776. */}
                      <span className="font-semibold text-navy">
                        {v.fleet_code || v.registration_no}
                      </span>
                      {v.fleet_code && v.registration_no
                        && v.fleet_code !== v.registration_no && (
                        <span className="block text-[11px] text-txt-light">
                          {v.registration_no}
                        </span>
                      )}
                    </Td>
                    <Td className="text-right font-mono text-[13px] font-semibold text-navy">
                      {KG(v.current_kg)}
                      <span className="text-[10px] text-txt-light ml-1">kg</span>
                    </Td>
                    <Td className="text-[11.5px]">
                      <span className={isStale ? "text-amber-dark font-semibold"
                                               : "text-txt-muted"}>
                        {when(v.current_taken_at)}
                      </span>
                      {age != null && (
                        <span className="block text-[10px] text-txt-light">
                          {age === 0 ? "today" : `${age} days ago`}
                          {isStale ? " — worth taking again" : ""}
                        </span>
                      )}
                    </Td>
                    {/* The drift is the point of the whole screen. */}
                    <Td className="text-right font-mono text-[12px]">
                      {v.drift_kg == null || v.readings < 2 ? (
                        <span className="text-txt-light">—</span>
                      ) : (
                        <span className={Math.abs(v.drift_kg) >= 500
                          ? "text-amber-dark font-semibold" : "text-txt-muted"}>
                          {v.drift_kg > 0 ? "+" : ""}{KG(v.drift_kg)}
                        </span>
                      )}
                    </Td>
                    <Td className="text-right font-mono text-[12px] text-txt-muted">
                      {v.readings < 2 ? "—" : KG(v.spread_kg)}
                    </Td>
                    <Td className="text-right text-[12px] text-txt-muted">
                      {v.readings}
                      {v.readings === 1 && (
                        <span className="block text-[9.5px] text-txt-light">
                          nothing to compare
                        </span>
                      )}
                    </Td>
                    <Td className="text-right">
                      {isOpen ? <ChevronDown className="w-4 h-4 inline text-txt-light" />
                              : <ChevronRight className="w-4 h-4 inline text-txt-light" />}
                    </Td>
                  </tr>

                  {isOpen && (
                    <tr className="bg-bg-soft/40">
                      <Td colSpan={7}>
                        <div className="py-1">
                          {(byVehicle[key] ?? []).map((r) => (
                            <div key={r.tare_reading_id}
                              className="flex flex-wrap items-center gap-2 py-1
                                         border-b border-border-light/60 last:border-0">
                              <span className="font-mono text-[12.5px] font-semibold
                                               text-navy w-[92px] text-right">
                                {KG(r.weight_kg)} kg
                              </span>
                              <span className="text-[11.5px] text-txt-muted w-[150px]">
                                {when(r.taken_at)}
                              </span>
                              {r.change_kg != null ? (
                                <Chip tone={r.is_big_change ? "amber" : "slate"}
                                  dot={false}
                                  title={r.days_since_previous != null
                                    ? `${r.days_since_previous} days after the one before`
                                    : undefined}>
                                  <TrendingUp className="w-3 h-3" />
                                  {r.change_kg > 0 ? "+" : ""}{KG(r.change_kg)} kg
                                </Chip>
                              ) : (
                                <Chip tone="slate" dot={false}>first on record</Chip>
                              )}
                              <Chip tone={r.capture_mode === "BRIDGE" ? "emerald"
                                : r.capture_mode === "MANUAL" ? "rose" : "slate"}
                                dot={false}
                                title={r.manual_reason ?? undefined}>
                                {r.capture_mode === "BRIDGE" ? "off the bridge"
                                  : r.capture_mode === "MANUAL" ? "typed"
                                  : "carried over"}
                              </Chip>
                              {r.is_current && <Chip tone="gold">in force</Chip>}
                              {r.bridge && (
                                <span className="text-[10.5px] text-txt-light">
                                  {r.bridge}
                                </span>
                              )}
                              {r.taken_by && (
                                /* The name first, because that is what a
                                   reviewer recognises; the number kept after
                                   it, because that is what every other
                                   system and every export is keyed on. */
                                <span className="text-[10.5px] text-txt-light"
                                      title={`Employee ${r.taken_by}`}>
                                  by {r.taken_by_name ?? r.taken_by}
                                  {r.taken_by_name && (
                                    <span className="text-txt-light/70"> · {r.taken_by}</span>
                                  )}
                                </span>
                              )}
                              {(r.manual_reason || r.note) && (
                                <span className="text-[10.5px] text-txt-muted
                                                 basis-full sm:basis-auto">
                                  {r.manual_reason || r.note}
                                </span>
                              )}
                            </div>
                          ))}
                          {v.payload_capacity_kg != null && v.current_kg != null && (
                            <p className="text-[10.5px] text-txt-light mt-1.5">
                              Rated payload {KG(v.payload_capacity_kg)} kg, so a
                              full load should weigh about{" "}
                              {KG(v.current_kg + v.payload_capacity_kg)} kg gross.
                            </p>
                          )}
                        </div>
                      </Td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {reg && reg.vehicles.some((v) => v.readings === 1) && (
        <div className="px-4 py-2 border-t border-border-light">
          <Alert tone="info">
            A vehicle weighed only once has nothing to compare against, so no
            drift can be shown for it. That is not a problem with the vehicle —
            it is what a register looks like when it has just started.
          </Alert>
        </div>
      )}
    </Card>
  );
}
