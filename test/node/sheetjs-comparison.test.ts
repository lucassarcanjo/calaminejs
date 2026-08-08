// Spot-check the wasm output against SheetJS on the small fixture, with a
// focus on the type mix. Dates are the interesting column: xlsx stores them as
// serial numbers, so whatever we return here is an API decision.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { readCellsParsed, sheetNames } from "calaminejs";
import type { Cell } from "calaminejs";
import { benchFixtures } from "../support/paths.ts";

const buf = readFileSync(join(benchFixtures, "small.xlsx"));

console.log("sheetNames:", sheetNames(buf));

const wasmRows = readCellsParsed(buf);
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const firstSheet = wb.Sheets[wb.SheetNames[0]!]!;

// SheetJS types sheet_to_json's row form loosely; `header: 1` makes each row an
// array, which its overloads do not express.
const sjRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: null }) as unknown[][];

const peek = (row: readonly unknown[] | undefined) => (row ?? []).slice(0, 6);

console.log("\nheader   :", peek(wasmRows[0]));
console.log("\nrow 1");
console.log("  wasm   :", peek(wasmRows[1]));
console.log("  sheetjs:", peek(sjRows[1]));
console.log("\nrow 2");
console.log("  wasm   :", peek(wasmRows[2]));
console.log("  sheetjs:", peek(sjRows[2]));

// Structural and value agreement across the whole fixture. Datetimes are
// counted separately rather than fuzzed away: calamine returns the serial the
// file actually stores, while SheetJS applies a local-timezone fudge on both
// write and read, so the two legitimately disagree on time-of-day.
let rowMismatch = 0;
let cellMismatch = 0;
let dateDivergence = 0;
for (let r = 0; r < Math.max(wasmRows.length, sjRows.length); r++) {
  const a: Cell[] = wasmRows[r] ?? [];
  const b: unknown[] = sjRows[r] ?? [];
  if (a.length !== b.length) rowMismatch++;
  for (let c = 0; c < Math.max(a.length, b.length); c++) {
    const av = a[c];
    const raw = b[c];
    const bv = raw instanceof Date ? raw.toISOString() : raw;
    if (av === bv || (av == null && bv == null)) continue;
    if (typeof av === "number" && typeof bv === "number" && Math.abs(av - bv) < 1e-9) continue;
    if (raw instanceof Date) {
      dateDivergence++;
      continue;
    }
    cellMismatch++;
  }
}
console.log(`\nrows: wasm=${wasmRows.length} sheetjs=${sjRows.length}`);
console.log(`width mismatches:  ${rowMismatch}`);
console.log(`cell mismatches:   ${cellMismatch}`);
console.log(`date divergences:  ${dateDivergence}  (expected: SheetJS applies a TZ offset, calamine does not)`);
