// The README's opening example, kept runnable so it cannot rot.
//
// Run it with `node examples/js/quickstart.ts` after `bun run build` and
// `bun run fixtures`. It imports the package by name, which resolves through
// the exports map exactly as a consumer's would.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readCellsParsed, ready, sheetNames, toCsv } from "calaminejs";

// Resolved from this file, not the working directory, so the example runs from
// anywhere rather than only from the repo root.
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const bytes = readFileSync(join(repo, "test/fixtures/crafted/misc_types.xlsx"));

await ready();

console.log("sheetNames      :", sheetNames(bytes));
console.log("toCsv (line 1)  :", toCsv(bytes).split("\n")[0]);
console.log("readCellsParsed :", JSON.stringify(readCellsParsed(bytes)[0]));
console.log("tagged          :", JSON.stringify(readCellsParsed(bytes, { tagged: true })[0]));
