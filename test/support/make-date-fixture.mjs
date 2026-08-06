// A fixture with known-exact serials.
//
// The perf fixtures are written from JS `Date` objects, which means SheetJS's
// writer applies a local-timezone offset on the way in — so that file does not
// contain the values it looks like it contains, and is useless for checking
// date correctness. Here we write the raw serial and the number format
// directly, bypassing any Date conversion, so the bytes on disk are known.
import { mkdirSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { datesFixture, fixtures } from "./paths.mjs";

mkdirSync(fixtures, { recursive: true });

// `kind` is what the cell *is*, which decides how to read the output:
// a duration is a length of time, not a point on a calendar.
export const CASES = [
  { label: "date only", serial: 43831, fmt: "yyyy-mm-dd", kind: "datetime", iso: "2020-01-01T00:00:00.000" },
  { label: "datetime + millis", serial: 45943.541, fmt: "yyyy-mm-dd hh:mm:ss", kind: "datetime", iso: "2025-10-13T12:59:02.400" },
  { label: "the tz-mangled one", serial: 43830.87467592592, fmt: "yyyy-mm-dd hh:mm:ss", kind: "datetime", iso: "2019-12-31T20:59:32.000" },

  // Excel numbers days from serial 1 = 1900-01-01, then wrongly believes 1900
  // was a leap year. So serials either side of 60 are the interesting ones.
  { label: "serial 1", serial: 1, fmt: "yyyy-mm-dd", kind: "datetime", iso: "1900-01-01T00:00:00.000" },
  { label: "serial 59", serial: 59, fmt: "yyyy-mm-dd", kind: "datetime", iso: "1900-02-28T00:00:00.000" },
  { label: "serial 60 (leap bug)", serial: 60, fmt: "yyyy-mm-dd", kind: "datetime", iso: "1900-02-29T00:00:00.000" },
  { label: "serial 61", serial: 61, fmt: "yyyy-mm-dd", kind: "datetime", iso: "1900-03-01T00:00:00.000" },
  // Below the leap bug, so this is day 0 + 12h = 1899-12-31, not the
  // 1899-12-30 anchor that only lines up for serials past 60.
  { label: "time only", serial: 0.5, fmt: "hh:mm:ss", kind: "datetime", iso: "1899-12-31T12:00:00.000" },

  { label: "duration 36h", serial: 1.5, fmt: "[h]:mm:ss", kind: "duration", iso: "PT36H0M0S" },
  { label: "duration 1h", serial: 1 / 24, fmt: "[h]:mm:ss", kind: "duration", iso: "PT1H0M0S" },

  // Same serial as row 1 but no date format: must stay a number.
  { label: "not a date", serial: 43831, fmt: "General", kind: "number", iso: 43831 },
];

const ws = XLSX.utils.aoa_to_sheet(CASES.map((c) => [c.label, c.serial]));
for (let i = 0; i < CASES.length; i++) {
  const cell = ws[`B${i + 1}`];
  cell.t = "n";
  cell.v = CASES[i].serial;
  cell.z = CASES[i].fmt;
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Dates");
writeFileSync(datesFixture, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log(`wrote ${datesFixture} (${CASES.length} cases)`);
