"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { InsightsResponse } from "@/types";

/**
 * AI insights over Server-Sent Events, with the plain request as a fallback.
 *
 * WHY STREAM. The job is two long phases: building the prompt from the database,
 * then generating. Measured on this data the first has run anywhere from 10 to
 * 106 seconds depending on how loaded the shared MySQL is, and the second takes
 * about 24. No fixed request timeout survives that spread — the old 25s ceiling
 * failed constantly, and 90s would still have failed the 106s run. Streaming
 * keeps bytes moving throughout, so nothing in the chain ever sees an idle
 * connection to time out, whatever the load.
 *
 * WHY A FALLBACK. SSE can be defeated by a proxy that buffers, and this one
 * travels through Next's rewrite before nginx. If the stream produces no event
 * at all, the hook quietly re-runs the ordinary request rather than showing the
 * user a failure that is really a transport problem.
 *
 * The returned shape deliberately mirrors the react-query hook it replaces, so
 * the section component did not have to be rewritten around it.
 */
export type InsightsPhase = "idle" | "gathering" | "generating" | "done" | "error";

/** Sections as they arrive — the same keys the finished response carries. */
type PartialSections = Partial<
  Pick<
    InsightsResponse,
    | "reality_check_narrative"
    | "dewatering_observations"
    | "equipment_cob_status"
    | "stock_despatch_summary"
    | "key_risks_and_actions"
    | "shift_snapshot"
  >
>;

export interface InsightsStream {
  data: InsightsResponse | null;
  /** Populated while generating, before `data` exists. */
  partial: PartialSections | null;
  phase: InsightsPhase;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: { response?: { data?: { detail?: string } } } | null;
  detail: string | null;
  refetch: () => void;
}

// Nothing at all within this long means the transport is wrong, not slow: the
// server sends a status event immediately and a keep-alive every 5 seconds.
const SILENCE_BEFORE_FALLBACK_MS = 20_000;

export function useInsightsStream(enabled = true): InsightsStream {
  const { apiFrom, apiTo } = useDateFilter();
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [partial, setPartial] = useState<PartialSections | null>(null);
  const [phase, setPhase] = useState<InsightsPhase>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const esRef = useRef<EventSource | null>(null);
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sawEvent = useRef(false);

  const close = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    if (silence.current) clearTimeout(silence.current);
    silence.current = null;
  }, []);

  useEffect(() => {
    if (!enabled || !apiFrom || !apiTo) return;

    let cancelled = false;
    sawEvent.current = false;
    setData(null);
    setPartial(null);
    setDetail(null);
    setPhase("gathering");

    // The plain endpoint, used when the stream cannot get through.
    const fallback = async (why: string) => {
      if (cancelled) return;
      close();
      try {
        const res = await api.get("/insights/generate", {
          params: { from_date: apiFrom, to_date: apiTo, force_refresh: nonce > 0 },
          timeout: 300000,
        });
        if (cancelled) return;
        setData(res.data);
        setPhase("done");
      } catch (e) {
        if (cancelled) return;
        const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setDetail(d ?? why);
        setPhase("error");
      }
    };

    const qs = new URLSearchParams({ from_date: apiFrom, to_date: apiTo });
    if (nonce > 0) qs.set("force_refresh", "true");
    const es = new EventSource(`/api/insights/generate/stream?${qs.toString()}`);
    esRef.current = es;

    const armSilence = () => {
      if (silence.current) clearTimeout(silence.current);
      silence.current = setTimeout(() => {
        if (!sawEvent.current) fallback("The insights stream produced no response.");
      }, SILENCE_BEFORE_FALLBACK_MS);
    };
    armSilence();

    es.addEventListener("status", (e) => {
      sawEvent.current = true;
      armSilence();
      try {
        const { phase: p } = JSON.parse((e as MessageEvent).data);
        if (!cancelled && (p === "gathering" || p === "generating")) setPhase(p);
      } catch { /* a malformed frame must not kill the stream */ }
    });

    es.addEventListener("sections", (e) => {
      sawEvent.current = true;
      armSilence();
      try {
        const sec = JSON.parse((e as MessageEvent).data) as PartialSections;
        if (!cancelled) setPartial(sec);
      } catch { /* ignore and keep reading */ }
    });

    es.addEventListener("done", (e) => {
      sawEvent.current = true;
      try {
        const payload = JSON.parse((e as MessageEvent).data) as InsightsResponse;
        if (!cancelled) {
          setData(payload);
          setPartial(null);
          setPhase("done");
        }
      } catch {
        if (!cancelled) fallback("The completed insights could not be read.");
        return;
      }
      close();
    });

    es.addEventListener("error_event", () => { /* reserved */ });

    es.addEventListener("error", (e) => {
      // Two very different things arrive here: our own `error` event carrying a
      // classified message, and the browser's transport error, which has none.
      const raw = (e as MessageEvent).data;
      if (raw) {
        sawEvent.current = true;
        try {
          const { detail: d } = JSON.parse(raw);
          if (!cancelled) {
            setDetail(d ?? "The AI service reported a failure.");
            setPhase("error");
          }
        } catch {
          if (!cancelled) setPhase("error");
        }
        close();
        return;
      }
      // Transport-level. If we already have the answer the close is benign.
      if (cancelled) return;
      if (data || phase === "done") {
        close();
        return;
      }
      fallback("Lost the connection to the insights stream.");
    });

    return () => {
      cancelled = true;
      close();
    };
    // `data`/`phase` are read inside the handler but must not re-open the
    // stream; the effect keys only on what actually identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, apiFrom, apiTo, nonce, close]);

  return {
    data,
    partial,
    phase,
    isLoading: phase === "gathering" || phase === "generating",
    isFetching: phase === "gathering" || phase === "generating",
    isError: phase === "error",
    error: detail ? { response: { data: { detail } } } : null,
    detail,
    refetch: () => setNonce((n) => n + 1),
  };
}
