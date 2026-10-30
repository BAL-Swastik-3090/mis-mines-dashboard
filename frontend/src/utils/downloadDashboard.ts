export interface DownloadDashboardOptions {
  /** Human-readable date range, e.g. "1 Jun 2026 – 29 Jun 2026" */
  dateRange: string;
  /** Short period tag, e.g. "MTD" | "YTD" | "TODAY" */
  periodLabel: string;
  /**
   * What to export. Omitted, it takes the whole page, which is what the MIS
   * tab bar has always done. A selector lets a page export one section — the
   * same snapshot machinery, a smaller root.
   */
  rootSelector?: string;
  /** Names the export in the banner and the filename. */
  title?: string;
  /** Filename stem; the date is appended. Defaults from the title. */
  fileStem?: string;
}

/**
 * THE EXPORT IS A PHOTOGRAPH, SO THE LAYOUT MUST BE DEVELOPED HERE.
 *
 * The file used to carry the page's responsive CSS through unchanged, which
 * meant every `sm:` `lg:` `xl:` `2xl:` rule was re-evaluated against whatever
 * window the reader happened to open it in. On the dashboard the KPI strip is
 * `grid-cols-1 sm:2 lg:3 xl:4 2xl:5` and the content sits beside a 200px
 * sidebar; in the file there is no sidebar and the window is usually smaller,
 * so a five-column strip arrived as three, two-column chart rows arrived
 * stacked, and table headings that fit on one line wrapped onto two. The data
 * was right and the report did not look like the screen it came from.
 *
 * So the media queries are resolved at capture time rather than carried: a
 * query that matches right now has its rules emitted unconditionally, one that
 * does not is dropped. Nothing in the file can then respond to the reader's
 * window. The wrapper is pinned to the width the content actually had, and the
 * page scrolls horizontally on a smaller screen instead of reflowing.
 *
 * `@media print` is the one exception, kept as written — it describes paper,
 * not the viewport, and someone printing the export should still get it.
 */
function flatten(rules: CSSRuleList): string {
  let out = "";
  for (const rule of Array.from(rules)) {
    // The font @import is already at the top, and an @import after any other
    // rule is invalid CSS. Matched on the rule TYPE rather than on the text:
    // a media block's cssText contains every rule inside it, so a substring
    // test would throw away a whole block because one rule inside it happened
    // to mention the font host.
    if (typeof CSSImportRule !== "undefined" && rule instanceof CSSImportRule) continue;

    if (typeof CSSMediaRule !== "undefined" && rule instanceof CSSMediaRule) {
      const q = rule.media.mediaText;
      if (q.includes("print")) { out += rule.cssText + "\n"; continue; }
      // Matches now → emit its contents with the condition stripped off.
      // Does not → drop it; it must never come back in the reader's browser.
      try {
        if (window.matchMedia(q).matches) out += flatten(rule.cssRules);
      } catch {
        // An unparseable query is kept as it was rather than guessed at.
        out += rule.cssText + "\n";
      }
      continue;
    }

    if (typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule) {
      try {
        if (CSS.supports(rule.conditionText)) out += flatten(rule.cssRules);
      } catch {
        out += rule.cssText + "\n";
      }
      continue;
    }

    // Everything else verbatim — @font-face, @keyframes and plain rules all
    // mean the same thing in the file as they do on the page.
    out += rule.cssText + "\n";
  }
  return out;
}

/**
 * Exports the current MIS Dashboard DOM as a fully self-contained .html file.
 * - Inlines all page CSS (Tailwind + globals), resolved to this viewport
 * - Snapshots <canvas> elements as PNG data-URLs
 * - Adds a branded export header with date range
 */
export async function downloadDashboard(opts: DownloadDashboardOptions): Promise<void> {
  const {
    dateRange, periodLabel,
    rootSelector = "main > div",
    title = "MIS Dashboard",
    fileStem = "mines-dashboard",
  } = opts;
  // ── 1. Locate the live content element ──────────────────────
  const contentEl = document.querySelector(rootSelector) as HTMLElement | null;
  if (!contentEl) return;

  // ── 2. Deep-clone so we never mutate the live DOM ───────────
  const clone = contentEl.cloneNode(true) as HTMLElement;

  // The width the content actually had. Pinned on the wrapper below so grid
  // and flex tracks divide the same space they divided on screen — media
  // queries are resolved in `flatten`, but a `1fr` column still measures its
  // container, and the container here has no sidebar beside it.
  const captureWidth = Math.round(contentEl.getBoundingClientRect().width);

  // THE DOWNLOAD BUTTON CANNOT APPEAR IN ITS OWN DOWNLOAD. It is mid-click
  // while the clone is taken, so it photographs reading "Preparing…" — a
  // transient state the dashboard never actually shows at rest. Anything
  // marked data-export-hide is dropped; the Excel buttons are deliberately
  // NOT marked, because they are part of how the section looks and a report
  // that quietly differs from the screen is the thing this export is for.
  clone.querySelectorAll("[data-export-hide]").forEach((el) => el.remove());

  // A SCROLLER IN A LIVE PAGE IS A WINDOW; IN A FILE IT IS A LID. On screen a
  // capped table is scrolled to read the rest; in a saved report the rest is
  // simply absent, and nothing on the page says so. The clone drops the cap
  // and lets the table run — the same reasoning as export mode expanding
  // collapsed sections, applied to the ones that were never collapsed, only
  // clipped. Sticky headers go with it: pinned to a box that no longer
  // scrolls, they float over the rows beneath.
  //
  // READ FROM THE LIVE NODES, WRITE TO THE CLONE. getComputedStyle on a
  // detached element answers nothing, so the two trees are walked in step —
  // the same index-matching the canvas snapshot below relies on, and sound
  // for the same reason: the clone is a deep copy taken a moment ago and
  // neither tree is touched in between.
  const liveAll = contentEl.querySelectorAll<HTMLElement>("*");
  const cloneAll = clone.querySelectorAll<HTMLElement>("*");
  liveAll.forEach((live, i) => {
    const el = cloneAll[i];
    if (!el) return;
    const cs = window.getComputedStyle(live);
    if (cs.overflowY === "auto" || cs.overflowY === "scroll") {
      el.style.maxHeight = "none";
      el.style.overflowY = "visible";
    }
    if (cs.position === "sticky") el.style.position = "static";
  });

  // ── 3. Snapshot every <canvas> → <img data-url> ─────────────
  const liveCanvases   = Array.from(contentEl.querySelectorAll("canvas"));
  const clonedCanvases = Array.from(clone.querySelectorAll("canvas"));
  liveCanvases.forEach((canvas, i) => {
    const cloned = clonedCanvases[i];
    if (!cloned) return;
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const img     = document.createElement("img");
      img.src       = dataUrl;
      img.className = canvas.className;
      // Preserve rendered dimensions
      const computed  = window.getComputedStyle(canvas);
      img.style.width  = computed.width  || canvas.style.width  || `${canvas.width}px`;
      img.style.height = computed.height || canvas.style.height || `${canvas.height}px`;
      img.style.display = "block";
      cloned.parentNode?.replaceChild(img, cloned);
    } catch {
      // tainted canvas or other error — leave as-is
    }
  });

  // ── 4. Collect all page CSS ──────────────────────────────────
  // Google Fonts first (CDN — always include the @import)
  let css = `@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700;800&family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');\n\n`;

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      css += flatten(sheet.cssRules ?? ([] as unknown as CSSRuleList));
    } catch {
      // Cross-origin sheet — CORS blocks cssRules, skip silently
    }
  }

  // ── 5. Build timestamp & filename ───────────────────────────
  const now      = new Date();
  const pad      = (n: number) => String(n).padStart(2, "0");
  const dateStr  = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr  = `${pad(now.getHours())}:${pad(now.getMinutes())} IST`;
  const fileDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const filename = `${fileStem}-${fileDate}.html`;

  // ── 6. Assemble the final HTML document ─────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kaliapani Chromite Mines — ${title} · ${dateStr}</title>
  <style>
${css}
  </style>
</head>
<body style="margin:0;background:#f5f7fb;font-family:'IBM Plex Sans',sans-serif;">

  <!-- Export header banner -->
  <div style="background:#1a2744;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;gap:24px;">
    <div>
      <div style="color:#f5a623;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;margin-bottom:2px;">
        Balasore Alloys Limited
      </div>
      <div style="color:#ffffff;font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;letter-spacing:.01em;line-height:1.2;">
        Kaliapani Chromite Mines — ${title}
      </div>
    </div>

    <!-- Date range pill -->
    <div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:8px 16px;">
      <span style="color:#f5a623;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;">
        ${periodLabel}
      </span>
      <span style="width:1px;height:16px;background:rgba(255,255,255,.15);display:inline-block;"></span>
      <span style="color:#ffffff;font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;">
        ${dateRange}
      </span>
    </div>

    <div style="text-align:right;margin-left:auto;">
      <div style="color:#f5a623;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;">
        Exported: ${dateStr} · ${timeStr}
      </div>
      <div style="color:rgba(255,255,255,.45);font-family:'IBM Plex Sans',sans-serif;font-size:10px;margin-top:2px;">
        Static snapshot — data current at time of export
      </div>
    </div>
  </div>
  <div style="height:3px;background:linear-gradient(90deg,#c8960c,#f5a623,#c8960c);"></div>

  <!-- Dashboard content, at the width it was captured. A narrower window
       scrolls sideways rather than reflowing: the file is a photograph of a
       screen, and a photograph does not rearrange itself to fit the frame. -->
  <div style="padding:24px;width:${captureWidth}px;margin:0 auto;box-sizing:content-box;">
    ${clone.innerHTML}
  </div>

</body>
</html>`;

  // ── 7. Trigger browser download ──────────────────────────────
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
