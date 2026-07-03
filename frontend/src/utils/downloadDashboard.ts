export interface DownloadDashboardOptions {
  /** Human-readable date range, e.g. "1 Jun 2026 – 29 Jun 2026" */
  dateRange: string;
  /** Short period tag, e.g. "MTD" | "YTD" | "TODAY" */
  periodLabel: string;
}

/**
 * Exports the current MIS Dashboard DOM as a fully self-contained .html file.
 * - Inlines all page CSS (Tailwind + globals)
 * - Snapshots <canvas> elements as PNG data-URLs
 * - Adds a branded export header with date range
 */
export async function downloadDashboard(opts: DownloadDashboardOptions): Promise<void> {
  const { dateRange, periodLabel } = opts;
  // ── 1. Locate the live content element ──────────────────────
  const contentEl = document.querySelector("main > div") as HTMLElement | null;
  if (!contentEl) return;

  // ── 2. Deep-clone so we never mutate the live DOM ───────────
  const clone = contentEl.cloneNode(true) as HTMLElement;

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
      const rules = Array.from(sheet.cssRules ?? []);
      for (const rule of rules) {
        // Skip the Google Fonts @import (already added above)
        if (rule.cssText.includes("fonts.googleapis.com")) continue;
        css += rule.cssText + "\n";
      }
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
  const filename = `mines-dashboard-${fileDate}.html`;

  // ── 6. Assemble the final HTML document ─────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kaliapani Chromite Mines — MIS Dashboard · ${dateStr}</title>
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
        Kaliapani Chromite Mines — MIS Dashboard
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

  <!-- Dashboard content -->
  <div style="padding:24px;max-width:1920px;margin:0 auto;">
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
