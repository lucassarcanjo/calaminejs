import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readCells } from "../dist/node.js";
import { CASES } from "./make-date-fixture.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const buf = readFileSync(join(here, "fixtures", "dates.xlsx"));
const read = (dates) => JSON.parse(readCells(buf, { dates })).map((r) => r[1]);

const iso = read("iso");
const serial = read("serial");
const epoch = read("epoch-millis");

let failures = 0;
console.log('\ndates: "iso" (default)\n');
console.log(`  ${"case".padEnd(22)} ${"got".padEnd(26)} expected`);
for (let i = 0; i < CASES.length; i++) {
  const ok = iso[i] === CASES[i].iso;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${CASES[i].label.padEnd(20)} ${String(iso[i]).padEnd(26)} ${CASES[i].iso}`,
  );
}

console.log("\nsame cells under the other policies\n");
console.log(`  ${"case".padEnd(22)} ${"serial".padEnd(20)} epoch-millis`);
for (let i = 0; i < CASES.length; i++) {
  const { kind, label } = CASES[i];
  let rendered;
  if (kind === "datetime") rendered = `${epoch[i]}  -> ${new Date(epoch[i]).toISOString()}`;
  else if (kind === "duration") rendered = `${epoch[i]}  -> ${epoch[i] / 3_600_000} hours`;
  else rendered = String(epoch[i]);
  console.log(`  ${label.padEnd(22)} ${String(serial[i]).padEnd(20)} ${rendered}`);
}

// The policy is opt-in, so an unknown value must be a loud error, not a default.
try {
  readCells(buf, { dates: "local" });
  console.log("\n✗ unknown dates policy was silently accepted");
  failures++;
} catch (e) {
  console.log(`\n✓ unknown policy rejected: ${e.message}`);
}

console.log(failures === 0 ? "\nall date cases pass\n" : `\n${failures} FAILING\n`);
process.exitCode = failures === 0 ? 0 : 1;
