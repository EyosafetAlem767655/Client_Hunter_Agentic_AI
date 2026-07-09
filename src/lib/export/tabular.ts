import * as XLSX from "xlsx";

export interface ExportColumn {
  /** Property to read from each row. */
  key: string;
  /** Header text written to the file. */
  header: string;
}

export type ExportRow = Record<string, unknown>;

/** Excel needs a UTF-8 BOM to render accented characters correctly. */
const BOM = "﻿";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function escapeCsv(value: string): string {
  // Quote when the value contains a delimiter, quote, or newline; double inner quotes.
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(rows: ExportRow[], columns: ExportColumn[]): string {
  const lines = [columns.map((c) => escapeCsv(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsv(cell(row[c.key]))).join(","));
  }
  return BOM + lines.join("\r\n");
}

export function toXlsx(
  rows: ExportRow[],
  columns: ExportColumn[],
  sheetName = "Sheet1"
): Buffer {
  // Build plain objects keyed by header so the sheet's first row is the headers.
  const data = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const c of columns) out[c.header] = cell(row[c.key]);
    return out;
  });
  const worksheet = XLSX.utils.json_to_sheet(data, {
    header: columns.map((c) => c.header),
  });
  const workbook = XLSX.utils.book_new();
  // Excel caps sheet names at 31 chars and forbids []:*?/\
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export type ExportFormat = "csv" | "xlsx";

export function parseFormat(value: string | null): ExportFormat {
  return value === "xlsx" ? "xlsx" : "csv";
}

/** Build a downloadable Response for either format. */
export function exportResponse(
  rows: ExportRow[],
  columns: ExportColumn[],
  format: ExportFormat,
  baseFilename: string
): Response {
  if (format === "xlsx") {
    const buf = toXlsx(rows, columns, baseFilename);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseFilename}.xlsx"`,
      },
    });
  }
  return new Response(toCsv(rows, columns), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${baseFilename}.csv"`,
    },
  });
}
