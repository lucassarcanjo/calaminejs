// Attacks the binding rather than exercising it. Every case here is something
// a real user will eventually feed it: a half-downloaded file, a .csv renamed
// to .xlsx, a sheet whose declared dimension does not match its contents.
//
// The load-bearing question is not "does it reject bad input" but "is the
// module still usable afterwards" — the crate builds with panic=abort, so a
// panic anywhere in calamine kills the wasm instance for the whole process,
// not just the one call.
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { join } from "node:path";
import init, { sheetNames, readCells, parseOnly } from "../../dist/calamine_wasm.js";
import { makeXlsx, makeZip, sheet } from "../support/zip.mjs";
import { benchFixtures, datesFixture, dist } from "../support/paths.mjs";

const wasm = await init({ module_or_path: readFileSync(join(dist, "calamine_wasm_bg.wasm")) });

const good = readFileSync(datesFixture);
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

let failures = 0;
const results = [];

// Each case returns a description of what happened. A thrown JS Error is a
// *pass* — that is the binding rejecting input cleanly.
function attack(name, fn) {
  let outcome;
  try {
    const value = fn();
    outcome = { kind: "returned", detail: String(value).slice(0, 60) };
  } catch (e) {
    outcome = { kind: "threw", detail: (e.message ?? String(e)).split("\n")[0].slice(0, 60) };
  }

  // The real assertion: is the instance still alive?
  let alive = false;
  try {
    alive = sheetNames(good).length > 0;
  } catch {
    alive = false;
  }
  if (!alive) failures++;
  results.push({ name, ...outcome, alive });
}

const HUGE_DIM = sheet("A1:XFD1048576", '<row r="1"><c r="A1" t="n"><v>1</v></c></row>');

attack("empty buffer", () => sheetNames(Buffer.alloc(0)));
attack("random bytes", () => sheetNames(Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 256))));
attack("truncated xlsx (half)", () => sheetNames(good.subarray(0, good.length >> 1)));
attack("truncated xlsx (2 bytes)", () => sheetNames(good.subarray(0, 2)));
attack("xlsx with trailing garbage", () => sheetNames(Buffer.concat([good, Buffer.alloc(1024, 0xff)])));
attack("csv renamed to xlsx", () => sheetNames(Buffer.from("a,b,c\n1,2,3\n")));
attack("valid zip, not a workbook", () => sheetNames(makeZip([{ name: "hello.txt", data: "hi" }])));
attack("workbook with zero sheets", () => sheetNames(makeXlsx(sheet("A1:A1", ""), { sheets: "" })));
attack("zero sheets -> read first", () => readCells(makeXlsx(sheet("A1:A1", ""), { sheets: "" })));
attack("sheet1.xml is not XML", () => readCells(makeXlsx("this is not xml at all")));
attack("unclosed XML tag", () => readCells(makeXlsx('<worksheet><sheetData><row r="1">')));
attack("nonexistent sheet name", () => readCells(good, { sheet: "NoSuchSheet" }));
attack("dimension claims 17bn cells", () => parseOnly(makeXlsx(HUGE_DIM)));
attack("dimension 17bn -> materialise", () => readCells(makeXlsx(HUGE_DIM)).length);
attack("cell ref beyond dimension", () =>
  readCells(makeXlsx(sheet("A1:A1", '<row r="1"><c r="ZZ99" t="n"><v>7</v></c></row>'))));
attack("negative serial as date", () =>
  readCells(makeXlsx(sheet("A1:A1", '<row r="1"><c r="A1" s="1"><v>-100000</v></c></row>'))));

console.log(`\n${"attack".padEnd(34)} ${"outcome".padEnd(9)} ${"detail".padEnd(46)} usable after`);
console.log("─".repeat(110));
for (const r of results) {
  console.log(
    `${r.name.padEnd(34)} ${r.kind.padEnd(9)} ${r.detail.padEnd(46)} ${r.alive ? "yes" : "NO — INSTANCE DEAD"}`,
  );
}

// Memory does not shrink in wasm. Repeated large reads should plateau, not climb.
console.log("\nmemory growth across repeated reads of the 23 MB fixture");
const largePath = join(benchFixtures, "large.xlsx");
let large;
try {
  large = readFileSync(largePath);
} catch {
  console.log("  (large.xlsx missing — run `node bench/make-fixtures.mjs`)");
}
if (large) {
  const readings = [];
  for (let i = 0; i < 5; i++) {
    parseOnly(large);
    readings.push(wasm.memory.buffer.byteLength);
  }
  console.log(`  after each of 5 reads: ${readings.map(mb).join(", ")}`);
  const grew = readings.at(-1) > readings[0];
  console.log(`  ${grew ? "climbing — memory is not being reused" : "plateaued after the first read"}`);
}

console.log(
  failures === 0
    ? "\ninstance survived every attack\n"
    : `\n${failures} attack(s) left the wasm instance unusable\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
