"""Web search for the training-topic generator.

WHY THIS IS SEPARATE AND OFF BY DEFAULT. BAL-AI is on-premise so that prompts
never leave the BAL network. A web search sends a query out, which reopens that
door, so the door is narrow and visible:

  * Queries are built ONLY from generic failure vocabulary and national
    qualification titles — "excavator bucket side loading operator training".
    Incident text, machine numbers, operator names, costs and dates are never
    sent. build_queries() is the only place a query is constructed, so there is
    one place to audit.
  * Nothing happens without a key. No key, no search, and the caller carries on
    without web context rather than failing.
  * Results are advisory. They go into the prompt as background reading, and
    the model is told the mine's own incident data outranks them.

PROVIDERS. Tavily and Brave, because both return clean snippets from one call
and both have a free tier. Scraping a search engine was tried and rejected:
DuckDuckGo's keyless endpoints answer with a page containing no results, and
building on an interface designed to stop you is not a foundation.
"""
from __future__ import annotations

import logging
import re

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

TIMEOUT = 12.0
MAX_RESULTS = 4

# Anything that could identify the mine, a machine or a person is stripped
# before a query is built. Belt and braces — build_queries() already composes
# from a fixed vocabulary — but this catches a future caller passing raw text.
_BLOCKED = re.compile(
    r"\b(MAN[-\s]?\d+|EX[-\s]?\d+|TATA|ZAXIS|BAL|Balasore|Kaliapani|Sukinda|"
    r"MINEAUTO|Rs\.?\s?\d|₹)", re.I
)


def configured() -> bool:
    s = get_settings()
    return bool(s.search_api_key and s.search_provider)


def _safe(q: str) -> str:
    """Strip anything site- or asset-specific, then collapse to plain words."""
    q = _BLOCKED.sub(" ", q)
    q = re.sub(r"[^A-Za-z0-9 /&.-]", " ", q)
    return re.sub(r"\s+", " ", q).strip()


def build_queries(families: list[str], packs: list[str], limit: int = 3) -> list[str]:
    """The only place a web query is composed.

    One query per dominant failure group, phrased as a training question and
    anchored to the national qualification vocabulary, so results come back
    about curricula rather than about spare parts.
    """
    out: list[str] = []
    for fam in families[:limit]:
        base = _safe(f"{fam} mining equipment operator training course syllabus")
        if base:
            out.append(base)
    for p in packs[:1]:
        base = _safe(f"{p} NSQF qualification pack national occupational standards")
        if base:
            out.append(base)
    return out[: limit + 1]


async def _tavily(client: httpx.AsyncClient, key: str, q: str) -> list[dict]:
    r = await client.post(
        "https://api.tavily.com/search",
        json={"api_key": key, "query": q, "max_results": MAX_RESULTS,
              "search_depth": "basic", "include_answer": False},
    )
    r.raise_for_status()
    return [
        {"title": x.get("title", ""), "snippet": (x.get("content") or "")[:400],
         "url": x.get("url", "")}
        for x in (r.json().get("results") or [])
    ]


async def _brave(client: httpx.AsyncClient, key: str, q: str) -> list[dict]:
    r = await client.get(
        "https://api.search.brave.com/res/v1/web/search",
        params={"q": q, "count": MAX_RESULTS},
        headers={"X-Subscription-Token": key, "Accept": "application/json"},
    )
    r.raise_for_status()
    return [
        {"title": x.get("title", ""),
         "snippet": re.sub(r"<[^>]+>", "", x.get("description") or "")[:400],
         "url": x.get("url", "")}
        for x in ((r.json().get("web") or {}).get("results") or [])
    ]


async def search(queries: list[str]) -> list[dict]:
    """Run the queries. Returns [] on any failure — this is never fatal."""
    s = get_settings()
    if not configured() or not queries:
        return []

    provider = (s.search_provider or "").lower()
    fn = {"tavily": _tavily, "brave": _brave}.get(provider)
    if fn is None:
        logger.warning("unknown SEARCH_PROVIDER %r — skipping web search", provider)
        return []

    out: list[dict] = []
    seen: set[str] = set()
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            for q in queries:
                try:
                    for hit in await fn(client, s.search_api_key, q):
                        url = hit.get("url") or ""
                        if url and url not in seen and hit.get("snippet"):
                            seen.add(url)
                            hit["query"] = q
                            out.append(hit)
                except Exception as exc:
                    # One bad query must not lose the others.
                    logger.warning("web search failed for %r: %s", q, exc)
    except Exception as exc:
        logger.warning("web search unavailable: %s", exc)
    return out


def as_context(hits: list[dict], limit: int = 8) -> str:
    """Search results as prompt text, labelled so the model ranks them last."""
    if not hits:
        return ""
    lines = [
        "PUBLIC TRAINING MATERIAL found on the web. This is BACKGROUND ONLY. It",
        "describes how the industry teaches these subjects. Where it disagrees",
        "with the mine's own incident data above, the incident data is correct.",
        "Do not cite these sources as evidence for a topic; the incidents are the",
        "evidence.",
        "",
    ]
    for h in hits[:limit]:
        lines.append(f"  - {h['title']}: {h['snippet']}")
    return "\n".join(lines)
