// Differential test against calamine's own 131-file corpus.
//
// For each fixture: dump what calamine natively sees (examples/dump_native.rs,
// raw `Data` enum, none of our opinions applied), then read the same file
// through the wasm binding and check the two agree — with the expected value
// recomputed *here*, in JavaScript, from the neutral dump.
//
// That independence is the whole point. Comparing our Rust conversion against
// our Rust conversion would only prove wasm behaves like the host. Rebuilding
// the mapping from scratch on this side means a bug has to be made twice, in
// two languages, to go unnoticed.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { readCellsParsed, sheetNames } from "calaminejs";
import type { Cell, DatePolicy } from "calaminejs";
import { corpus, crafted, root } from "../support/paths.ts";

const dumper = join(root, "target", "release", "examples", "dump_native");

// ── the neutral dump, as examples/dump_native.rs emits it ────────────────────
//
// Written out rather than left as `any` because this shape is the contract
// between the Rust dumper and the JS reimplementation below. If the dumper
// changes what it emits, the mismatch should be a type error here — that is the
// one place a silent change would quietly stop the whole comparison meaning
// anything.

/** `[year, month, day, hour, minute, second, millisecond]`, from calamine. */
type Civil = [number, number, number, number, number, number, number];

type NeutralCell =
  | { t: "empty" }
  | { t: "str"; v: string }
  | { t: "err"; v: string }
  | { t: "int"; v: number }
  | { t: "float"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "datetime"; serial: number; duration: boolean; civil: Civil }
  | { t: "dtiso"; v: string }
  | { t: "duriso"; v: string };

/** A sheet either has rows or an error explaining why it could not be read. */
type NativeSheet =
  | { name: string; rows: NeutralCell[][]; error?: undefined }
  | { name: string; error: string; rows?: undefined };

type NativeDump = { sheets: NativeSheet[]; error?: undefined } | { error: string; sheets?: undefined };

const POLICIES: DatePolicy[] = ["iso", "serial", "epoch-millis"];
const SPREADSHEET = new Set([".xlsx", ".xls", ".xlsb", ".ods", ".xlsm"]);

// ── independent reimplementation of the mapping ──────────────────────────────

const pad = (n: number, w: number) => String(Math.abs(n)).padStart(w, "0");

function civilToIso([y, mo, d, h, mi, s, ms]: Civil): string {
  return `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}T${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}

function civilToEpochMillis([y, mo, d, h, mi, s, ms]: Civil): number {
  // Date.UTC maps years 0-99 into 1900+, so set the year explicitly.
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(h, mi, s, ms);
  return dt.getTime();
}

function civilToSerial(civil: Civil): number {
  const [, , , h, mi, s, ms] = civil;
  const msOfDay = h * 3_600_000 + mi * 60_000 + s * 1_000 + ms;
  const days = (civilToEpochMillis(civil) - msOfDay) / 86_400_000 + 25_569;
  return days + msOfDay / 86_400_000;
}

function civilTo(civil: Civil, policy: DatePolicy): string | number {
  if (policy === "iso") return civilToIso(civil);
  if (policy === "epoch-millis") return civilToEpochMillis(civil);
  return civilToSerial(civil);
}

function durationTo(days: number, policy: DatePolicy): string | number {
  if (policy === "serial") return days;
  const totalMs = Math.round(days * 86_400_000);
  if (policy === "epoch-millis") return totalMs;
  const sign = totalMs < 0 ? "-" : "";
  const abs = Math.abs(totalMs);
  const [h, m, s, ms] = [
    Math.floor(abs / 3_600_000),
    Math.floor(abs / 60_000) % 60,
    Math.floor(abs / 1_000) % 60,
    abs % 1_000,
  ];
  return ms === 0 ? `${sign}PT${h}H${m}M${s}S` : `${sign}PT${h}H${m}M${s}.${pad(ms, 3)}S`;
}

function parseIsoDateTime(str: string): Civil | null {
  // Anchored at both ends: a trailing "Z" or "+05:00" makes the value an
  // instant, which a civil datetime cannot hold, and a truncated "T12:34"
  // cannot be read in full. Both must pass through untouched rather than be
  // half-converted, so neither may match here.
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?)?$/.exec(str);
  if (!m) return null;
  const [y, mo, d, h, mi, sec] = [+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  const frac = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
  return [y, mo, d, h, mi, sec, frac];
}

function parseIsoDuration(str: string): number | null {
  const m = /^(-?)P(?:([\d.]+)W)?(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?)?$/.exec(str);
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  if (!w && !d && !h && !mi && !s) return null;
  const days =
    (w ? +w * 7 : 0) + (d ? +d : 0) + (h ? +h / 24 : 0) + (mi ? +mi / 1440 : 0) + (s ? +s / 86400 : 0);
  return sign === "-" ? -days : days;
}

function expected(cell: NeutralCell, policy: DatePolicy): Cell {
  switch (cell.t) {
    case "empty":
      return null;
    case "str":
    case "err":
      return cell.v;
    case "int":
      return cell.v;
    case "float":
      return Number.isFinite(cell.v) ? cell.v : null;
    case "bool":
      return cell.v;
    case "datetime":
      return cell.duration ? durationTo(cell.serial, policy) : civilTo(cell.civil, policy);
    case "dtiso": {
      const civil = parseIsoDateTime(cell.v);
      return civil === null ? cell.v : civilTo(civil, policy);
    }
    case "duriso": {
      const days = parseIsoDuration(cell.v);
      return days === null ? cell.v : durationTo(days, policy);
    }
    default:
      // Exhaustive over NeutralCell, so this only fires if the dumper grows a
      // variant this file has not been taught about.
      throw new Error(`unknown neutral cell type ${(cell as { t: string }).t}`);
  }
}

// ── comparison ───────────────────────────────────────────────────────────────

const EPSILON = 1e-9;
let looseFloatMatches = 0;

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === "number" && typeof b === "number") {
    const scale = Math.max(Math.abs(a), Math.abs(b), 1);
    if (Math.abs(a - b) / scale < EPSILON) {
      looseFloatMatches++;
      return true;
    }
  }
  return false;
}

// ── run ──────────────────────────────────────────────────────────────────────

const files = [corpus, crafted].flatMap((dir) => {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((f) => SPREADSHEET.has(extname(f).toLowerCase()))
    .sort()
    .map((f) => join(dir, f));
});

interface Divergence {
  file: string;
  sheet?: string;
  policy?: DatePolicy;
  what: string;
}

interface FormatStats {
  files: number;
  sheets: number;
  cells: number;
  bad: number;
  skipped: number;
}

const divergences: Divergence[] = [];
const byFormat = new Map<string, FormatStats>();
// "No divergences" means nothing if the corpus never reached the interesting
// branches, so count what each cell type actually exercised.
const typeCoverage = new Map<string, number>();
const unopenable: Array<{ file: string; why: string }> = [];
const unreadableSheets: Array<{ file: string; sheet: string; why: string }> = [];
let sheetsChecked = 0;
let cellsChecked = 0;
let bothFailed = 0;

for (const path of files) {
  const file = basename(path);
  const ext = extname(file).toLowerCase();
  const stats = byFormat.get(ext) ?? { files: 0, sheets: 0, cells: 0, bad: 0, skipped: 0 };
  byFormat.set(ext, stats);
  stats.files++;

  const bytes = readFileSync(path);

  let native: NativeDump;
  try {
    native = JSON.parse(
      execFileSync(dumper, [path], { maxBuffer: 512 * 1024 * 1024, encoding: "utf8" }),
    ) as NativeDump;
  } catch (error) {
    divergences.push({ file, what: `native dumper crashed: ${String(error).slice(0, 80)}` });
    stats.bad++;
    continue;
  }

  // calamine could not open it at all. The binding must agree.
  if (native.error !== undefined) {
    let wasmOpened = true;
    try {
      sheetNames(bytes);
    } catch {
      wasmOpened = false;
    }
    if (wasmOpened) {
      divergences.push({ file, what: `native rejected (${native.error}) but wasm opened it` });
      stats.bad++;
    } else {
      bothFailed++;
      stats.skipped++;
      unopenable.push({ file, why: native.error });
    }
    continue;
  }

  // Sheet listing must match, in order.
  let names: string[];
  try {
    names = sheetNames(bytes);
  } catch (error) {
    divergences.push({
      file,
      what: `wasm could not list sheets: ${(error as Error).message.slice(0, 70)}`,
    });
    stats.bad++;
    continue;
  }
  const nativeNames = native.sheets.map((s) => s.name);
  if (names.join(" ") !== nativeNames.join(" ")) {
    divergences.push({
      file,
      what: `sheet names differ: wasm [${names}] vs native [${nativeNames}]`,
    });
    stats.bad++;
  }

  for (const sheet of native.sheets) {
    if (sheet.error !== undefined) {
      let wasmRead = true;
      try {
        readCellsParsed(bytes, { sheet: sheet.name });
      } catch {
        wasmRead = false;
      }
      if (wasmRead) {
        divergences.push({ file, sheet: sheet.name, what: "native failed to read but wasm read it" });
        stats.bad++;
      } else {
        // Agreement, but worth surfacing: a sheet neither side can read is a
        // sheet whose cells were never compared. Left silent, a broken fixture
        // looks exactly like a passing one.
        unreadableSheets.push({ file, sheet: sheet.name, why: sheet.error });
      }
      continue;
    }

    sheetsChecked++;
    stats.sheets++;

    const nativeRows = sheet.rows;

    for (const policy of POLICIES) {
      let rows: Cell[][];
      try {
        rows = readCellsParsed(bytes, { sheet: sheet.name, dates: policy });
      } catch (error) {
        divergences.push({
          file,
          sheet: sheet.name,
          policy,
          what: `wasm threw: ${(error as Error).message.slice(0, 70)}`,
        });
        stats.bad++;
        break;
      }

      if (rows.length !== nativeRows.length) {
        divergences.push({
          file,
          sheet: sheet.name,
          policy,
          what: `row count ${rows.length} vs native ${nativeRows.length}`,
        });
        stats.bad++;
        break;
      }

      let reported = 0;
      for (let r = 0; r < nativeRows.length; r++) {
        const nativeRow = nativeRows[r]!;
        const gotRow = rows[r] ?? [];
        if (nativeRow.length !== gotRow.length) {
          divergences.push({
            file,
            sheet: sheet.name,
            policy,
            what: `row ${r} width ${gotRow.length} vs native ${nativeRow.length}`,
          });
          stats.bad++;
          break;
        }
        for (let c = 0; c < nativeRow.length; c++) {
          const nativeCell = nativeRow[c]!;
          if (policy === "iso") {
            cellsChecked++;
            stats.cells++;
            typeCoverage.set(nativeCell.t, (typeCoverage.get(nativeCell.t) ?? 0) + 1);
          }
          const want = expected(nativeCell, policy);
          if (!same(want, gotRow[c]) && reported < 3) {
            reported++;
            stats.bad++;
            divergences.push({
              file,
              sheet: sheet.name,
              policy,
              what: `cell (${r},${c}) [${nativeCell.t}] got ${JSON.stringify(gotRow[c])} want ${JSON.stringify(want)}`,
            });
          }
        }
        if (reported >= 3) break;
      }
    }
  }
}

console.log(`\ncorpus: ${files.length} spreadsheets, ${sheetsChecked} sheets, ${cellsChecked} cells`);
console.log(`policies: ${POLICIES.join(", ")}  (${cellsChecked * POLICIES.length} cell comparisons)\n`);

console.log(`  ${"format".padEnd(8)} ${"files".padEnd(6)} ${"sheets".padEnd(7)} ${"cells".padEnd(9)} unopenable  divergences`);
for (const [ext, s] of [...byFormat].sort()) {
  console.log(
    `  ${ext.padEnd(8)} ${String(s.files).padEnd(6)} ${String(s.sheets).padEnd(7)} ${String(s.cells).padEnd(9)} ${String(s.skipped).padEnd(11)} ${s.bad}`,
  );
}

console.log("\ncell types actually exercised (a branch with 0 here is untested):\n");
const ALL_TYPES = ["empty", "str", "int", "float", "bool", "datetime", "dtiso", "duriso", "err"];
for (const t of ALL_TYPES) {
  const n = typeCoverage.get(t) ?? 0;
  console.log(`  ${t.padEnd(9)} ${n === 0 ? "0  <- NOT COVERED" : n}`);
}

if (unreadableSheets.length) {
  console.log(`\n${unreadableSheets.length} sheet(s) neither side could read — their cells were NOT compared:`);
  for (const u of unreadableSheets) {
    console.log(`  ${(u.file + " / " + u.sheet).padEnd(40)} ${u.why.slice(0, 55)}`);
  }
}

if (bothFailed) {
  console.log(`\n${bothFailed} file(s) rejected by both native and wasm (agreement):`);
  for (const u of unopenable) console.log(`  ${u.file.padEnd(34)} ${u.why.slice(0, 60)}`);
}
if (looseFloatMatches) console.log(`${looseFloatMatches} float(s) matched within ${EPSILON} rather than exactly`);

if (divergences.length) {
  console.log(`\n${divergences.length} divergence(s):\n`);
  for (const d of divergences.slice(0, 40)) {
    const where = [d.file, d.sheet, d.policy].filter(Boolean).join(" / ");
    console.log(`  ${where}\n      ${d.what}`);
  }
  if (divergences.length > 40) console.log(`  ... and ${divergences.length - 40} more`);
} else {
  console.log("\nno divergences — the binding matches calamine on every cell of the corpus");
}
console.log();

process.exitCode = divergences.length ? 1 : 0;
