// Regenerates THIRD-PARTY-LICENSES.md from Cargo.lock.
//
// A wrapper around `cargo about` rather than a direct call, because a few
// upstream licence files are stored with CRLF endings and cargo-about copies
// them through verbatim. Committing those means git's own normalisation and the
// generator disagree about the file forever, so `licenses:check` fails on a
// clean tree and the CI gate becomes noise. Normalising here makes the output
// byte-stable, which is what lets the check be a hard failure.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "THIRD-PARTY-LICENSES.md");

try {
  execFileSync("cargo", ["about", "generate", "--config", "about.toml", "about.hbs", "-o", out], {
    cwd: root,
    stdio: ["ignore", "inherit", "inherit"],
  });
} catch (error) {
  if (error.code === "ENOENT" || /no such command/.test(String(error.stderr ?? ""))) {
    console.error("\ncargo-about is not installed:\n\n  cargo install cargo-about --features cli\n");
    process.exit(1);
  }
  throw error;
}

// Three normalisations, each fixing a way the same input produces different
// bytes on different machines. The file is committed and diffed in CI, so any
// of them turns the gate into noise — and a gate that cries wolf gets bypassed,
// which for a licence obligation is the expensive failure.
//
//   CRLF          a few upstream licence files use it and are copied verbatim,
//                 so git's normalisation and the generator disagree forever.
//   trailing ws   varies between the same file's copies.
//   blank runs    cargo-about merges the copyright statements of crates that
//                 share a licence text, and the merge follows filesystem
//                 iteration order — which differs between macOS and Linux, and
//                 showed up as miniz_oxide gaining one blank line in CI.
//
// All three are whitespace. None can change which licence applies to which
// crate, or drop a copyright line — the parts that carry legal weight survive
// untouched, which is what makes this safe to do to an attribution file.
const generated = readFileSync(out, "utf8");
const normalised = generated
  .replace(/\r\n/g, "\n")
  .replace(/[ \t]+$/gm, "")
  .replace(/\n{3,}/g, "\n\n");
if (normalised !== generated) writeFileSync(out, normalised);

const crates = new Set(normalised.match(/^### .+$/gm)?.flatMap((h) => h.split("—")[1].split(",")));
console.log(`✓ THIRD-PARTY-LICENSES.md — ${crates.size} crates attributed`);
