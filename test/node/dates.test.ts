// Imported by package name, not by path into dist/. Node self-references
// through the "exports" map, so this resolves the same way a user's import
// does — the `node` condition, and the declarations that condition advertises.
// A relative import would skip both and test something nobody ships.
import { readFileSync } from "node:fs";
import { readCellsParsed } from "calaminejs";
import type { Cell, DatePolicy } from "calaminejs";
import { CASES } from "../support/make-date-fixture.ts";
import { datesFixture } from "../support/paths.ts";

const buf = readFileSync(datesFixture);

// Column B of each row is the cell under test. `readCellsParsed` types this as
// Cell[][] without a cast, which is the point of it existing.
const read = (dates: DatePolicy): Cell[] =>
  readCellsParsed(buf, { dates }).map((row) => row[1] ?? null);

const iso = read("iso");
const serial = read("serial");
const epoch = read("epoch-millis");

let failures = 0;
console.log('\ndates: "iso" (default)\n');
console.log(`  ${"case".padEnd(22)} ${"got".padEnd(26)} expected`);
for (const [i, expected] of CASES.entries()) {
  const ok = iso[i] === expected.iso;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${expected.label.padEnd(20)} ${String(iso[i]).padEnd(26)} ${expected.iso}`,
  );
}

console.log("\nsame cells under the other policies\n");
console.log(`  ${"case".padEnd(22)} ${"serial".padEnd(20)} epoch-millis`);
for (const [i, { kind, label }] of CASES.entries()) {
  const ms = epoch[i];
  let rendered: string;
  if (kind === "datetime" && typeof ms === "number") {
    rendered = `${ms}  -> ${new Date(ms).toISOString()}`;
  } else if (kind === "duration" && typeof ms === "number") {
    rendered = `${ms}  -> ${ms / 3_600_000} hours`;
  } else {
    rendered = String(ms);
  }
  console.log(`  ${label.padEnd(22)} ${String(serial[i]).padEnd(20)} ${rendered}`);
}

// The policy is opt-in, so an unknown value must be a loud error, not a default.
// Cast at the call: rejecting this is a *runtime* guarantee, and the whole point
// is that it holds for callers who are not using TypeScript at all.
try {
  readCellsParsed(buf, { dates: "local" as DatePolicy });
  console.log("\n✗ unknown dates policy was silently accepted");
  failures++;
} catch (error) {
  console.log(`\n✓ unknown policy rejected: ${(error as Error).message}`);
}

console.log(failures === 0 ? "\nall date cases pass\n" : `\n${failures} FAILING\n`);
process.exitCode = failures === 0 ? 0 : 1;
