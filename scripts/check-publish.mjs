// The last gate before a tarball is cut.
//
// `dist/` is gitignored and generated, so a clean checkout has nothing to
// publish. Without this, `npm publish` from a fresh clone succeeds and ships a
// package whose every entry point 404s — a failure that only shows up in
// someone else's install. `prepack` runs the build first; this checks that the
// build produced what `exports` and `files` promise.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const problems = [];

// Every path the exports map can resolve to, flattened across conditions.
function targets(node) {
  if (typeof node === "string") return [node];
  return Object.values(node).flatMap(targets);
}

for (const [subpath, node] of Object.entries(pkg.exports)) {
  for (const target of targets(node)) {
    if (!existsSync(join(root, target))) {
      problems.push(`exports "${subpath}" points at ${target}, which does not exist`);
    }
  }
}

// The legacy-resolution fallbacks. These are the ones worth checking by machine:
// nothing in this repo consumes them, so a broken path here does not fail a
// test — it just silently makes the package untyped for everyone still on
// `moduleResolution: node`, which is a failure mode with no symptom locally.
if (pkg.types && !existsSync(join(root, pkg.types))) {
  problems.push(`"types" points at ${pkg.types}, which does not exist`);
}

for (const [pattern, paths] of Object.entries(pkg.typesVersions?.["*"] ?? {})) {
  for (const target of paths) {
    if (!existsSync(join(root, target))) {
      problems.push(`typesVersions "${pattern}" points at ${target}, which does not exist`);
    }
  }
}

// A subpath that resolves at runtime but has no legacy type mapping is untyped
// on node10. Not fatal — but silent, so it gets said out loud.
for (const subpath of Object.keys(pkg.exports)) {
  if (!subpath.startsWith("./") || subpath === "./package.json") continue;
  const bare = subpath.slice(2);
  if (bare.endsWith(".wasm")) continue;
  if (!pkg.typesVersions?.["*"]?.[bare]) {
    console.warn(`  ! "${subpath}" has no typesVersions entry — untyped on moduleResolution: node`);
  }
}

// Attribution is a licence condition, not a nicety: the wasm statically links
// calamine and its whole tree, and both MIT and Apache-2.0 require the notices
// to travel with the binary. Shipping without this file is a licence breach,
// so it fails the publish rather than warning.
for (const required of ["LICENSE", "THIRD-PARTY-LICENSES.md", "README.md"]) {
  if (!existsSync(join(root, required))) {
    problems.push(`${required} is listed in "files" but missing`);
  }
}

if (pkg.private) {
  problems.push('"private": true — npm will refuse to publish this');
}

if (problems.length) {
  console.error("\nnot publishable:\n");
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(`✓ publishable — ${Object.keys(pkg.exports).length} export subpaths resolve on disk`);
