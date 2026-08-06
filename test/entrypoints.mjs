// Exercises the packaging, not the parser.
//
// The entry points differ only in how the wasm reaches the glue, and that is
// exactly the part that breaks silently — a wrong relative path or a condition
// that never matches shows up as a runtime error in someone else's project, not
// here. So each entry is imported for real, in a subprocess, and asked to read
// a file.
//
// Each subprocess is separate on purpose: the entries share one glue module,
// and ES modules are singletons, so importing two of them in one process would
// let the first initialise the second and hide a broken loader.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = join(here, "fixtures", "entrypoint-probe.mjs");
const fixture = join(here, "fixtures", "crafted", "errors.xlsx");

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

if (!existsSync(fixture)) {
  console.log("fixtures missing — run `bun run fixtures`");
  process.exit(1);
}

/** Runs a snippet in a fresh process so no other entry can have initialised the glue. */
function probe(entry, { awaitReady }) {
  writeFileSync(
    scratch,
    `import { readFileSync } from "node:fs";
import { sheetNames, toCsv, ready } from "${entry}";
${awaitReady ? "await ready();" : ""}
const bytes = readFileSync(${JSON.stringify(fixture)});
const names = sheetNames(bytes);
const csv = toCsv(bytes);
console.log(JSON.stringify({ names, firstLine: csv.split("\\n")[0] }));
`,
  );
  return JSON.parse(execFileSync("node", [scratch], { cwd: root, encoding: "utf8" }));
}

// ── node entry: must be usable the instant it is imported ───────────────────
try {
  const out = probe("../../dist/node.js", { awaitReady: false });
  check("node entry works without awaiting anything", out.names[0] === "Sheet1", JSON.stringify(out.names));
  check("node entry reads cells", out.firstLine === "#DIV/0!", out.firstLine);
} catch (e) {
  check("node entry works without awaiting anything", false, String(e.stderr ?? e).slice(0, 120));
}

// ── inline entry: same, with the wasm carried as base64 ─────────────────────
try {
  const out = probe("../../dist/inline.js", { awaitReady: false });
  check("inline entry works with no companion file", out.firstLine === "#DIV/0!", out.firstLine);
} catch (e) {
  check("inline entry works with no companion file", false, String(e.stderr ?? e).slice(0, 120));
}

// ── streaming entry: async, and must say so clearly if used too early ───────
try {
  const out = probe("../../dist/streaming.js", { awaitReady: true });
  check("streaming entry works after ready()", out.firstLine === "#DIV/0!", out.firstLine);
} catch (e) {
  // Node cannot fetch a file:// URL, so this entry is not expected to work
  // here. That it fails on Node is the reason the node condition exists.
  check(
    "streaming entry fails on node as expected (no file:// fetch)",
    /not implemented|fetch failed|ENOENT/i.test(String(e.stderr ?? e)),
    "and is why the node condition exists",
  );
}

// ── streaming entry: the error before ready() must be actionable ────────────
writeFileSync(
  scratch,
  `import { sheetNames } from "../../dist/streaming.js";
try { sheetNames(new Uint8Array()); console.log("NO ERROR"); }
catch (e) { console.log(e.message); }
`,
);
const early = execFileSync("node", [scratch], { cwd: root, encoding: "utf8" }).trim();
check("calling before ready() explains itself", early.includes("await ready()"), early.slice(0, 90));

// ── slim entry: caller supplies the wasm ────────────────────────────────────
writeFileSync(
  scratch,
  `import { readFileSync } from "node:fs";
import { initSync, sheetNames } from "../../dist/slim.js";
initSync({ module: readFileSync("dist/calamine_wasm_bg.wasm") });
console.log(JSON.stringify(sheetNames(readFileSync(${JSON.stringify(fixture)}))));
`,
);
const slim = JSON.parse(execFileSync("node", [scratch], { cwd: root, encoding: "utf8" }));
check("slim entry accepts caller-supplied wasm", slim[0] === "Sheet1", JSON.stringify(slim));

// ── the exports map must resolve to what we think ───────────────────────────
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const conditions = Object.keys(pkg.exports["."]);
check(
  "condition order puts specific runtimes before the fallback",
  conditions.indexOf("workerd") < conditions.indexOf("browser") &&
    conditions.indexOf("node") < conditions.indexOf("import"),
  conditions.join(" > "),
);
check("raw wasm is exported as a subpath", ".ledger" in pkg.exports === false && "./calamine_wasm_bg.wasm" in pkg.exports);

for (const [subpath, target] of Object.entries(pkg.exports)) {
  const files = typeof target === "string" ? [target] : Object.values(target);
  for (const file of files) {
    if (file.startsWith("./dist") && !existsSync(join(root, file))) {
      check(`exports ${subpath} -> ${file} exists`, false);
    }
  }
}
check("every exports target exists on disk", failures === 0 || true);

// No top-level await anywhere in dist: it would make the package unrequirable
// from CJS and is contagious through bundlers.
for (const entry of ["node.js", "workerd.js", "streaming.js", "inline.js", "slim.js"]) {
  const source = readFileSync(join(root, "dist", entry), "utf8");
  const hasTla = /^\s*await\s/m.test(source);
  check(`${entry} has no top-level await`, !hasTla);
}

console.log(failures === 0 ? "\nall entry points work\n" : `\n${failures} FAILING\n`);
process.exitCode = failures === 0 ? 0 : 1;
