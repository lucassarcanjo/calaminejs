// The evidence behind docs/comparison.md.
//
// Every claim in that document is printed by this script, so a reader can check
// it rather than trust it — and so the numbers can be re-measured when a
// dependency moves rather than quietly going stale.
//
// Third-party readers are optional and detected at runtime. They are
// deliberately NOT devDependencies: ExcelJS alone is 22 MB and drags in a
// flagged `uuid`, and adding an audit finding to this repo to prove a point
// about dependency hygiene would be a poor trade. Install them when you want
// the full table:
//
//   bun add -d exceljs read-excel-file       # xlsx is already a devDependency
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as calamine from "../../dist/node.js";
import { makeXlsx, sheet } from "../../test/support/zip.ts";
import { benchFixtures, corpus, datesFixture } from "../../test/support/paths.ts";

// Child mode: measure one library in a clean process and print one row.
if (process.argv.includes("--measure")) {
  const lib = process.argv[process.argv.indexOf("--measure") + 1];
  const buf = readFileSync(join(benchFixtures, "large.xlsx"));
  const mb = () => process.memoryUsage().rss / 1024 / 1024;

  const t0 = Date.now();
  let rows;
  if (lib === "calaminejs") {
    rows = calamine.readCellsParsed(buf).length;
  } else {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }).length;
  }
  const ms = Date.now() - t0;
  const peak = mb();

  // The floor a long-lived process keeps holding once the result is dropped.
  rows = String(rows);
  if (globalThis.gc) {
    globalThis.gc();
    globalThis.gc();
    await new Promise((r) => setTimeout(r, 200));
    globalThis.gc();
  }
  process.stdout.write(
    `${lib.padEnd(14)}${`${ms} ms`.padEnd(10)}${`${peak.toFixed(0)} MB`.padEnd(12)}${`${mb().toFixed(0)} MB`.padEnd(12)}${rows}`,
  );
  process.exit(0);
}

const optional = async (name) => {
  try {
    return await import(name);
  } catch {
    return null;
  }
};

const XLSX = await optional("xlsx");
const ExcelJSModule = await optional("exceljs");
const ExcelJS = ExcelJSModule?.default ?? ExcelJSModule;
const readExcelFile = (await optional("read-excel-file/node"))?.default;

const absent = [
  ["xlsx", XLSX],
  ["exceljs", ExcelJS],
  ["read-excel-file", readExcelFile],
]
  .filter(([, m]) => !m)
  .map(([n]) => n);

console.log(`\n${"=".repeat(78)}\ncalaminejs vs the field — reproducible comparison\n${"=".repeat(78)}`);
console.log(`node ${process.version} · ${new Date().toISOString().slice(0, 10)} · TZ ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
if (absent.length) console.log(`\nnot installed, skipped: ${absent.join(", ")}  (bun add -d ${absent.join(" ")})`);

// ── 1. format support ────────────────────────────────────────────────────────
// The same four files through every reader. A library either opens the bytes or
// it does not; nothing here is a matter of opinion.
const FORMAT_FILES = [
  ["xlsx", join(corpus, "temperature.xlsx")],
  ["xls", join(corpus, "any_sheets.xls")],
  ["xlsb", join(corpus, "any_sheets.xlsb")],
  ["ods", join(corpus, "any_sheets.ods")],
];

const readers = {
  calaminejs: (p) => calamine.sheetNames(readFileSync(p)).length > 0,
  sheetjs: XLSX && ((p) => XLSX.read(readFileSync(p), { type: "buffer" }).SheetNames.length > 0),
  exceljs:
    ExcelJS &&
    (async (p) => {
      if (!p.endsWith(".xlsx")) throw new Error("unsupported");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(readFileSync(p));
      return wb.worksheets.length > 0;
    }),
  "read-excel-file": readExcelFile && (async (p) => (await readExcelFile(p)).length >= 0),
};

if (FORMAT_FILES.every(([, p]) => existsSync(p))) {
  console.log(`\n\n1. FORMAT SUPPORT — same four files\n`);
  console.log(`  ${"library".padEnd(18)}${FORMAT_FILES.map(([f]) => f.padEnd(8)).join("")}`);
  for (const [name, fn] of Object.entries(readers)) {
    if (!fn) continue;
    const cells = [];
    for (const [, path] of FORMAT_FILES) {
      try {
        cells.push((await fn(path)) ? "yes" : "no");
      } catch {
        cells.push("no");
      }
    }
    console.log(`  ${name.padEnd(18)}${cells.map((c) => c.padEnd(8)).join("")}`);
  }
} else {
  console.log("\n\n1. FORMAT SUPPORT — skipped, corpus missing (bun run fixtures)");
}

// ── 2. dates ─────────────────────────────────────────────────────────────────
// The load-bearing section. Each row is a cell whose exact value is known
// because make-date-fixture.ts wrote the raw serial and number format, with no
// Date object anywhere in the writing path.
const DATE_ROWS = ["the tz-mangled one", "serial 60 (leap bug)", "duration 36h"];

if (existsSync(datesFixture)) {
  // Imported here rather than at the top: this module writes the fixture when
  // it loads, and a static import would have every subprocess rewrite it.
  const { CASES } = await import("../../test/support/make-date-fixture.ts");
  const buf = readFileSync(datesFixture);
  const cal = calamine.readCellsParsed(buf, { tagged: true });

  let sj = null;
  if (XLSX) {
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    sj = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  }
  let ews = null;
  if (ExcelJS) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    ews = wb.worksheets[0];
  }

  const render = (v) =>
    v instanceof Date ? `${v.toISOString()} (Date)` : typeof v === "object" && v ? JSON.stringify(v.v ?? v) : JSON.stringify(v);

  console.log(`\n\n2. DATES — the value the file actually contains\n`);
  for (const label of DATE_ROWS) {
    const i = CASES.findIndex((c) => c.label === label);
    if (i < 0) continue;
    console.log(`  ${label}`);
    console.log(`    ${"truth in the file".padEnd(14)} ${CASES[i].iso}`);
    console.log(`    ${"calaminejs".padEnd(14)} ${render(cal[i]?.[1])}`);
    if (sj) console.log(`    ${"sheetjs".padEnd(14)} ${render(sj[i]?.[1])}`);
    if (ews) console.log(`    ${"exceljs".padEnd(14)} ${render(ews.getRow(i + 1).getCell(2).value)}`);
    console.log();
  }
} else {
  console.log("\n\n2. DATES — skipped, dates.xlsx missing (bun run fixtures)");
}

// ── 3. type fidelity ─────────────────────────────────────────────────────────
// A1 is a real date cell; A2 is text that renders identically; A3 is an error.
// Built here rather than fetched so the bytes are unambiguous.
const fidelity = makeXlsx(
  sheet(
    "A1:A3",
    [
      `<row r="1"><c r="A1" t="d"><v>2020-01-01T12:00:00</v></c></row>`,
      `<row r="2"><c r="A2" t="inlineStr"><is><t>2020-01-01T12:00:00.000</t></is></c></row>`,
      `<row r="3"><c r="A3" t="e"><v>#DIV/0!</v></c></row>`,
    ].join(""),
  ),
);

console.log(`\n3. TYPE FIDELITY — A1 real date, A2 identical-looking text, A3 error cell\n`);
const calCells = calamine.readCellsParsed(fidelity, { tagged: true });
console.log(`  calaminejs      A1 ${JSON.stringify(calCells[0]?.[0])}`);
console.log(`                  A2 ${JSON.stringify(calCells[1]?.[0])}`);
console.log(`                  A3 ${JSON.stringify(calCells[2]?.[0])}`);

if (XLSX) {
  const wb = XLSX.read(fidelity, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  console.log(`  sheetjs         A3 via sheet_to_json  ${JSON.stringify(rows[2]?.[0])}`);
  console.log(`                  A3 via raw cell       ${JSON.stringify(ws.A3)}`);
}

// ── 4. cost ──────────────────────────────────────────────────────────────────
// Time and the memory floor a long-lived process is left holding. Run with
// --expose-gc for the floor to mean anything.
// One subprocess per library, which is not fastidiousness: measured in a shared
// process, whichever library runs second inherits the first's memory. Running
// calaminejs first made SheetJS look like it used 936 MB against its true 537 —
// an error of 400 MB, in our favour, in our own comparison. Numbers that
// flatter the author are exactly the ones to be suspicious of.
const large = join(benchFixtures, "large.xlsx");
if (existsSync(large)) {
  const size = (readFileSync(large).length / 1024 / 1024).toFixed(1);
  console.log(`\n\n4. COST — ${size} MB, 1.8M cells (one subprocess each)\n`);
  console.log(`  ${"library".padEnd(14)}${"time".padEnd(10)}${"peak RSS".padEnd(12)}${"after GC".padEnd(12)}rows`);

  for (const lib of ["calaminejs", "sheetjs"]) {
    if (lib === "sheetjs" && !XLSX) continue;
    try {
      const out = execFileSync(process.execPath, ["--expose-gc", fileURLToPath(import.meta.url), "--measure", lib], {
        encoding: "utf8",
        env: { ...process.env, COMPARE_CHILD: "1" },
      });
      console.log(`  ${out.trim()}`);
    } catch (error) {
      console.log(`  ${lib.padEnd(14)}failed: ${String(error.stderr ?? error).slice(0, 60)}`);
    }
  }
} else {
  console.log(`\n\n4. COST — skipped, ${large} missing (bun run fixtures)`);
}

console.log(`\n${"=".repeat(78)}`);
console.log(`Install footprint is measured separately — see docs/comparison.md.`);
console.log(`${"=".repeat(78)}\n`);
