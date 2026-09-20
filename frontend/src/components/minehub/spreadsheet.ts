/**
 * The register, out to a spreadsheet.
 *
 * CSV rather than .xlsx, and deliberately: Excel opens a CSV by double-click,
 * every system in the mine can read one, and it needs no library on the page.
 *
 * Reading spreadsheets back in was built alongside this and then dropped —
 * the mine decided the register should only be filled in through the form,
 * where every entry is somebody's decision rather than a row in a file. The
 * parser is in the history if that is ever reconsidered.
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
