"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowDownUp, CalendarDays, Database, Droplets,
         Loader2, TrendingDown } from "lucide-react";
import api from "@/lib/api";
import { Alert, Card, CardHeader, Chip, SortTh, sortRows, Td, Th }
  from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";
import FuelStockTrend from "@/components/charts/FuelStockTrend";
import FuelCalendar from "@/components/charts/FuelCalendar";
import FuelCalculator from "@/components/sections/FuelCalculator";

/**
 * Diesel at every plant: what is standing, how long it lasts, what is owed.
 *
 * READ FROM SAP, WRITTEN NOWHERE. Stock is entered in SAP against purchase
 * orders and cost centres, and keying the same delivery into this platform as
 * well would give two systems one fact to disagree about. So nothing on this
 * screen is editable and the platform's own fuel_receipt table stays empty on
 * purpose.
 *
 * Burn is CONSUMPTION — issues to a machine's cost centre, an order or a
 * transporter — never MB5B's "issued" column, which also counted diesel sent
 * to another plant and made Sukinda look thirty times thirstier than it is.
 * Cover is worked from the stock ABOVE the dead stock the pump cannot lift.
 */
interface Material {
  material: string; description: string; unit: string;
  closing_l: number; value: number; is_fuel: boolean; locations: number;
  min_l: number | null; reorder_l: number | null; max_l: number | null;
}
interface Rhythm {
  arrivals: number; avg_arrival_l: number | null; every_days: number | null;
  last_arrival: string | null; next_expected: string | null; yield: number | null;
}
type PlantState = "dormant" | "below_dead" | "below_reorder" | "below_min" | "ok";
interface Plant {
  plant: string; name: string; materials: Material[];
  fuel_l: number; fuel_value: number; held_l: number; dead_stock_l: number;
  available_l: number; capacity_l: number | null;
  min_l: number | null; reorder_l: number | null; max_l: number | null;
  levels_from_sap: boolean; state: PlantState;
  burn_per_day_l: number; consumed_l: number; received_l: number;
  transferred_out_l: number; adjusted_l: number;
  days_cover: number | null; dry_on: string | null; dormant: boolean;
  rhythm: Rhythm;
  inbound_overdue_l: number; inbound_stale_l: number; inbound_open_l: number;
}
interface Inbound {
  po: string; plant: string; vendor: string | null; material: string;
  pending_l: number; unit: string; due_on: string | null;
  days_late: number | null; overdue: boolean; stale: boolean;
}
interface Stock {
  as_on: string | null; history_as_on: string | null; stale_days: number | null;
  burn_window_days: number; rhythm_window_days: number;
  stale_after_days: number; plants: Plant[]; inbound: Inbound[];
  unclassified: { plant: string; material: string; description: string }[];
}
interface Movement {
  day: string; plant: string; name: string;
  opening_l: number | null; received_l: number; issued_l: number;
  transferred_out_l: number; adjusted_l: number; closing_l: number | null;
}
interface Projected {
  day: string; litres: number; arriving_l: number; dry: boolean;
  nothing_l: number; nothing_dry: boolean;
}
interface Receipt {
  po: string | null; vendor: string | null; header: string | null;
  reference: string | null; material: string; description: string;
  qty_l: number; challan_l: number | null; short_l: number | null;
  gate_in: string | null; value: number | null; is_transfer: boolean;
}
interface Arrival {
  plant: string; name: string; day: string; received_l: number;
  rate_per_l: number | null; receipts: Receipt[]; traced: boolean;
}
interface CalDay {
  day: string; actual: boolean; closing_l: number;
  issued_l: number | null; received_l: number; transferred_out_l?: number | null;
  days_cover: number | null; dry?: boolean;
}
type Way = "asc" | "desc";

const L = (n: number | null | undefined) =>
  n === null || n === undefined ? "—"
    : (Math.round(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const day = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN",
        { day: "2-digit", month: "short" }) : "—";

/** What a plant's state means, in the words the fuel office uses. */
const STATE: Record<PlantState, { tone: "rose" | "amber" | "emerald" | "slate"; say: string }> = {
  below_dead:    { tone: "rose",    say: "below dead stock" },
  below_reorder: { tone: "amber",   say: "below SAP reorder point" },
  below_min:     { tone: "rose",    say: "below SAP minimum" },
  ok:            { tone: "emerald", say: "healthy" },
  dormant:       { tone: "slate",   say: "not in use" },
};

/** How urgent a cover figure is. Two days is a day's warning, which on a
 *  tanker lead time of its own is no warning at all. */
function urgency(days: number | null): { tone: "rose" | "amber" | "emerald" | "slate"; say: string } {
  if (days === null) return { tone: "slate", say: "nothing drawn" };
  if (days <= 0) return { tone: "rose", say: "nothing above dead stock" };
  if (days < 3) return { tone: "rose", say: "critical" };
  if (days < 7) return { tone: "amber", say: "order now" };
  return { tone: "emerald", say: "comfortable" };
}

export default function FuelStockSection() {
  const [d, setD] = useState<Stock | null>(null);
  const [moves, setMoves] = useState<Movement[]>([]);
  const [proj, setProj] = useState<Projected[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /* The mine, because this is the mine's dashboard. "" is every plant, for
   * the comparison the four-row table above is already making. */
  const [plant, setPlant] = useState<string>("1200");
  const [mvSort, setMvSort] = useState<{ k: keyof Movement; d: Way } | null>(null);
  const [cal, setCal] = useState<{ today: string; burn_per_day_l: number;
                                   days: CalDay[] } | null>(null);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [arrivalBusy, setArrivalBusy] = useState(false);

  const openArrival = useCallback(async (pl: string, dy: string) => {
    setArrivalBusy(true);
    try {
      const r = await api.get(`/fuel-management/stock/${pl}/arrival/${dy}`);
      setArrival(r.data);
    } catch { /* the row it came from is still on screen */ }
    finally { setArrivalBusy(false); }
  }, []);

  /* The stock position is the screen; the chart is a nicety.
   *
   * These were one Promise.all, so a 404 on the movement endpoint blanked the
   * whole tab — the plant table, the overdue orders and the "1.9 days of
   * diesel" warning all disappeared because a chart could not be drawn. The
   * most important thing on the page was the first casualty of the least
   * important request.
   *
   * Now the stock call decides whether the screen renders, and the other two
   * fail quietly into an empty chart. */
  const load = useCallback(async () => {
    try {
      const stock = await api.get("/fuel-management/stock");
      setD(stock.data);
    } catch {
      setError("Could not read the fuel stock position from SAP.");
      setLoading(false);
      return;
    }
    setLoading(false);

    try {
      const mv = await api.get("/fuel-management/stock/movement",
                               { params: { days: 30 } });
      setMoves(mv.data?.movements ?? []);
    } catch { /* the tables above still stand */ }
  }, []);

  /* The projection follows whichever plant leads the list — the mine, because
   * that is the order the API returns them in. Kept apart from the load above
   * so it can wait for the plants without holding them up. */
  useEffect(() => {
    const lead = plant || d?.plants?.[0]?.plant;
    if (!lead) return;
    let alive = true;
    void (async () => {
      try {
        const [pr, cl] = await Promise.all([
          api.get(`/fuel-management/stock/${lead}/projection`, { params: { days: 21 } }),
          api.get(`/fuel-management/stock/${lead}/calendar`,
                  { params: { back: 35, forward: 14 } }),
        ]);
        if (!alive) return;
        setProj(pr.data?.days ?? []);
        setCal(cl.data ?? null);
      } catch { /* no forecast, but the figures behind it are still shown */ }
    })();
    return () => { alive = false; };
  }, [d, plant]);
  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div className="flex justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-gold" /></div>;
  }
  if (error || !d) return <Alert tone="error">{error ?? "No data."}</Alert>;

  const critical = d.plants.filter((p) => !p.dormant && (
    p.state === "below_dead" || p.state === "below_min" || p.state === "below_reorder"
    || (p.days_cover !== null && p.days_cover < 3)));
  /* Overdue within living memory, and the rest. 36 lines are more than a year
     past their date and hold 824,647 L between them — counting those as
     "coming" makes a plant with two days of diesel look supplied, which is
     the one mistake this screen exists to prevent. */
  const overdue = d.inbound.filter((i) => i.overdue && !i.stale);
  const stale = d.inbound.filter((i) => i.stale);
  const overdueL = overdue.reduce((s, i) => s + i.pending_l, 0);
  const staleL = stale.reduce((s, i) => s + i.pending_l, 0);
  /* The plant in focus. Everything below the four-row summary follows it:
     the chart, the movement, and which orders are listed. */
  const lead = d.plants.find((p) => p.plant === plant) ?? d.plants[0];
  const shownMoves = sortRows(
    plant ? moves.filter((m) => m.plant === plant) : moves,
    mvSort?.k ?? null, mvSort?.d ?? null);

  return (
    <div className="space-y-4">
      {/* The thing that needs doing today, before the tables that explain it.
          Said per plant, in that plant's own terms: the mine has no SAP levels
          but a dead stock; Sukinda and Balasore have SAP's own reorder points. */}
      {critical.length > 0 && (
        <Alert tone="error">
          <span className="block space-y-0.5">
            {critical.map((p) => (
              <span key={p.plant} className="block">
                <strong>{p.name}:</strong>{" "}
                {p.state === "below_dead"
                  ? <>{L(p.fuel_l)} L in the tank, under the {L(p.dead_stock_l)} L the
                      pump cannot lift — nothing can be drawn until the next tanker
                      {p.rhythm.next_expected ? <> (expected {day(p.rhythm.next_expected)})</> : null}.</>
                  : p.state === "below_reorder"
                    ? <>{L(p.fuel_l)} L, under SAP&rsquo;s reorder point of {L(p.reorder_l)} L
                        {p.days_cover !== null && <> — {p.days_cover} days at {L(p.burn_per_day_l)} L a day</>}.</>
                    : p.state === "below_min"
                      ? <>{L(p.fuel_l)} L, under SAP&rsquo;s minimum of {L(p.min_l)} L.</>
                      : <>{p.days_cover} days of diesel above dead stock at {L(p.burn_per_day_l)} L a day.</>}
              </span>
            ))}
          </span>
          {overdue.length > 0 && (
            <span className="block mt-1">There is {L(overdueL)} L on {overdue.length} overdue
            purchase order{overdue.length === 1 ? "" : "s"}, the oldest {Math.max(
              ...overdue.map((i) => i.days_late ?? 0))} days late.</span>
          )}
        </Alert>
      )}

      {/* One choice, driving everything below the summary table. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-txt-secondary mr-1">
          Looking at
        </span>
        {[...d.plants.map((p) => ({ id: p.plant, name: p.name })),
          { id: "", name: "All plants" }].map((o) => (
          <button key={o.id || "all"} type="button" onClick={() => setPlant(o.id)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border
                        transition-colors ${plant === o.id
                          ? "bg-navy text-white border-navy"
                          : "bg-bg-base text-txt-secondary border-border hover:border-gold hover:text-navy"}`}>
            {o.name}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader
          icon={Droplets} tone="gold" title="Fuel in the tank, by plant"
          subtitle={`SAP stock as on ${day(d.as_on)}. Usage is consumption only — machines, orders and transporters — averaged over ${d.burn_window_days} days; diesel sent to another plant is shown on its own. Cover counts only what is above dead stock.`}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead>
              <tr>
                <Th>Plant</Th>
                <Th className="text-right">In tank</Th>
                <Th className="text-right">Usable</Th>
                <Th className="text-right">Usage / day</Th>
                <Th className="text-right">Cover</Th>
                <Th>State</Th>
                <Th className="text-right">Sent out</Th>
                <Th>Supply</Th>
                <Th className="text-right">Overdue</Th>
              </tr>
            </thead>
            <tbody>
              {d.plants.map((p) => {
                const u = urgency(p.days_cover);
                const st = STATE[p.state];
                return (
                  <tr key={p.plant}
                      onClick={() => setPlant(p.plant)}
                      className={`border-t border-border-light cursor-pointer transition-colors
                                  ${p.plant === plant ? "bg-gold/10" : "hover:bg-bg-soft"}`}>
                    <Td>
                      <span className="font-semibold text-navy">{p.name}</span>
                      <span className="block text-[10.5px] text-txt-light">
                        plant {p.plant}
                      </span>
                    </Td>
                    <Td className="text-right tabular-nums font-semibold text-navy">
                      {L(p.fuel_l)} <span className="font-normal text-[10px] text-txt-light">L</span>
                      {p.held_l > 0 && (
                        <span className="block text-[10px] font-normal text-amber"
                              title="In SAP's books but not usable — quality inspection or suspense">
                          +{L(p.held_l)} held
                        </span>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums">
                      <span className={p.available_l > 0 ? "text-txt" : "text-rose font-semibold"}>
                        {L(p.available_l)}
                      </span>
                      {p.dead_stock_l > 0 && (
                        <span className="block text-[10px] text-txt-light">
                          after {L(p.dead_stock_l)} dead
                        </span>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums text-txt">
                      {p.burn_per_day_l ? L(p.burn_per_day_l) : "—"}
                    </Td>
                    <Td className="text-right">
                      {p.days_cover === null
                        ? <span className="text-txt-light text-[11.5px]">—</span>
                        : <Chip tone={u.tone} dot={false}>{p.days_cover} days</Chip>}
                      {p.dry_on && p.days_cover !== null && p.days_cover > 0 && (
                        <span className="block text-[10px] text-txt-light tabular-nums mt-0.5">
                          to {day(p.dry_on)}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Chip tone={st.tone} dot>{st.say}</Chip>
                      <span className="block text-[10px] text-txt-light mt-0.5 tabular-nums">
                        {p.levels_from_sap
                          ? `SAP min ${L(p.min_l)} · reorder ${L(p.reorder_l)} · max ${L(p.max_l)}`
                          : p.dormant ? "" : "no SAP levels set"}
                      </span>
                    </Td>
                    <Td className="text-right tabular-nums text-[11.5px]">
                      {p.transferred_out_l > 0
                        ? <span className="text-violet font-semibold"
                                title="Sent to another plant by stock transfer — not consumption">
                            {L(p.transferred_out_l)}
                          </span>
                        : <span className="text-txt-light">—</span>}
                    </Td>
                    <Td className="text-[11px] text-txt-muted">
                      {p.rhythm.avg_arrival_l
                        ? <>
                            <span className="block tabular-nums">
                              ~{L(p.rhythm.avg_arrival_l)} L every {p.rhythm.every_days ?? "?"} d
                            </span>
                            {p.rhythm.next_expected && (
                              <span className="block text-[10px] text-sky font-semibold">
                                next {day(p.rhythm.next_expected)}
                              </span>
                            )}
                          </>
                        : <span className="text-txt-light">none in 60 days</span>}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {p.inbound_overdue_l
                        ? <span className="text-rose font-semibold">{L(p.inbound_overdue_l)}</span>
                        : <span className="text-txt-light">—</span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-[11px] text-txt-muted leading-relaxed border-t border-border-light">
          <Database className="w-3 h-3 inline mr-1 -mt-0.5" />
          Read from SAP; nothing here is entered twice. &ldquo;Usable&rdquo; is
          the stock above the dead stock the pump cannot lift. &ldquo;Supply&rdquo;
          is how diesel has actually been arriving over {d.rhythm_window_days} days,
          measured from goods receipts. Purchase orders more than {d.stale_after_days} days
          past their date ({L(staleL)} L on {stale.length} lines) are paperwork
          to close, not fuel to expect, and are kept out of every warning.
        </p>
      </Card>

      {/* The calculator: what the diesel can carry, and what has to come. */}
      {lead && <FuelCalculator key={lead.plant} plant={lead.plant} />}

      {/* Where it went, and where it is going. */}
      {lead && proj.length > 0 && (
        <Card>
          <CardHeader
            icon={TrendingDown} tone="navy"
            title={`${lead.name} — what is left, and for how long`}
            subtitle="Thirty days of recorded stock, then two lines forward: supply keeps its usual rhythm, or nothing more arrives. Bars are fuel arriving."
          />
          <div className="px-3 pb-3">
            <FuelStockTrend
              movements={moves.filter((m) => m.plant === lead.plant)}
              projection={proj}
              burnPerDay={lead.burn_per_day_l}
              plantName={lead.name}
              deadStock={lead.dead_stock_l}
              everyDays={lead.rhythm.every_days} />
          </div>
        </Card>
      )}

      {/* Every day as a square. */}
      {cal && cal.days.length > 0 && (
        <Card>
          <CardHeader
            icon={CalendarDays} tone="violet"
            title={`${lead.name} — every day, and what it had left`}
            subtitle="Five weeks back and two forward. Each square is a day, coloured by how long the diesel above dead stock would last at the current rate. Hatched squares are forecast."
          />
          <div className="p-5 pt-3">
            <FuelCalendar days={cal.days} today={cal.today}
                          burnPerDay={cal.burn_per_day_l} />
          </div>
        </Card>
      )}

      {/* Every arrival and draw, newest first — the MIS of how the figure moved. */}
      {moves.length > 0 && (
        <Card>
          <CardHeader
            icon={ArrowDownUp} tone="sky" title="How the stock moved"
            subtitle="Only the days something happened. Consumption and diesel sent to another plant are kept apart — a transfer is not burn. Click an arrival to see its documents."
          />
          <div className="overflow-x-auto max-h-[320px] overflow-y-auto scrollbar-thin">
            <table className="w-full min-w-[640px]">
              <thead className="sticky top-0 bg-bg-soft">
                <tr>
                  <SortTh active={mvSort?.k === "day"} dir={mvSort?.d}
                          onSort={(w) => setMvSort(w ? { k: "day", d: w } : null)}>Day</SortTh>
                  <SortTh active={mvSort?.k === "name"} dir={mvSort?.d}
                          onSort={(w) => setMvSort(w ? { k: "name", d: w } : null)}>Plant</SortTh>
                  <SortTh align="right" active={mvSort?.k === "opening_l"} dir={mvSort?.d}
                          onSort={(w) => setMvSort(w ? { k: "opening_l", d: w } : null)}>Opening</SortTh>
                  <SortTh align="right" active={mvSort?.k === "received_l"} dir={mvSort?.d}
                          onSort={(w) => setMvSort(w ? { k: "received_l", d: w } : null)}>Arrived</SortTh>
                  <SortTh align="right" active={mvSort?.k === "issued_l"} dir={mvSort?.d}
                          onSort={(w) => setMvSort(w ? { k: "issued_l", d: w } : null)}>Consumed</SortTh>
                  <SortTh align="right" active={mvSort?.k === "transferred_out_l"} dir={mvSort?.d}
                          onSort={(w) => setMvSort(w ? { k: "transferred_out_l", d: w } : null)}>Sent out</SortTh>
                  <SortTh align="right" active={mvSort?.k === "closing_l"} dir={mvSort?.d}
                          onSort={(w) => setMvSort(w ? { k: "closing_l", d: w } : null)}>Closing</SortTh>
                </tr>
              </thead>
              <tbody>
                {shownMoves.map((m, n) => (
                  <tr key={`${m.day}-${m.plant}-${n}`}
                      className={`border-t border-border-light ${
                        m.received_l > 0 ? "bg-sky-bg/40" : ""}`}>
                    <Td className="text-[11.5px] tabular-nums">{day(m.day)}</Td>
                    <Td className="text-[11.5px] text-txt">{m.name}</Td>
                    <Td className="text-right tabular-nums text-txt-muted text-[11.5px]">
                      {L(m.opening_l)}
                    </Td>
                    <Td className="text-right tabular-nums text-[11.5px]">
                      {m.received_l > 0
                        ? <button type="button"
                                  onClick={() => void openArrival(m.plant, m.day)}
                                  title="Where did this come from?"
                                  className="font-semibold text-sky underline
                                             underline-offset-2 hover:text-navy">
                            +{L(m.received_l)}
                          </button>
                        : <span className="text-txt-light">—</span>}
                    </Td>
                    <Td className="text-right tabular-nums text-[11.5px] text-txt">
                      {m.issued_l > 0 ? `−${L(m.issued_l)}` : "—"}
                    </Td>
                    <Td className="text-right tabular-nums text-[11.5px]">
                      {m.transferred_out_l > 0
                        ? <span className="text-violet">→ {L(m.transferred_out_l)}</span>
                        : <span className="text-txt-light">—</span>}
                    </Td>
                    <Td className="text-right tabular-nums text-[11.5px] font-semibold text-navy">
                      {L(m.closing_l)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Each plant's materials, because a plant total hides a dry tank beside
          a full one. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {d.plants.filter((p) => p.materials.length > 0).map((p) => (
          <Card key={p.plant}>
            <CardHeader title={p.name} icon={Droplets} tone="sky" subtitleOnIcon
                        subtitle={`${p.materials.length} material${p.materials.length === 1 ? "" : "s"} held here.`} />
            <div className="divide-y divide-border-light">
              {p.materials.map((m) => (
                <div key={m.material} className="px-5 py-2.5 flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-navy truncate">
                      {m.description}
                    </span>
                    <span className="block text-[10.5px] text-txt-light">
                      {m.material}
                      {!m.is_fuel && " · a lubricant, not counted as fuel"}
                      {m.is_fuel && p.dormant && " · nothing drawn in the window"}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[12.5px] font-semibold tabular-nums text-navy">
                      {m.closing_l.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      <span className="text-[10px] font-normal text-txt-light"> {m.unit}</span>
                    </span>
                    {m.is_fuel && (m.reorder_l || m.max_l) ? (
                      <span className="block text-[10.5px] text-txt-light tabular-nums">
                        reorder {L(m.reorder_l)} · max {L(m.max_l)}
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* Where a delivery came from — as much as SAP will say. */}
      {arrival && (
        <Dialog open bare width={620} tone="info"
                title={`${L(arrival.received_l)} L arrived at ${arrival.name}`}
                ariaLabel="Arrival detail"
                confirmLabel="Close" cancelLabel="Back"
                onConfirm={() => setArrival(null)} onCancel={() => setArrival(null)}>
          <p className="text-[12px] text-txt-light -mt-1 mb-3">
            {new Date(arrival.day + "T00:00:00").toLocaleDateString("en-IN",
              { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
          </p>

          <div className="space-y-3">
            {arrival.receipts.length === 0 ? (
              <Alert tone="info">
                No goods receipt is posted in SAP for this day yet. Receipts are
                sometimes posted a day or two after the tanker is unloaded.
              </Alert>
            ) : (
              <div className="rounded-xl border border-border-light divide-y divide-border-light">
                {arrival.receipts.map((r, n) => (
                  <div key={`${r.po}-${n}`} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[12px] font-semibold text-navy">
                            {r.po ?? "no order"}
                          </span>
                          {r.is_transfer
                            ? <Chip tone="violet" dot={false}>transfer between plants</Chip>
                            : <Chip tone="sky" dot={false}>purchase</Chip>}
                        </span>
                        <span className="block text-[11.5px] text-txt truncate mt-0.5">
                          {r.vendor ?? r.header ?? r.description}
                        </span>
                        {r.header && r.vendor && (
                          <span className="block text-[10.5px] text-txt-light truncate">{r.header}</span>
                        )}
                      </span>
                      <span className="text-right shrink-0">
                        <span className="block text-[13px] font-semibold tabular-nums text-sky">
                          +{L(r.qty_l)} L
                        </span>
                        {r.gate_in && (
                          <span className="block text-[10.5px] text-txt-muted tabular-nums">
                            gate in {r.gate_in}
                          </span>
                        )}
                      </span>
                    </div>
                    {r.challan_l !== null && (
                      <p className="mt-1.5 text-[10.5px] text-txt-muted tabular-nums">
                        Challan {L(r.challan_l)} L · accepted {L(r.qty_l)} L
                        {r.short_l !== null && Math.abs(r.short_l) >= 1
                          ? <span className="text-rose font-semibold"> · {L(r.short_l)} L short</span>
                          : <span className="text-emerald"> · as billed</span>}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {arrival.rate_per_l !== null && (
              <p className="text-[11px] text-txt-muted">
                Booked at ₹{arrival.rate_per_l.toFixed(2)} a litre.
              </p>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
