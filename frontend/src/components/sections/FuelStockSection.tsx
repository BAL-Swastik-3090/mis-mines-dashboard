"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDownUp, CalendarDays, Database, Droplets,
         Loader2, TrendingDown, Truck } from "lucide-react";
import api from "@/lib/api";
import { Alert, Button, Card, CardHeader, Chip, SortTh, sortRows, Td, Th }
  from "@/components/minehub/ui";
import Dialog from "@/components/minehub/Dialog";
import FuelStockTrend from "@/components/charts/FuelStockTrend";
import FuelCalendar from "@/components/charts/FuelCalendar";

/**
 * Diesel at every plant: what is standing, how long it lasts, what is owed.
 *
 * READ FROM SAP, WRITTEN NOWHERE. Stock is entered in SAP against purchase
 * orders and cost centres, and keying the same delivery into this platform as
 * well would give two systems one fact to disagree about. So nothing on this
 * screen is editable and the platform's own fuel_receipt table stays empty on
 * purpose.
 *
 * What SAP cannot answer is which machine the diesel went into — it knows
 * 82,151 litres left the tank at Kaliapani in thirty days, not that an
 * excavator took them. That belongs to the nozzle, on the Fuel Control tab,
 * and the two are meant to be compared rather than merged.
 */
interface Material {
  material: string; description: string; unit: string;
  closing_l: number; value: number; is_fuel: boolean;
  burn_per_day_l: number; days_cover: number | null; dry_on: string | null;
  inbound_overdue_l: number; inbound_stale_l: number;
  inbound_open_l: number; dormant: boolean;
}
interface Plant {
  plant: string; name: string; materials: Material[];
  fuel_l: number; fuel_value: number; burn_per_day_l: number;
  days_cover: number | null;
  inbound_overdue_l: number; inbound_stale_l: number; inbound_open_l: number;
}
interface Inbound {
  po: string; plant: string; vendor: string | null; material: string;
  pending_l: number; unit: string; due_on: string | null;
  days_late: number | null; overdue: boolean; stale: boolean;
}
interface Stock {
  as_on: string | null; stale_days: number | null; burn_window_days: number;
  stale_after_days: number; plants: Plant[]; inbound: Inbound[];
}
interface Movement {
  day: string; plant: string; name: string;
  opening_l: number; received_l: number; issued_l: number; closing_l: number;
}
interface Projected { day: string; litres: number; arriving_l: number; dry: boolean }
interface Arrival {
  plant: string; name: string; day: string; received_l: number;
  materials: { material: string; description: string; received_l: number;
               received_value: number; rate_per_l: number | null;
               opening_l: number; closing_l: number }[];
  elsewhere: { plant: string; name: string; received_l: number; issued_l: number }[];
  purchase_receipts: { po: string; vendor: string | null; material: string;
                       qty_l: number; doc: string | null }[];
  possible_transfer_from: string[];
  traced: boolean;
}
interface CalDay {
  day: string; actual: boolean; closing_l: number;
  issued_l: number | null; received_l: number;
  days_cover: number | null; dry?: boolean;
}
type Way = "asc" | "desc";

const L = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const day = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN",
        { day: "2-digit", month: "short" }) : "—";

/** How urgent a cover figure is. Two days is a day's warning, which on a
 *  tanker lead time of its own is no warning at all. */
function urgency(days: number | null): { tone: "rose" | "amber" | "emerald" | "slate"; say: string } {
  if (days === null) return { tone: "slate", say: "nothing drawn" };
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
  const [poSort, setPoSort] = useState<{ k: keyof Inbound; d: Way } | null>(null);
  /* Live first: an order 1,316 days late is not a delivery anybody is
   * waiting for, and listing it among the three that are hides them. */
  const [showStale, setShowStale] = useState(false);
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

  const critical = d.plants.filter((p) => p.days_cover !== null && p.days_cover < 3);
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
  const poRows = sortRows(
    d.inbound.filter((i) => (!plant || i.plant === plant)
                            && (showStale ? i.stale : !i.stale)),
    poSort?.k ?? null, poSort?.d ?? null);

  return (
    <div className="space-y-4">
      {/* The thing that needs doing today, before the tables that explain it. */}
      {critical.length > 0 && (
        <Alert tone="error">
          <strong>
            {critical.map((p) => `${p.name} has ${p.days_cover} days of diesel`)
                     .join("; ")}.
          </strong>{" "}
          {overdue.length > 0 && (
            <>There is {L(overdueL)} L on {overdue.length} overdue purchase
            order{overdue.length === 1 ? "" : "s"}, the oldest {Math.max(
              ...overdue.map((i) => i.days_late ?? 0))} days late. </>
          )}
          SAP carries no safety stock on these materials, so nothing there
          raises this on its own.
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
          subtitle={`From SAP stock as on ${day(d.as_on)}. Burn is the average over the last ${d.burn_window_days} days — issues are posted in batches, so a single day means nothing.`}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr>
                <Th>Plant</Th>
                <Th className="text-right">In tank</Th>
                <Th className="text-right">Burn / day</Th>
                <Th className="text-right">Cover</Th>
                <Th className="text-right">Runs dry</Th>
                <Th className="text-right">Overdue</Th>
                <Th className="text-right">Stale</Th>
                <Th className="text-right">On order</Th>
              </tr>
            </thead>
            <tbody>
              {d.plants.map((p) => {
                const u = urgency(p.days_cover);
                const dry = p.materials.find((m) => m.dry_on)?.dry_on ?? null;
                return (
                  <tr key={p.plant}
                      onClick={() => setPlant(p.plant)}
                      className={`border-t border-border-light cursor-pointer
                                  ${p.plant === plant ? "bg-gold/10" : "hover:bg-bg-soft"}`}>
                    <Td>
                      <span className="font-semibold text-navy">{p.name}</span>
                      <span className="block text-[10.5px] text-txt-light">
                        plant {p.plant}
                      </span>
                    </Td>
                    <Td className="text-right tabular-nums font-semibold text-navy">
                      {L(p.fuel_l)} <span className="font-normal text-[10px] text-txt-light">L</span>
                    </Td>
                    <Td className="text-right tabular-nums text-txt">
                      {p.burn_per_day_l ? L(p.burn_per_day_l) : "—"}
                    </Td>
                    <Td className="text-right">
                      {p.days_cover === null
                        ? <span className="text-txt-light text-[11.5px]">dormant</span>
                        : <Chip tone={u.tone} dot={false}>{p.days_cover} days</Chip>}
                    </Td>
                    <Td className="text-right text-[11.5px] tabular-nums text-txt-muted">
                      {day(dry)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {p.inbound_overdue_l
                        ? <span className="text-rose font-semibold">{L(p.inbound_overdue_l)}</span>
                        : <span className="text-txt-light">—</span>}
                    </Td>
                    <Td className="text-right tabular-nums text-[11.5px]">
                      {p.inbound_stale_l
                        ? <span className="text-txt-light" title={`Past due by more than ${d.stale_after_days} days — paperwork to close, not fuel to expect`}>
                            {L(p.inbound_stale_l)}
                          </span>
                        : <span className="text-txt-light">—</span>}
                    </Td>
                    <Td className="text-right tabular-nums text-txt-muted">
                      {p.inbound_open_l ? L(p.inbound_open_l) : "—"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-[11px] text-txt-muted leading-relaxed border-t border-border-light">
          <Database className="w-3 h-3 inline mr-1 -mt-0.5" />
          Read from SAP; nothing here is entered twice. &ldquo;On order&rdquo;
          is mostly supply agreements running months ahead rather than a lorry
          on its way — a plant with three days of cover and 300,000 litres on
          order is entitled to diesel, not supplied with it. &ldquo;Stale&rdquo;
          is {L(staleL)} L on {stale.length} lines more than {d.stale_after_days} days
          past their date, the oldest due in February 2023: paperwork to close
          rather than fuel to expect, so it is kept out of the warning above.
        </p>
      </Card>

      {/* Where it went, and where it is going. */}
      {lead && proj.length > 0 && (
        <Card>
          <CardHeader
            icon={TrendingDown} tone="navy"
            title={`${lead.name} — what is left, and for how long`}
            subtitle={`Thirty days of recorded stock, then the same tank drawn forward at ${L(lead.burn_per_day_l)} L a day. Bars are fuel arriving — a tanker, or a transfer out of Sukinda, which SAP records as an issue there and a receipt here on the same day.`}
          />
          <div className="px-3 pb-3">
            <FuelStockTrend
              movements={moves.filter((m) => m.plant === lead.plant)}
              projection={proj}
              burnPerDay={lead.burn_per_day_l}
              plantName={lead.name} />
          </div>
        </Card>
      )}

      {/* Every day as a square. */}
      {cal && cal.days.length > 0 && (
        <Card>
          <CardHeader
            icon={CalendarDays} tone="violet"
            title={`${lead.name} — every day, and what it had left`}
            subtitle="Five weeks back and two forward. Each square is a day, coloured by how long the fuel would have lasted at the current rate."
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
            subtitle="Only the days something happened. Stock rises when fuel arrives and falls when it is drawn; a transfer between plants shows on both of them on the same day."
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
                          onSort={(w) => setMvSort(w ? { k: "issued_l", d: w } : null)}>Drawn</SortTh>
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
                      {m.is_fuel && m.dormant && " · nothing drawn in the window"}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[12.5px] font-semibold tabular-nums text-navy">
                      {m.closing_l.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      <span className="text-[10px] font-normal text-txt-light"> {m.unit}</span>
                    </span>
                    {m.is_fuel && m.days_cover !== null && (
                      <span className={`block text-[10.5px] font-semibold
                        ${m.days_cover < 3 ? "text-rose"
                          : m.days_cover < 7 ? "text-amber" : "text-emerald"}`}>
                        {m.days_cover} days at {L(m.burn_per_day_l)} L/day
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* What is owed, oldest first — the overdue ones are the actionable rows. */}
      <Card tone={overdue.length ? "rose" : undefined}>
        <CardHeader
          icon={overdue.length ? AlertTriangle : Truck}
          tone={overdue.length ? "rose" : "slate"}
          title={showStale
            ? `${stale.length} orders past closing — ${L(staleL)} L`
            : overdue.length
              ? `${overdue.length} deliveries overdue — ${L(overdueL)} L`
              : "Nothing overdue"}
          subtitle={showStale
            ? `More than ${d.stale_after_days} days past their date. These are not deliveries anybody is waiting for — they are lines somebody should close.`
            : "Still to be delivered against an open purchase order. Oldest first."}
          actions={
            /* The two were in one list, so three live orders sat among sixty
               dead ones and the heading counted them differently from the
               rows beneath it. */
            <Button size="sm" variant={showStale ? "secondary" : "ghost"}
                    onClick={() => setShowStale((v) => !v)}>
              {showStale ? "Show the live ones" : `Show ${stale.length} stale`}
            </Button>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <SortTh active={poSort?.k === "po"} dir={poSort?.d}
                        onSort={(w) => setPoSort(w ? { k: "po", d: w } : null)}>Order</SortTh>
                <SortTh active={poSort?.k === "plant"} dir={poSort?.d}
                        onSort={(w) => setPoSort(w ? { k: "plant", d: w } : null)}>Plant</SortTh>
                <SortTh active={poSort?.k === "vendor"} dir={poSort?.d}
                        onSort={(w) => setPoSort(w ? { k: "vendor", d: w } : null)}>Supplier</SortTh>
                <SortTh align="right" active={poSort?.k === "pending_l"} dir={poSort?.d}
                        onSort={(w) => setPoSort(w ? { k: "pending_l", d: w } : null)}>Still due</SortTh>
                <SortTh align="right" active={poSort?.k === "due_on"} dir={poSort?.d}
                        onSort={(w) => setPoSort(w ? { k: "due_on", d: w } : null)}>Due on</SortTh>
                <SortTh active={poSort?.k === "days_late"} dir={poSort?.d}
                        onSort={(w) => setPoSort(w ? { k: "days_late", d: w } : null)}>State</SortTh>
              </tr>
            </thead>
            <tbody>
              {poRows.length === 0 && (
                <tr><Td colSpan={6} className="text-center text-txt-muted py-8">
                  Nothing {showStale ? "past closing" : "on order"} here.
                </Td></tr>
              )}
              {poRows.map((i, n) => (
                <tr key={`${i.po}-${n}`} className="border-t border-border-light">
                  <Td className="font-mono text-[11.5px]">{i.po}</Td>
                  <Td className="text-[11.5px] text-txt-muted">{i.plant}</Td>
                  <Td className="text-[11.5px] text-txt truncate max-w-[200px]">
                    {i.vendor ?? "—"}
                  </Td>
                  <Td className="text-right tabular-nums font-semibold">
                    {L(i.pending_l)} <span className="text-[10px] font-normal text-txt-light">{i.unit}</span>
                  </Td>
                  <Td className="text-right text-[11.5px] tabular-nums">{day(i.due_on)}</Td>
                  <Td>
                    {i.stale
                      ? <Chip tone="slate" dot={false}>{i.days_late} days — close it</Chip>
                      : i.overdue
                        ? <Chip tone="rose" dot={false}>{i.days_late} days late</Chip>
                        : <Chip tone="slate" dot={false}>open</Chip>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

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
            <div className="rounded-xl border border-border-light divide-y divide-border-light">
              {arrival.materials.map((m) => (
                <div key={m.material} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-navy truncate">
                      {m.description}
                    </span>
                    <span className="block text-[10.5px] text-txt-light">
                      {m.material} · tank went {L(m.opening_l)} → {L(m.closing_l)} L
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[13px] font-semibold tabular-nums text-sky">
                      +{L(m.received_l)} L
                    </span>
                    {m.rate_per_l !== null && (
                      <span className="block text-[10.5px] text-txt-muted tabular-nums">
                        ₹{m.rate_per_l.toFixed(2)} a litre
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {/* The honest part: what SAP will and will not say about the source. */}
            {arrival.purchase_receipts.length > 0 ? (
              <div>
                <p className="text-[11px] font-semibold text-txt-secondary mb-1.5">
                  Booked against
                </p>
                <div className="rounded-xl border border-border-light divide-y divide-border-light">
                  {arrival.purchase_receipts.map((r, n) => (
                    <div key={`${r.po}-${n}`} className="px-4 py-2 flex items-center gap-3">
                      <span className="font-mono text-[11.5px] text-navy">{r.po}</span>
                      <span className="flex-1 text-[11.5px] text-txt truncate">
                        {r.vendor ?? "—"}
                      </span>
                      <span className="text-[11.5px] tabular-nums font-semibold">
                        {L(r.qty_l)} L
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Alert tone="info">
                No purchase order records a goods receipt for this fuel on this
                day. SAP&rsquo;s purchase-order feed stops updating goods
                receipts well before the stock feed does, so an arrival this
                recent usually cannot be traced to an order — it is not
                evidence that nothing was bought.
              </Alert>
            )}

            {arrival.possible_transfer_from.length > 0 && (
              <Alert tone="warning">
                {arrival.possible_transfer_from.join(" and ")} issued about the
                same quantity the same day, so this may be a transfer rather
                than a purchase. The sizes agreeing is evidence, not a transfer
                note.
              </Alert>
            )}

            <div>
              <p className="text-[11px] font-semibold text-txt-secondary mb-1.5">
                Everywhere else, the same day
              </p>
              <div className="rounded-xl bg-bg-soft divide-y divide-border-light">
                {arrival.elsewhere.length === 0 && (
                  <p className="px-4 py-2.5 text-[11.5px] text-txt-muted">
                    No other plant moved fuel that day.
                  </p>
                )}
                {arrival.elsewhere.map((e) => (
                  <div key={e.plant} className="px-4 py-2 flex items-center gap-3 text-[11.5px]">
                    <span className="flex-1 text-txt">{e.name}</span>
                    <span className="tabular-nums text-sky">
                      {e.received_l ? `+${L(e.received_l)}` : "—"}
                    </span>
                    <span className="tabular-nums text-txt-muted w-[90px] text-right">
                      {e.issued_l ? `−${L(e.issued_l)}` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
