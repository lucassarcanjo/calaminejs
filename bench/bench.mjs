// Runs identically under Node and Bun. The question it answers: of the total
// time to get an xlsx into JS values, how much is calamine parsing and how much
// is the wasm/JS boundary? `parse only` is the floor; anything above it is what
// the boundary costs.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import init, { parseOnly, readCells, readCellsAsValue, toCsv, toMarkdown } from "../dist/calamine_wasm.js";
import { benchFixtures, dist } from "../test/support/paths.mjs";

const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;

await init({ module_or_path: readFileSync(join(dist, "calamine_wasm_bg.wasm")) });

const FIXTURES = [
  { name: "small", iters: 20 },
  { name: "medium", iters: 5 },
  { name: "large", iters: 3 },
];

const STRATEGIES = [
  {
    label: "wasm: parse only (floor)",
    run: (buf) => parseOnly(buf),
    rows: () => null,
  },
  {
    label: "wasm: JSON string + JSON.parse",
    run: (buf) => JSON.parse(readCells(buf)),
    rows: (r) => r.length,
  },
  {
    label: "wasm: serde-wasm-bindgen",
    run: (buf) => readCellsAsValue(buf),
    rows: (r) => r.length,
  },
  {
    label: "wasm: tagged cells",
    run: (buf) => JSON.parse(readCells(buf, { tagged: true })),
    rows: (r) => r.length,
  },
  {
    // The payoff of building this in Rust: one string crosses the boundary,
    // however many cells the sheet has.
    label: "wasm: toCsv (one string)",
    run: (buf) => toCsv(buf),
    rows: (r) => r.split("\n").length - 1,
  },
  {
    label: "wasm: toMarkdown (one string)",
    run: (buf) => toMarkdown(buf),
    rows: (r) => r.split("\n").length - 2,
  },
  {
    label: "SheetJS: read + sheet_to_csv",
    run: (buf) => {
      const wb = XLSX.read(buf, { type: "buffer" });
      return XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
    },
    rows: (r) => r.split("\n").length - 1,
  },
  {
    label: "SheetJS: read only",
    run: (buf) => XLSX.read(buf, { type: "buffer" }),
    rows: () => null,
  },
  {
    label: "SheetJS: read + sheet_to_json",
    run: (buf) => {
      const wb = XLSX.read(buf, { type: "buffer" });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    },
    rows: (r) => r.length,
  },
];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(0)} ms`);

console.log(`\nruntime: ${runtime}\n`);

for (const { name, iters } of FIXTURES) {
  const path = join(benchFixtures, `${name}.xlsx`);
  if (!existsSync(path)) {
    console.log(`${name}: missing fixture, run \`node bench/make-fixtures.mjs\` first`);
    continue;
  }
  const buf = readFileSync(path);
  console.log(`── ${name} (${(buf.length / 1024 / 1024).toFixed(2)} MB, ${iters} iters) ─────────────`);

  const results = [];
  for (const strat of STRATEGIES) {
    const times = [];
    let rowCount = null;
    let failure = null;
    try {
      for (let i = 0; i < iters; i++) {
        const t0 = performance.now();
        const out = strat.run(buf);
        times.push(performance.now() - t0);
        if (i === 0) rowCount = strat.rows(out);
      }
    } catch (e) {
      failure = e.message ?? String(e);
    }
    results.push({ label: strat.label, ms: failure ? null : median(times), rowCount, failure });
  }

  const baseline = results.find((r) => r.label === "SheetJS: read + sheet_to_json")?.ms;
  for (const r of results) {
    if (r.failure) {
      console.log(`  ${r.label.padEnd(31)} FAILED: ${r.failure}`);
      continue;
    }
    const speedup = baseline && r.ms ? ` (${(baseline / r.ms).toFixed(1)}x)` : "";
    const rows = r.rowCount != null ? `  rows=${r.rowCount}` : "";
    console.log(`  ${r.label.padEnd(31)} ${fmt(r.ms).padStart(8)}${speedup.padEnd(8)}${rows}`);
  }
  console.log();
}
