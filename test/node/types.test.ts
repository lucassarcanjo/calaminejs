// Asserts the shipped declarations, at compile time and at runtime.
//
// This suite exists because of a bug it would have caught. `types/slim.d.ts`
// declared `initSync` as returning `void` — internally consistent, so `tsc` was
// perfectly happy, and every other suite passed. It was still wrong: the real
// function returns wasm-bindgen's `InitOutput`, and `memory` is most of the
// reason to use this entry at all. A declaration nothing consumes is not
// checked by anything, it is only parsed.
//
// So the rule here is that every assertion is made twice: once as a type, and
// once against the value at runtime. Either alone can be quietly wrong.
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Imported by path rather than by package name on purpose: this is the one
// place that needs to reach a *specific* entry's declarations rather than
// whichever one the exports map picks for this runtime.
import { initSync, sheetNames as slimSheetNames } from "../../dist/slim.js";
import * as slim from "../../dist/slim.js";
import * as main from "calaminejs";
import type { Cell, JsonOptions, ReadOptions, Row, TaggedCell, TaggedRow } from "calaminejs";
import { crafted, dist } from "../support/paths.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── the parsed helpers return what they claim ────────────────────────────────
//
// Never called. Its body exists to be type-checked: each annotation is an
// assertion that the overload resolved to that branch, and a wrong one is a
// compile error rather than a silent `any`.
function _overloadsResolveCorrectly(
  bytes: Uint8Array,
  readOptions: ReadOptions,
  jsonOptions: JsonOptions,
): void {
  const raw: string = main.readCells(bytes);
  const rawJson: string = main.toJson(bytes);

  const untagged: Cell[][] = main.readCellsParsed(bytes);
  const tagged: TaggedCell[][] = main.readCellsParsed(bytes, { tagged: true });
  const rows: Row[] = main.toJsonParsed(bytes);
  const taggedRows: TaggedRow[] = main.toJsonParsed(bytes, { tagged: true });
  const arrays: Cell[][] = main.toJsonParsed(bytes, { header: "none" });
  const taggedArrays: TaggedCell[][] = main.toJsonParsed(bytes, {
    header: "none",
    tagged: true,
  });

  // A widened options object falls to the untagged overload. Asserted rather
  // than left implicit: it is the documented sharp edge of doing this with
  // overloads instead of a generic, and it should not change silently.
  const widened: Cell[][] = main.readCellsParsed(bytes, readOptions);
  const widenedJson: Row[] = main.toJsonParsed(bytes, jsonOptions);

  void raw, rawJson, untagged, tagged, rows, taggedRows, arrays, taggedArrays, widened, widenedJson;
}
void _overloadsResolveCorrectly;

// ── slim: the surface that regressed ────────────────────────────────────────
const wasmBytes = readFileSync(join(dist, "calamine_wasm_bg.wasm"));

// Typed as InitOutput. If this goes back to `void`, `.memory` stops compiling.
const instance = initSync({ module: wasmBytes });
const memory: WebAssembly.Memory = instance.memory;

check(
  "slim initSync returns the instance, not void",
  memory instanceof WebAssembly.Memory,
  `${(memory.buffer.byteLength / 1024 / 1024).toFixed(1)} MB`,
);

// The declaration says slim has no ready(). Verify the runtime agrees, since a
// .d.ts that omits something the module exports is just as wrong as one that
// invents something it does not.
check("slim has no ready() at runtime either", !("ready" in slim), Object.keys(slim).sort().join(","));
check("the default entry does have ready()", typeof main.ready === "function");

// Both entries expose the same read surface, so code can move between them.
const shared = ["sheetNames", "readCells", "toJson", "toCsv", "toMarkdown", "readCellsParsed", "toJsonParsed"];
const missingFromSlim = shared.filter((name) => !(name in slim));
check("slim exposes the full read API", missingFromSlim.length === 0, missingFromSlim.join(",") || "all present");

// ── the declarations match the values ───────────────────────────────────────
const book = readFileSync(join(crafted, "errors.xlsx"));
check("slim works once the caller has initialised it", slimSheetNames(book)[0] === "Sheet1");

const taggedCell = main.readCellsParsed(book, { tagged: true })[0]?.[0];
check(
  "a tagged cell really is { t, v }",
  taggedCell !== null && typeof taggedCell === "object" && "t" in taggedCell && "v" in taggedCell,
  JSON.stringify(taggedCell),
);

const plainCell = main.readCellsParsed(book)[0]?.[0];
check("an untagged cell really is a bare value", typeof plainCell === "string", JSON.stringify(plainCell));

console.log(failures === 0 ? "\ndeclarations match the runtime\n" : `\n${failures} FAILING\n`);
process.exitCode = failures === 0 ? 0 : 1;
