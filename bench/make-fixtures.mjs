// Generates xlsx fixtures with a realistic type mix: strings, numbers, dates,
// booleans and holes. Holes matter — sparse sheets exercise a different path in
// both calamine and SheetJS than dense ones do.
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { benchFixtures as outDir } from "../test/support/paths.ts";

mkdirSync(outDir, { recursive: true });

const ALL = [
  { name: "small", rows: 500, cols: 10 },
  { name: "medium", rows: 20_000, cols: 20 },
  { name: "large", rows: 150_000, cols: 12 },
];

// CI only needs `small` — it runs the correctness suites, not the benchmark,
// and building the 23 MB fixture there is a minute of nothing useful.
const wanted = process.argv.slice(2);
const SIZES = wanted.length ? ALL.filter((s) => wanted.includes(s.name)) : ALL;
if (wanted.length && SIZES.length !== wanted.length) {
  const known = ALL.map((s) => s.name).join(", ");
  console.error(`unknown size in ${JSON.stringify(wanted)}; known sizes: ${known}`);
  process.exit(1);
}

function buildRows(rows, cols) {
  const header = Array.from({ length: cols }, (_, c) => `col_${c}`);
  const data = [header];
  for (let r = 0; r < rows; r++) {
    const row = new Array(cols);
    for (let c = 0; c < cols; c++) {
      switch ((r + c) % 6) {
        case 0:
          row[c] = `str_${r}_${c}`;
          break;
        case 1:
          row[c] = r * 1000 + c;
          break;
        case 2:
          row[c] = (r + c) / 7;
          break;
        case 3:
          row[c] = new Date(Date.UTC(2020, r % 12, (r % 28) + 1));
          break;
        case 4:
          row[c] = (r + c) % 2 === 0;
          break;
        default:
          row[c] = null; // hole
      }
    }
    data.push(row);
  }
  return data;
}

for (const { name, rows, cols } of SIZES) {
  const path = join(outDir, `${name}.xlsx`);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(buildRows(rows, cols), { cellDates: true });
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
  writeFileSync(path, buf);
  const mb = (statSync(path).size / 1024 / 1024).toFixed(2);
  console.log(`${name.padEnd(7)} ${rows} x ${cols} = ${rows * cols} cells -> ${mb} MB`);
}
