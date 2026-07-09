import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  toCsv,
  toXlsx,
  parseFormat,
  type ExportColumn,
} from "@/lib/export/tabular";

const COLUMNS: ExportColumn[] = [
  { key: "company", header: "Company" },
  { key: "email", header: "Contact Email" },
  { key: "score", header: "custom.Score" },
  { key: "relevant", header: "Relevant" },
];

describe("toCsv", () => {
  it("writes a header row and a BOM so Excel renders UTF-8", () => {
    const csv = toCsv([], COLUMNS);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Company,Contact Email,custom.Score,Relevant");
  });

  it("escapes commas, quotes and newlines", () => {
    const csv = toCsv(
      [{ company: 'Acme, Inc "HQ"', email: "a@b.co", score: 90, relevant: true }],
      COLUMNS
    );
    expect(csv).toContain('"Acme, Inc ""HQ"""');

    const multiline = toCsv([{ company: "line1\nline2" }], [{ key: "company", header: "Company" }]);
    expect(multiline).toContain('"line1\nline2"');
  });

  it("renders null/undefined as empty, booleans as yes/no, dates as ISO", () => {
    const csv = toCsv(
      [{ company: null, email: undefined, score: 0, relevant: false }],
      COLUMNS
    );
    const dataRow = csv.split("\r\n")[1];
    expect(dataRow).toBe(",,0,no");

    const d = toCsv([{ when: new Date("2026-07-09T00:00:00.000Z") }], [{ key: "when", header: "When" }]);
    expect(d).toContain("2026-07-09T00:00:00.000Z");
  });
});

describe("toXlsx", () => {
  it("produces a workbook that reads back with the same headers and values", () => {
    const buf = toXlsx(
      [{ company: "Acme", email: "a@b.co", score: 91, relevant: true }],
      COLUMNS,
      "leads"
    );
    expect(buf.length).toBeGreaterThan(0);

    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames[0]).toBe("leads");
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets["leads"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]["Company"]).toBe("Acme");
    expect(rows[0]["Contact Email"]).toBe("a@b.co");
    expect(rows[0]["custom.Score"]).toBe("91");
    expect(rows[0]["Relevant"]).toBe("yes");
  });

  it("truncates over-long sheet names to Excel's 31-char limit", () => {
    const buf = toXlsx([{ company: "x" }], [{ key: "company", header: "Company" }], "a".repeat(40));
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames[0]).toHaveLength(31);
  });
});

describe("parseFormat", () => {
  it("only accepts xlsx, defaulting everything else to csv", () => {
    expect(parseFormat("xlsx")).toBe("xlsx");
    expect(parseFormat("csv")).toBe("csv");
    expect(parseFormat(null)).toBe("csv");
    expect(parseFormat("pdf")).toBe("csv");
  });
});
