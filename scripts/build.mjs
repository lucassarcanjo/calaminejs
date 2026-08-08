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
const types = join(root, "types");

const GLUE = "calamine_wasm.js";
const WASM = "calamine_wasm_bg.wasm";

// The functions each entry re-exports. Deliberately not parseOnly or
// readCellsAsValue — those are benchmark instrumentation and the benchmarks
// import them from the glue directly.
const API = ["sheetNames", "readCells", "toJson", "toCsv", "toMarkdown"];

// Imported rather than re-exported straight through, because the parsed helpers
// below need the names in local scope. `export { ... }` on a bare re-export does
// not bind them.
const importApi = `import { ${API.join(", ")} } from "./${GLUE}";`;
const exportApi = `export { ${API.join(", ")} };`;

// The typed way out of `JSON.parse` returning `any`. Kept as thin wrappers in
// each entry rather than a shared module: dist/ has no internal imports beyond
// the glue, and one shared file would have to be listed in every entry's
// sideEffects and exports for no gain over four duplicated lines.
const PARSED = `
/** \`readCells\`, parsed. The types follow \`tagged\`; see index.d.ts. */
export function readCellsParsed(bytes, options) {
  return JSON.parse(readCells(bytes, options));
}

/** \`toJson\`, parsed. The types follow \`header\` and \`tagged\`. */
export function toJsonParsed(bytes, options) {
  return JSON.parse(toJson(bytes, options));
}
`;

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

const wasmBytes = readFileSync(join(pkg, WASM));

// ── node / bun / deno ────────────────────────────────────────────────────────
// Bun and Deno both resolve the `node` condition and both implement node:fs,
// so all three share this entry. Synchronous: no top-level await, which would
// make the module unrequirable from CJS.
writeFileSync(
  join(dist, "node.js"),
  `import { readFileSync } from "node:fs";
import { initSync } from "./${GLUE}";
${importApi}

initSync({ module: readFileSync(new URL("./${WASM}", import.meta.url)) });

${exportApi}
${PARSED}
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
${importApi}

initSync({ module: wasmModule });

${exportApi}
${PARSED}
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

// The name is passed separately from the function so the message names what the
// caller actually called: a parsed helper delegates to readCells, and reporting
// *that* sends people looking for a function they never wrote.
function guard(name, fn) {
  return (...args) => {
    if (!initialised) {
      throw new Error(
        \`calaminejs: await ready() before calling \${name}() — this environment loads the wasm asynchronously\`,
      );
    }
    return fn(...args);
  };
}

${API.map((n) => `export const ${n} = guard("${n}", (...args) => api.${n}(...args));`).join("\n")}

/** \`readCells\`, parsed. The types follow \`tagged\`; see index.d.ts. */
export const readCellsParsed = guard("readCellsParsed", (...args) =>
  JSON.parse(api.readCells(...args)),
);

/** \`toJson\`, parsed. The types follow \`header\` and \`tagged\`. */
export const toJsonParsed = guard("toJsonParsed", (...args) => JSON.parse(api.toJson(...args)));
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
${importApi}

// atob rather than Buffer: this entry has to work in a browser too.
const binary = atob(wasmBase64);
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

initSync({ module: bytes });

${exportApi}
${PARSED}
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
//
// No ready() here, deliberately: initialisation is the caller's, and it is done
// when initSync returns or the init promise resolves.
${importApi}

export { default as init, initSync } from "./${GLUE}";
${exportApi}
${PARSED}`,
);

// ── types ────────────────────────────────────────────────────────────────────
// Copied from types/, not generated here. They used to be one long template
// literal in this file, which is how `./slim` ended up declaring a `ready()`
// that entry does not export and no types at all for the `init`/`initSync` it
// does. As real files they are checked: `bun run typecheck` reads them through
// the test suites, so a declaration that does not match the runtime fails here
// rather than in a user's editor.
for (const file of ["api.d.ts", "index.d.ts", "slim.d.ts"]) {
  cpSync(join(types, file), join(dist, file));
}

// wasm-pack's own declarations for the glue. Not part of the public API — the
// exports map points nowhere near them — but dist/calamine_wasm.js does ship,
// and the adversarial suite and the benchmarks import it directly for the
// instrumentation entry points and the WebAssembly.Memory. Copying the types
// they already come with is free and stops those callers falling back to `any`.
cpSync(join(pkg, "calamine_wasm.d.ts"), join(dist, "calamine_wasm.d.ts"));

const sizes = ["node.js", "workerd.js", "streaming.js", "inline.js", "slim.js", WASM].map((f) => {
  const size = readFileSync(join(dist, f)).length;
  return `  ${f.padEnd(20)} ${(size / 1024).toFixed(1)} KB`;
});
console.log(`assembled dist/\n${sizes.join("\n")}`);
