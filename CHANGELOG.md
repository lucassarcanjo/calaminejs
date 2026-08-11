# Changelog

Notable changes per release. Dates are ISO-8601. This project follows
[semantic versioning](https://semver.org/); before 1.0, minor bumps may break.

## Unreleased

### Added

- `readCellsParsed` and `toJsonParsed` — `JSON.parse` plus the return type.
  Overloads follow `tagged` and `header`, so `Cell[][]`, `TaggedCell[][]`,
  `Row[]` and `TaggedRow[]` are reachable without a cast. The string-returning
  `readCells` and `toJson` are unchanged and still the cheaper path when the
  JSON is being forwarded rather than inspected.
- Type declarations for `calamine/slim`, which previously borrowed the default
  entry's and so promised a `ready()` it does not export while giving no types
  at all for the `init`/`initSync` it does. Those now return wasm-bindgen's
  `InitOutput`, so `memory` is reachable.
- A top-level `types` field and `typesVersions`, giving TypeScript on the legacy
  `moduleResolution: node` declarations it could not previously see at all.
- Third-party licence attribution (`THIRD-PARTY-LICENSES.md`), generated from
  `Cargo.lock` for the `wasm32-unknown-unknown` target and enforced in CI. The
  published `.wasm` statically links ~50 crates whose notices have to ship with
  it.
- `prepack` gate: builds, smoke-checks, and verifies every `exports` target
  resolves on disk before a tarball is cut. `dist/` is generated and gitignored,
  so without this a publish from a clean checkout ships a package whose entry
  points all 404.
- Package metadata needed to publish — `repository`, `homepage`, `bugs`,
  `author`, `engines`.
- `CONTRIBUTING.md` and `SECURITY.md`.

### Changed

- Published as `calamine` on npm, and the README leads with that name. Import
  specifiers and the two subpaths moved with it — `calamine/inline`,
  `calamine/slim` — as did the error the streaming entry throws, which names the
  package a caller would have installed. The repository is still `calaminejs`,
  and so is `docs/comparison.md`, where having both names available is what keeps
  this binding distinguishable from the crate it wraps.
- Declarations moved out of `scripts/build.mjs`, where they were an escaped
  template literal, into checked files under `types/`. The test suites are
  TypeScript and import the package by name, so the declarations are verified
  against the built artifact rather than asserted.
- The streaming entry's "await ready()" error now names the function the caller
  actually called, not the one it delegates to.
- No longer `private: true`.

## 0.1.0 — unreleased

First cut. Not on npm.

- calamine 0.36 compiled to WebAssembly, reading `.xlsx` / `.xls` / `.xlsb` /
  `.ods` from bytes.
- Five entry points behind one `exports` map — `node`, `workerd`, browser
  streaming, `/inline` (base64), `/slim` (bring your own wasm) — sharing a
  single 370 KB gzipped binary.
- Outputs: `sheetNames`, `readCells`, `toJson`, `toCsv`, `toMarkdown`.
- Date policies `iso` (default), `serial` and `epoch-millis`, treating
  spreadsheet dates as civil time rather than instants. Durations are ISO-8601
  durations, not dates near 1900.
- `tagged: true` preserves each cell's type as `{ t, v }`.
- Unknown options throw rather than being ignored.
- Differential test suite over calamine's 135-file corpus, with expectations
  recomputed in JavaScript; adversarial suite over 16 hostile inputs; browser
  suite in a real Chromium.
- CI: build once, then Rust, Node and browser jobs against the same binary.
