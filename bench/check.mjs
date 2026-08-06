// Spot-check the wasm output against SheetJS on the small fixture, with a
// focus on the type mix. Dates are the interesting column: xlsx stores them as
// serial numbers, so whatever we return here is an API decision.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { sheetNames, readCells } from "../dist/node.js";

const here = dirname(fileURLToPath(import.meta.url));

const buf = readFileSync(join(here, "fixtures", "small.xlsx"));

console.log("sheetNames:", sheetNames(buf));

const wasmRows = JSON.parse(readCells(buf));
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const sjRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });

console.log("\nheader   :", wasmRows[0].slice(0, 6));
console.log("\nrow 1");
console.log("  wasm   :", wasmRows[1].slice(0, 6));
console.log("  sheetjs:", sjRows[1].slice(0, 6));
console.log("\nrow 2");
console.log("  wasm   :", wasmRows[2].slice(0, 6));
console.log("  sheetjs:", sjRows[2].slice(0, 6));

// Structural and value agreement across the whole fixture. Datetimes are
// counted separately rather than fuzzed away: calamine returns the serial the
// file actually stores, while SheetJS applies a local-timezone fudge on both
// write and read, so the two legitimately disagree on time-of-day.
let rowMismatch = 0;
let cellMismatch = 0;
let dateDivergence = 0;
for (let r = 0; r < Math.max(wasmRows.length, sjRows.length); r++) {
  const a = wasmRows[r] ?? [];
  const b = sjRows[r] ?? [];
  if (a.length !== b.length) rowMismatch++;
  for (let c = 0; c < Math.max(a.length, b.length); c++) {
    const av = a[c];
    const bv = b[c] instanceof Date ? b[c].toISOString() : b[c];
    if (av === bv || (av == null && bv == null)) continue;
    if (typeof av === "number" && typeof bv === "number" && Math.abs(av - bv) < 1e-9) continue;
    if (b[c] instanceof Date) {
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
