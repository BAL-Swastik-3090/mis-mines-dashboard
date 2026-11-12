"use client";

/**
 * Devices — who is asking to join, what they are, and where they have been.
 *
 * ── THE WAITING LIST IS THE SCREEN ───────────────────────────────────────────
 * A device that has registered and is waiting is somebody standing in a yard
 * holding a phone that says "waiting to be allowed". That is the only state on
 * this screen with a person blocked behind it, so it is first, it is loud, and
 * it does not collapse. Everything else here is reference.
 *
 * ── APPROVAL SHOWS THE HARDWARE, NOT A CODE ──────────────────────────────────
 * The question an approver is actually answering is "is this the phone I just
 * handed to the shift in-charge" — so the make, the model, the Android version
 * and who asked are what the card leads with. A device code means nothing to
 * the person deciding; it is allocated by the server precisely so that nobody
 * has to invent one under pressure.
 *
 * ── NOBODY SEES A CREDENTIAL ─────────────────────────────────────────────────
 * Approving does not show a token, because there is nothing for a person to
 * carry: the device collects its own. A screen that displayed one would invite
 * it being read out over a phone, which is the whole failure this replaced.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BatteryCharging, BatteryMedium, Check, ChevronLeft, Clock, Loader2,
  MapPin, Plug, RefreshCw, Smartphone, X,
} from "lucide-react";
import api from "@/lib/api";

type Status = "PENDING" | "ACTIVE" | "SUSPENDED" | "REVOKED" | "REJECTED";

interface Device {
  device_id: number;
  device_code: string;
  label: string;
  profile: "COMPANY" | "PERSONAL";
  status: Status;
  plant_name: string | null;
  location_name: string | null;

  platform: string | null;
  os_version: string | null;
  manufacturer: string | null;
  model: string | null;
  app_version: string | null;
  build_number: string | null;

  requested_at: string | null;
  requested_by_name: string | null;
  requested_note: string | null;
  approved_by: string | null;
  approved_at: string | null;
  decided_reason: string | null;

  last_seen_at: string | null;
  last_sync_at: string | null;
  last_location_at: string | null;
  last_lat: number | string | null;
  last_lon: number | string | null;
  last_accuracy_m: number | string | null;
  last_battery_pct: number | null;
  last_is_charging: boolean | null;

  track_location: boolean;
  location_interval_s: number;
  awaiting_pickup: boolean;
  location_pings: number;

  sessions_filed: number;
  last_handover_at: string | null;
  revoked_at: string | null;
  remarks: string | null;
}

interface Fix {
  recorded_at: string;
  received_at: string;
  lat: number | string;
  lon: number | string;
  accuracy_m: number | string | null;
  speed_mps: number | string | null;
  battery_pct: number | null;
  is_charging: boolean | null;
  source: string;
}

const STATUS_STYLE: Record<Status, string> = {
  PENDING: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  ACTIVE: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
  SUSPENDED: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  REVOKED: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  REJECTED: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
};

const STATUS_WORD: Record<Status, string> = {
  PENDING: "waiting",
  ACTIVE: "allowed",
  SUSPENDED: "paused",
  REVOKED: "revoked",
  REJECTED: "turned down",
};

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
      })
    : "—";

/** "4 min ago" — the only form in which "last seen" is worth reading. */
const ago = (iso: string | null): string => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
};

const num = (v: number | string | null | undefined, dp = 6): string =>
  v === null || v === undefined ? "—" : Number(v).toFixed(dp);

/** What the hardware is, in the words written on the box. */
const hardware = (d: Device | { manufacturer: string | null; model: string | null; os_version: string | null; platform: string | null }): string => {
  const make = [d.manufacturer, d.model].filter(Boolean).join(" ");
  const os = d.os_version ? `${d.platform === "ios" ? "iOS" : "Android"} ${d.os_version}` : null;
  return [make || "unknown hardware", os].filter(Boolean).join(" · ");
};

/**
 * A device that was told to report its position and has stopped.
 *
 * ── WHY THIS IS THE ANSWER TO "NOBODY MAY TURN IT OFF" ───────────────────────
 * Android does not let an app stop a person uninstalling it or revoking a
 * permission, by design, and no amount of code here changes that — it needs
 * the device to be enrolled as company-owned (see docs/hoto-device-lockdown.md).
 * What this CAN do is make it loud. A tablet whose location was switched off in
 * the cab looks, on every other screen, exactly like one sitting in a shed with
 * no signal. Naming the difference is what turns "somebody disabled it" from
 * something discovered in a month into something seen the same shift.
 *
 * Three missed reports rather than one: a device in a pit misses a report
 * routinely, and crying wolf on the first is how a warning gets ignored.
 */
const MISSED_REPORTS_BEFORE_ALARM = 3;

function notReporting(d: Device): false | { minutes: number; never: boolean } {
  if (!d.track_location) return false;
  if (d.status !== "ACTIVE") return false;
  const graceMs = Math.max(d.location_interval_s, 60) * 1000 * MISSED_REPORTS_BEFORE_ALARM;
  if (!d.last_location_at) {
    // Never reported at all. Only an alarm once it has had time to: a device
    // approved a minute ago has not failed at anything yet.
    if (!d.approved_at) return false;
    const since = Date.now() - Date.parse(d.approved_at);
    return since > graceMs ? { minutes: Math.round(since / 60000), never: true } : false;
  }
  const since = Date.now() - Date.parse(d.last_location_at);
  return since > graceMs ? { minutes: Math.round(since / 60000), never: false } : false;
}

export default function HotoDevicesSection() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/hoto/admin/devices");
      setDevices(r.data.devices ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail?.message ?? "Could not load the device list.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // A device registers while somebody is looking at this screen, and the point
  // of the screen is that they do not have to be told to refresh it.
  useEffect(() => {
    const t = setInterval(() => { void load(); }, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const waiting = useMemo(() => devices.filter((d) => d.status === "PENDING"), [devices]);
  const rest = useMemo(() => devices.filter((d) => d.status !== "PENDING"), [devices]);
  const silent = useMemo(
    () => rest.map((d) => ({ d, why: notReporting(d) }))
             .filter((x): x is { d: Device; why: { minutes: number; never: boolean } } =>
               x.why !== false),
    [rest]);

  if (picked) {
    return (
      <DeviceDetail
        code={picked}
        onBack={() => { setPicked(null); void load(); }}
        onNotice={setNotice}
      />
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Devices</h1>
          <p className="text-sm text-muted-foreground">
            Phones and tablets allowed to capture handovers. A device registers
            itself from the app; nobody types a token into it.
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); void load(); }}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          {notice}
        </div>
      )}

      {/* ── waiting for a decision ───────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Waiting to be allowed{waiting.length > 0 ? ` (${waiting.length})` : ""}
        </h2>

        {waiting.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No device is waiting. When somebody installs the app and asks for
            access, it appears here within fifteen seconds.
          </p>
        ) : (
          waiting.map((d) => (
            <PendingCard key={d.device_id} d={d}
                         onDone={(msg) => { setNotice(msg); void load(); }}
                         onError={setError} />
          ))
        )}
      </section>

      {/* ── everything else ──────────────────────────────────────────────── */}
      {silent.length > 0 && (
        <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
          <h3 className="font-semibold text-red-900 dark:text-red-200">
            {silent.length} device{silent.length === 1 ? " has" : "s have"} stopped reporting position
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-red-900 dark:text-red-200">
            {silent.map(({ d, why }) => (
              <li key={d.device_id}>
                <strong>{d.device_code}</strong> ({d.label}) —{" "}
                {why.never
                  ? `has never sent a position, ${why.minutes} min since it was allowed`
                  : `nothing for ${why.minutes} min`}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-red-800 dark:text-red-300">
            Either it has no signal, or location was switched off on the device.
            Android cannot stop somebody doing that — see the lockdown note if
            these need to be company-managed.
          </p>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Devices ({rest.length})
        </h2>

        {loading && rest.length === 0 ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : rest.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No devices yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Device</th>
                  <th className="px-3 py-2">Hardware</th>
                  <th className="px-3 py-2">Last seen</th>
                  <th className="px-3 py-2">Where</th>
                  <th className="px-3 py-2 text-right">Handovers</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rest.map((d) => (
                  <tr key={d.device_id} className="border-t hover:bg-accent/40">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{d.device_code}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[d.status]}`}>
                          {STATUS_WORD[d.status]}
                        </span>
                        {d.awaiting_pickup && (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold text-sky-900 dark:bg-sky-900/40 dark:text-sky-200">
                            not collected yet
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{d.label}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {hardware(d)}
                      {d.app_version && <div>app {d.app_version}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {ago(d.last_seen_at)}
                      <div className="text-muted-foreground">{fmt(d.last_seen_at)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {d.last_location_at ? (
                        <>
                          <div className={`flex items-center gap-1 ${
                            notReporting(d) ? "font-semibold text-red-700 dark:text-red-300" : ""}`}>
                            <MapPin className="h-3 w-3" />
                            {ago(d.last_location_at)}
                            {notReporting(d) && " · not reporting"}
                          </div>
                          <Battery pct={d.last_battery_pct} charging={d.last_is_charging} />
                        </>
                      ) : d.track_location ? (
                        <span className={notReporting(d)
                          ? "font-semibold text-red-700 dark:text-red-300"
                          : "text-muted-foreground"}>
                          {notReporting(d) ? "not reporting" : "no fix yet"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">tracking off</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{d.sessions_filed}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => setPicked(d.device_code)}
                        className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Battery({ pct, charging }: { pct: number | null; charging: boolean | null }) {
  if (pct === null || pct === undefined) return null;
  const low = pct <= 20;
  return (
    <div className={`flex items-center gap-1 ${low ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>
      {charging ? <BatteryCharging className="h-3 w-3" /> : <BatteryMedium className="h-3 w-3" />}
      {pct}%{charging ? " charging" : ""}
    </div>
  );
}

/* ── the card an approver actually reads ──────────────────────────────────── */

function PendingCard({ d, onDone, onError }:
  { d: Device; onDone: (msg: string) => void; onError: (m: string) => void }) {
  const [code, setCode] = useState(d.device_code);
  const [label, setLabel] = useState(d.label);
  const [profile, setProfile] = useState<"COMPANY" | "PERSONAL">(d.profile);
  const [track, setTrack] = useState(true);
  const [interval, setIntervalS] = useState(300);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const act = async (what: "approve" | "reject") => {
    setBusy(true);
    try {
      if (what === "approve") {
        const r = await api.post(`/hoto/admin/devices/${d.device_code}/approve`, {
          device_code: code.trim().toUpperCase() === d.device_code ? null : code.trim(),
          label, profile, track_location: track, location_interval_s: interval,
        });
        onDone(r.data.note ?? `${r.data.device_code} is allowed.`);
      } else {
        await api.post(`/hoto/admin/devices/${d.device_code}/reject`, { reason });
        onDone(`${d.device_code} was turned down. The device will say why.`);
      }
    } catch (e: any) {
      const det = e?.response?.data?.detail;
      onError(det?.problems?.join(" ") ?? det?.message ?? "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 h-5 w-5 text-amber-700 dark:text-amber-300" />
          <div>
            <div className="text-base font-semibold">{hardware(d)}</div>
            <div className="text-sm">
              Asked for by <strong>{d.requested_by_name ?? "somebody"}</strong>
              {" · "}{ago(d.requested_at)}
            </div>
            {d.requested_note && (
              <div className="mt-1 text-sm text-muted-foreground">“{d.requested_note}”</div>
            )}
            <div className="mt-1 text-xs text-muted-foreground">
              Will be called {d.device_code}
              {d.app_version ? ` · app ${d.app_version}` : ""}
              {d.build_number ? ` (build ${d.build_number})` : ""}
            </div>
          </div>
        </div>
      </div>

      {!rejecting ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Call it">
              <input value={code} onChange={(e) => setCode(e.target.value)}
                     className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" />
            </Field>
            <Field label="Where it lives">
              <input value={label} onChange={(e) => setLabel(e.target.value)}
                     className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" />
            </Field>
            <Field label="Kind">
              <select value={profile}
                      onChange={(e) => setProfile(e.target.value as "COMPANY" | "PERSONAL")}
                      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm">
                <option value="COMPANY">Shared company device</option>
                <option value="PERSONAL">One person&apos;s own phone</option>
              </select>
            </Field>
            <Field label="Report where it is">
              <select
                value={track ? String(interval) : "off"}
                onChange={(e) => {
                  if (e.target.value === "off") { setTrack(false); return; }
                  setTrack(true); setIntervalS(Number(e.target.value));
                }}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="60">Every minute</option>
                <option value="300">Every 5 minutes</option>
                <option value="900">Every 15 minutes</option>
                <option value="3600">Every hour</option>
                <option value="off">Do not track this device</option>
              </select>
            </Field>
          </div>

          {profile === "PERSONAL" && track && (
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
              This is somebody&apos;s own phone and it will report its position
              around the clock. Make sure they have been told.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => void act("approve")}
                    className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Allow this device
            </button>
            <button disabled={busy} onClick={() => setRejecting(true)}
                    className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-accent">
              <X className="h-4 w-4" /> Turn it down
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Nothing needs to be typed into the device. It picks this up by itself,
            usually within a minute.
          </p>
        </>
      ) : (
        <div className="mt-4 space-y-2">
          <Field label="Why — the device shows this to whoever is holding it">
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
                   placeholder="This is a personal phone. Use the issued tablet."
                   className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" />
          </Field>
          <div className="flex gap-2">
            <button disabled={busy || !reason.trim()} onClick={() => void act("reject")}
                    className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
              Turn it down
            </button>
            <button onClick={() => setRejecting(false)}
                    className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

/* ── one device, and where it has been ────────────────────────────────────── */

function DeviceDetail({ code, onBack, onNotice }:
  { code: string; onBack: () => void; onNotice: (m: string) => void }) {
  const [data, setData] = useState<{ device: any; fixes: Fix[]; hours: number } | null>(null);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/hoto/admin/devices/${code}/track`, { params: { hours } });
      setData(r.data);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail?.message ?? "Could not load this device.");
    } finally {
      setLoading(false);
    }
  }, [code, hours]);

  useEffect(() => { void load(); }, [load]);

  const d = data?.device;
  const setTracking = async (on: boolean, every?: number) => {
    try {
      await api.post(`/hoto/admin/devices/${code}/tracking`, {
        track_location: on, location_interval_s: every ?? d?.location_interval_s,
      });
      onNotice(on ? `${code} will report where it is.` : `${code} has stopped reporting its position.`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail?.problems?.join(" ") ?? "That did not work.");
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> All devices
      </button>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      {d && (
        <>
          <header className="space-y-1">
            <h1 className="text-xl font-semibold">
              {d.device_code}{" "}
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[d.status as Status]}`}>
                {STATUS_WORD[d.status as Status]}
              </span>
            </h1>
            <p className="text-sm text-muted-foreground">
              {d.label} · {hardware(d)}
            </p>
          </header>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile title="Last seen" value={ago(d.last_seen_at)} sub={fmt(d.last_seen_at)} icon={Clock} />
            <Tile title="Last position" value={ago(d.last_location_at)}
                  sub={d.last_lat ? `${num(d.last_lat)}, ${num(d.last_lon)}` : "no fix yet"}
                  icon={MapPin} />
            <Tile title="Battery"
                  value={d.last_battery_pct === null ? "—" : `${d.last_battery_pct}%`}
                  sub={d.last_is_charging ? "on charge" : "not charging"} icon={Plug} />
            <Tile title="Reporting"
                  value={d.track_location ? `every ${Math.round(d.location_interval_s / 60)} min` : "off"}
                  sub={`${data?.fixes.length ?? 0} fixes in ${hours} h`} icon={Smartphone} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {d.track_location ? (
              <button onClick={() => void setTracking(false)}
                      className="rounded-md border px-3 py-2 text-sm hover:bg-accent">
                Stop reporting position
              </button>
            ) : (
              <button onClick={() => void setTracking(true, 300)}
                      className="rounded-md border px-3 py-2 text-sm hover:bg-accent">
                Report position every 5 minutes
              </button>
            )}
            {d.last_lat && (
              // Opens the map in the approver's own browser rather than
              // embedding one: a dashboard that silently calls a map provider
              // on every page load sends the mine's positions to it.
              <a
                href={`https://www.google.com/maps?q=${num(d.last_lat)},${num(d.last_lon)}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm hover:bg-accent"
              >
                <MapPin className="h-4 w-4" /> Show the last position on a map
              </a>
            )}
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}
                    className="rounded-md border bg-background px-2 py-2 text-sm">
              <option value={6}>Last 6 hours</option>
              <option value={24}>Last 24 hours</option>
              <option value={72}>Last 3 days</option>
              <option value={168}>Last week</option>
            </select>
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Where it has been
            </h2>
            {loading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (data?.fixes.length ?? 0) === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {d.track_location
                  ? "Nothing in this period. The device reports only when it has signal, and sends what it buffered when it gets some."
                  : "This device is not reporting its position."}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">When</th>
                      <th className="px-3 py-2">Position</th>
                      <th className="px-3 py-2 text-right">Accuracy</th>
                      <th className="px-3 py-2 text-right">Speed</th>
                      <th className="px-3 py-2 text-right">Battery</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.fixes.map((f, i) => (
                      <tr key={`${f.recorded_at}-${i}`} className="border-t">
                        <td className="px-3 py-2 text-xs">
                          {fmt(f.recorded_at)}
                          {/* Worth showing: a gap between these two is a device
                              that was out of signal, not a device that was idle. */}
                          {Math.abs(Date.parse(f.received_at) - Date.parse(f.recorded_at)) > 300_000 && (
                            <div className="text-muted-foreground">
                              arrived {ago(f.received_at)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs tabular-nums">
                          {num(f.lat)}, {num(f.lon)}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {f.accuracy_m ? `${num(f.accuracy_m, 0)} m` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {f.speed_mps ? `${(Number(f.speed_mps) * 3.6).toFixed(1)} km/h` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {f.battery_pct === null ? "—" : `${f.battery_pct}%`}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <a href={`https://www.google.com/maps?q=${num(f.lat)},${num(f.lon)}`}
                             target="_blank" rel="noreferrer"
                             className="text-xs text-sky-700 hover:underline dark:text-sky-300">
                            map
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ title, value, sub, icon: Icon }:
  { title: string; value: string; sub: string; icon: any }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
