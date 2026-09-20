/**
 * Spreadsheets in and out.
 *
 * CSV rather than .xlsx, and deliberately. Excel opens a CSV by double-click,
 * every system in the mine can produce one, and it needs no library — an
 * import format people cannot produce is an import nobody uses. The cost is
 * that CSV has no types, which is why the server re-reads every value rather
 * than trusting what the file says a number is.
 */

/** One cell, escaped the way the format actually requires.
 *
 *  A field containing a comma, a quote or a newline must be quoted, with
 *  embedded quotes doubled. The leading-apostrophe trick and "wrap everything
 *  in quotes" both produce files that open wrong somewhere.
 *
 *  Values that look like a formula are prefixed with a tab. A cell beginning
 *  =, +, - or @ is executed by Excel on open, so a machine nicknamed "-350"
 *  becomes a formula error, and a hostile value becomes a command. The tab is
 *  invisible in the cell and survives a round trip. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `\t${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows and headings into a CSV file the way Excel expects one: CRLF between
 *  lines, and a byte-order mark so it reads the file as UTF-8 instead of
 *  guessing Windows-1252 and mangling every name with an accent in it. */
export function toCsv(headings: string[], rows: unknown[][]): Blob {
  const body = [headings, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  return new Blob([`﻿${body}`], { type: "text/csv;charset=utf-8" });
}

/** Hand the file to the browser. Revoked on the next tick rather than
 *  immediately, because Safari has not started reading it yet when the click
 *  returns. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A CSV file into rows of {heading: value}.
 *
 * Written out rather than pulled from a library because the whole job is one
 * pass over the text, and the alternative is 40KB of parser for it. It handles
 * what a spreadsheet actually emits: quoted fields, doubled quotes inside
 * them, commas and newlines inside quotes, CRLF or LF line endings, and the
 * byte-order mark Excel writes at the front of its own exports.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (src[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;                       // CRLF: the \n does the work
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  // Whatever is still in hand when the text runs out is the last field, unless
  // the file ended with a newline and there is nothing in hand.
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  const [headings, ...body] = rows;
  if (!headings) return [];

  // A tab at the front was ours, added on the way out to stop Excel treating
  // the value as a formula. It is not part of the data.
  const clean = (s: string) => s.replace(/^\t/, "").trim();

  return body
    // Excel keeps trailing blank lines; a row of nothing is not a machine.
    .filter((r) => r.some((v) => clean(v) !== ""))
    .map((r) => Object.fromEntries(
      headings.map((h, i) => [clean(h), clean(r[i] ?? "")])));
}
