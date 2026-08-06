// Assembles dist/ from the wasm-pack output.
//
// wasm-pack --target web gives one glue module with an async `init()` and a
// sync `initSync()`. Everything here is about getting the .wasm bytes to that
// glue, which is the one thing every runtime does differently:
//
//   node/bun/deno  node:fs + initSync            — synchronous, ready on import
//   workerd        import the .wasm as a module  — Workers want a Module, not bytes
//   browser/bundler fetch + instantiateStreaming — async, so `await ready()`
//   inline         base64 in the JS              — opt-in, for no-companion-asset builds
//   slim           you supply it                 — the escape hatch
//
// All entries import the same glue module. ES modules are singletons, so
// whichever one initialises, the rest see an initialised instance.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "pkg");
const dist = join(root, "dist");

const GLUE = "calamine_wasm.js";
const WASM = "calamine_wasm_bg.wasm";

// The functions each entry re-exports. Deliberately not parseOnly or
// readCellsAsValue — those are benchmark instrumentation and the benchmarks
// import them from the glue directly.
const API = ["sheetNames", "readCells", "toJson", "toCsv", "toMarkdown"];

if (!process.argv.includes("--no-wasm")) {
  console.log("building wasm...");
  execFileSync("wasm-pack", ["build", "--release", "--target", "web", "--out-dir", "pkg"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(pkg, GLUE), join(dist, GLUE));
cpSync(join(pkg, WASM), join(dist, WASM));

const reexport = `export { ${API.join(", ")} } from "./${GLUE}";`;
const wasmBytes = readFileSync(join(pkg, WASM));

// ── node / bun / deno ────────────────────────────────────────────────────────
// Bun and Deno both resolve the `node` condition and both implement node:fs,
// so all three share this entry. Synchronous: no top-level await, which would
// make the module unrequirable from CJS.
writeFileSync(
  join(dist, "node.js"),
  `import { readFileSync } from "node:fs";
import { initSync } from "./${GLUE}";

initSync({ module: readFileSync(new URL("./${WASM}", import.meta.url)) });

${reexport}

/** Already initialised on this runtime. Here so the same code runs anywhere. */
export function ready() {
  return Promise.resolve();
}
`,
);

// ── cloudflare workers ───────────────────────────────────────────────────────
// wrangler resolves a .wasm import to a compiled WebAssembly.Module, which is
// what Workers want — they will not compile a large module from bytes inside a
// request handler.
writeFileSync(
  join(dist, "workerd.js"),
  `import wasmModule from "./${WASM}";
import { initSync } from "./${GLUE}";

initSync({ module: wasmModule });

${reexport}

/** Already initialised on this runtime. Here so the same code runs anywhere. */
export function ready() {
  return Promise.resolve();
}
`,
);

// ── browsers and bundlers ────────────────────────────────────────────────────
// The only entry that cannot be ready on import. The glue's own default init
// resolves the .wasm with `new URL(..., import.meta.url)`, which Vite, webpack
// and Rollup rewrite into a hashed asset.
//
// Calling before `ready()` would otherwise fail somewhere inside the glue with
// an error about a null pointer, so each function is wrapped to say what is
// actually wrong.
writeFileSync(
  join(dist, "streaming.js"),
  `import init from "./${GLUE}";
import * as api from "./${GLUE}";

let started;
let initialised = false;

/** Loads and compiles the wasm. Safe to call more than once. */
export function ready() {
  started ??= init().then(() => {
    initialised = true;
  });
  return started;
}

function guard(name) {
  return (...args) => {
    if (!initialised) {
      throw new Error(
        \`calaminejs: await ready() before calling \${name}() — this environment loads the wasm asynchronously\`,
      );
    }
    return api[name](...args);
  };
}

${API.map((n) => `export const ${n} = guard("${n}");`).join("\n")}
`,
);

// ── inline ───────────────────────────────────────────────────────────────────
// Opt-in only. Base64 costs a third more bytes, is parsed as JS text on every
// load, and gives up streaming compilation and separate caching of the binary.
// It exists for builds that genuinely cannot ship a companion asset.
writeFileSync(
  join(dist, "wasm-base64.js"),
  `// Generated. The wasm binary as base64.\nexport const wasmBase64 = "${wasmBytes.toString("base64")}";\n`,
);
writeFileSync(
  join(dist, "inline.js"),
  `import { initSync } from "./${GLUE}";
import { wasmBase64 } from "./wasm-base64.js";

// atob rather than Buffer: this entry has to work in a browser too.
const binary = atob(wasmBase64);
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

initSync({ module: bytes });

${reexport}

/** Already initialised on this runtime. Here so the same code runs anywhere. */
export function ready() {
  return Promise.resolve();
}
`,
);

// ── slim ─────────────────────────────────────────────────────────────────────
writeFileSync(
  join(dist, "slim.js"),
  `// Bring your own wasm. Pass bytes or a WebAssembly.Module to initSync, or a
// URL/Response/bytes to init, then use the API as normal.
export { default as init, initSync } from "./${GLUE}";

${reexport}
`,
);

// ── types ────────────────────────────────────────────────────────────────────
// Hand-written rather than wasm-pack's, which types every options bag as \`any\`.
writeFileSync(
  join(dist, "index.d.ts"),
  `/**
 * How a date or time cell is represented.
 *
 * A spreadsheet date is a civil (wall-clock) value with no timezone, while a JS
 * \`Date\` is an instant — converting one to the other has to invent an offset.
 * This picks who decides.
 */
export type DatePolicy =
  /** ISO-8601, no offset: \`2025-10-13T12:59:02.400\`. Also what \`Temporal.PlainDateTime.from()\` accepts. */
  | "iso"
  /** The raw Excel serial. */
  | "serial"
  /** Milliseconds since the Unix epoch, asserting the civil time is UTC. */
  | "epoch-millis";

/** A cell's type in the tagged shape. */
export type CellType = "num" | "str" | "bool" | "date" | "dur" | "err";

/** A cell when \`tagged: true\`. Empty cells are \`null\` rather than tagged. */
export type TaggedCell = { t: CellType; v: string | number | boolean } | null;

/** A cell when \`tagged\` is off. A date and text that looks like one are identical here. */
export type Cell = string | number | boolean | null;

export interface ReadOptions {
  /** Sheet name. Defaults to the first sheet. */
  sheet?: string;
  /** @default "iso" */
  dates?: DatePolicy;
  /** Wrap each cell as \`{ t, v }\` so its type survives. @default false */
  tagged?: boolean;
}

export interface JsonOptions extends ReadOptions {
  /** \`"first-row"\` keys objects by the header row; \`"none"\` returns arrays. @default "first-row" */
  header?: "first-row" | "none";
}

export interface CsvOptions extends Omit<ReadOptions, "tagged"> {
  /** Exactly one character. @default "," */
  delimiter?: string;
}

export type MarkdownOptions = Omit<ReadOptions, "tagged">;

/** Sheet names, in workbook order. */
export function sheetNames(bytes: Uint8Array): string[];

/** Rows of cells, as a JSON string. Parse it with \`JSON.parse\`. */
export function readCells(bytes: Uint8Array, options?: ReadOptions): string;

/** Rows as objects keyed by the header row, as a JSON string. */
export function toJson(bytes: Uint8Array, options?: JsonOptions): string;

/** RFC 4180 CSV, built in Rust so only one string crosses the boundary. */
export function toCsv(bytes: Uint8Array, options?: CsvOptions): string;

/** A GitHub-flavoured Markdown table, first row as the header. */
export function toMarkdown(bytes: Uint8Array, options?: MarkdownOptions): string;

/**
 * Resolves once the wasm is usable.
 *
 * On Node, Bun, Deno and Cloudflare Workers this is already true on import and
 * the promise is resolved. In a browser or a bundled app the wasm loads
 * asynchronously, so await this first. Awaiting it always is portable.
 */
export function ready(): Promise<void>;
`,
);

const sizes = ["node.js", "workerd.js", "streaming.js", "inline.js", "slim.js", WASM].map((f) => {
  const size = readFileSync(join(dist, f)).length;
  return `  ${f.padEnd(20)} ${(size / 1024).toFixed(1)} KB`;
});
console.log(`assembled dist/\n${sizes.join("\n")}`);
