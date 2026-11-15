"use client";

/**
 * The tablet app: the version to install, a way to put it on a phone, and the
 * history of every version and what changed in it.
 *
 * Asked for on 16 Nov: "upload, download the app from the dashboard itself,
 * just after cab stickers, and keep the app's history -- what we are
 * changing". Until now a build went from a laptop to a tablet over a cable,
 * and what was in it was written nowhere anyone at the mine would look.
 *
 * Downloading is for anyone who can see HOTO; publishing, making an older
 * version current and withdrawing one are for HOTO admins, and the server
 * checks that again. The version and build of an upload are read from the
 * APK itself, never typed -- see backend/app/services/hoto_app.py.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Ban, Check, Download, FileUp, History, Loader2, Pencil, Smartphone, Star,
} from "lucide-react";
import QRCode from "qrcode";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import Explainer from "@/components/hoto/Explainer";

interface Release {
  id: string;
  version: string;
  build: number;
  file_name: string;
  size_bytes: number;
  sha256: string;
  notes: string;
  uploaded_by: string;
  uploaded_at: string;
  withdrawn: boolean;
  is_current: boolean;
  events: { at: string; by: string; what: string }[];
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
const problemsOf = (e: any, fallback: string) =>
  e?.response?.data?.detail?.problems?.join(" ")
  ?? e?.response?.data?.detail?.message ?? e?.response?.data?.detail ?? fallback;

export default function HotoAppSection() {
  const isAdmin = useAuth((s) => s.can)("hoto.admin");
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/hoto/app/releases");
      setReleases(r.data.releases);
      setError(null);
    } catch (e: any) {
      setError(problemsOf(e, "Could not load the app versions."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const current = releases.find((r) => r.is_current) ?? null;
  const done = async (m: string) => { setNotice(m); await load(); };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Smartphone className="h-5 w-5" /> Tablet app
          <Explainer>
            The HOTO app for tablets and phones. Install the current version
            from here; every version is kept below with what changed in it.
            A phone without a dashboard login can scan the code to download.
          </Explainer>
        </h1>
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

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : current ? (
        <CurrentCard r={current} />
      ) : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No version has been published yet.{isAdmin ? " Upload the first one below." : ""}
        </p>
      )}

      {isAdmin && <Upload onDone={done} onError={setError} />}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          <History className="h-4 w-4" /> Version history ({releases.length})
        </h2>
        {releases.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ol className="space-y-3">
            {releases.map((r) => (
              <HistoryRow key={r.id} r={r} isAdmin={isAdmin} onDone={done} onError={setError} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** The version to install: download here, or scan on the phone. */
function CurrentCard({ r }: { r: Release }) {
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const makeLink = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/hoto/app/releases/${r.id}/link`);
      const url = window.location.origin + res.data.path;
      setLink({ url, expires_at: res.data.expires_at });
      setQr(await QRCode.toDataURL(url, { margin: 1, width: 240 }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border-2 border-emerald-300 bg-emerald-50/50 p-4 dark:border-emerald-800 dark:bg-emerald-950/20">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
            Current version
          </div>
          <div className="text-2xl font-semibold">
            {r.version} <span className="text-base font-normal text-muted-foreground">build {r.build}</span>
          </div>
          <div className="text-sm text-muted-foreground">
            {when(r.uploaded_at)} · {mb(r.size_bytes)} · uploaded by {r.uploaded_by}
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <a href={`/api/hoto/app/releases/${r.id}/download`}
               className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
              <Download className="h-4 w-4" /> Download {r.file_name}
            </a>
            <button onClick={() => void makeLink()} disabled={busy}
                    className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
              Install on a phone
            </button>
          </div>
          <p className="max-w-xl pt-2 text-xs text-muted-foreground">
            A phone that already has the app keeps its data: install over it. Android asks to
            allow installing from this browser the first time.
          </p>
        </div>
        {qr && link && (
          <div className="space-y-1 text-center">
            <img src={qr} alt={`QR code to download HOTO ${r.version}`}
                 className="mx-auto h-48 w-48 rounded-md border bg-white p-1" />
            <p className="text-xs text-muted-foreground">
              Scan on the phone · works until {when(link.expires_at)}
            </p>
            <p className="text-[11px] text-muted-foreground">The phone must be on the office network.</p>
          </div>
        )}
      </div>
    </section>
  );
}

/** Publish a new version. What changed is required. */
function Upload({ onDone, onError }: { onDone: (m: string) => Promise<void>; onError: (m: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const ready = !!file && notes.trim().length >= 10;

  const send = async () => {
    if (!file) return;
    setBusy(true);
    setPct(0);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("notes", notes.trim());
      const r = await api.post("/hoto/admin/app/releases", form, {
        onUploadProgress: (e) => setPct(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
      });
      setFile(null);
      setNotes("");
      if (input.current) input.current.value = "";
      await onDone(`Version ${r.data.version} (build ${r.data.build}) is published and current.`);
    } catch (e: any) {
      onError(problemsOf(e, "The upload did not work."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-md border p-4">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
        <FileUp className="h-4 w-4" /> Publish a new version
      </h2>
      <p className="text-sm text-muted-foreground">
        The version and build number are read from the APK. Each new version needs a higher
        build: raise <span className="font-mono">version</span> and{" "}
        <span className="font-mono">versionCode</span> in <span className="font-mono">mobile/app.json</span> before building.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-sm font-medium" htmlFor="apk-file">APK file</label>
          <input id="apk-file" ref={input} type="file" accept=".apk,application/vnd.android.package-archive"
                 onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                 className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-2 file:text-sm" />
          {file && <p className="text-xs text-muted-foreground">{file.name} · {mb(file.size)}</p>}
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium" htmlFor="apk-notes">What changed in this version</label>
          <textarea id="apk-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={5}
                    maxLength={5000}
                    placeholder={"- Pairing code to allow a new device\n- Whose device it is\n- Photos kept where Android cannot clear them"}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
        </div>
      </div>
      <button disabled={!ready || busy} onClick={() => void send()}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
        {busy ? `Uploading… ${pct}%` : !file ? "Choose the APK first"
          : notes.trim().length < 10 ? "Say what changed" : "Publish this version"}
      </button>
    </section>
  );
}

/** One version in the history: what changed, who, when, and what was done to it since. */
function HistoryRow({ r, isAdmin, onDone, onError }: {
  r: Release; isAdmin: boolean; onDone: (m: string) => Promise<void>; onError: (m: string) => void;
}) {
  const [mode, setMode] = useState<null | "notes" | "withdraw">(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const post = async (path: string, body: object | undefined, message: string) => {
    setBusy(true);
    try {
      await api.post(`/hoto/admin/app/releases/${r.id}/${path}`, body);
      setMode(null);
      setText("");
      await onDone(message);
    } catch (e: any) {
      onError(problemsOf(e, "That did not work."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`rounded-md border p-4 ${r.withdrawn ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">{r.version}</span>
            <span className="text-sm text-muted-foreground">build {r.build}</span>
            {r.is_current && (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">
                <Check className="h-3 w-3" /> current
              </span>
            )}
            {r.withdrawn && (
              <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900 dark:bg-red-900/40 dark:text-red-200">
                withdrawn
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {when(r.uploaded_at)} · {r.uploaded_by} · {mb(r.size_bytes)} ·{" "}
            <span className="font-mono" title={r.sha256}>sha256 {r.sha256.slice(0, 12)}…</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(!r.withdrawn || isAdmin) && (
            <a href={`/api/hoto/app/releases/${r.id}/download`}
               className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
              <Download className="h-3.5 w-3.5" /> Download
            </a>
          )}
          {isAdmin && !r.is_current && !r.withdrawn && (
            <button disabled={busy} onClick={() => void post("current", undefined, `${r.version} is now the current version.`)}
                    className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
              <Star className="h-3.5 w-3.5" /> Make current
            </button>
          )}
          {isAdmin && (
            <button onClick={() => { setMode("notes"); setText(r.notes); }}
                    className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
              <Pencil className="h-3.5 w-3.5" /> Edit notes
            </button>
          )}
          {isAdmin && !r.withdrawn && (
            <button onClick={() => { setMode("withdraw"); setText(""); }}
                    className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-800 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40">
              <Ban className="h-3.5 w-3.5" /> Withdraw
            </button>
          )}
        </div>
      </div>

      {mode === null ? (
        <p className="mt-2 whitespace-pre-line text-sm">{r.notes}</p>
      ) : (
        <div className="mt-2 space-y-2">
          <label className="block text-sm font-medium" htmlFor={`rel-${r.id}`}>
            {mode === "notes" ? "What changed in this version" : "Why it is being withdrawn — kept in the history"}
          </label>
          <textarea id={`rel-${r.id}`} value={text} onChange={(e) => setText(e.target.value)}
                    rows={mode === "notes" ? 5 : 2} maxLength={5000}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button disabled={busy || !text.trim()}
                    onClick={() => void (mode === "notes"
                      ? post("notes", { notes: text }, `Notes for ${r.version} saved.`)
                      : post("withdraw", { reason: text }, `${r.version} is withdrawn.`))}
                    className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${
                      mode === "notes" ? "bg-slate-900 dark:bg-slate-100 dark:text-slate-900" : "bg-red-700"}`}>
              {mode === "notes" ? "Save" : `Withdraw ${r.version}`}
            </button>
            <button onClick={() => setMode(null)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Cancel
            </button>
          </div>
        </div>
      )}

      {r.events.length > 1 && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">What has happened to it ({r.events.length})</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {r.events.map((ev, i) => <li key={i}>{when(ev.at)} · {ev.by} · {ev.what}</li>)}
          </ul>
        </details>
      )}
    </li>
  );
}
