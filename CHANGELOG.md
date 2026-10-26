# Changelog

Notable changes per release. Dates are ISO-8601. This project follows
[semantic versioning](https://semver.org/); before 1.0, minor bumps may break.

## 0.2.0 — 2026-10-26

Built on calamine 0.37.0 (was 0.36.1). Most of what changes is upstream's
parser getting more things right, but three of those fixes change what an
existing call returns for the same file, hence a minor bump rather than a patch.

### Added

- `workbookProperties(bytes)` — creator, title, subject, keywords, created and
  modified dates, application, company and the rest of `docProps/core.xml` and
  `docProps/app.xml`, new in calamine 0.37. Every field is present and `null`
  when unset. xlsx and xlsb only: calamine does not read properties from xls or
  ods, and those throw rather than returning nulls that would claim the file
  has none. `created` and `modified` are passed through as the file's W3CDTF
  strings; they carry an offset, so the `dates` policy does not apply.

### Changed

- **xlsx boolean cells must be `0`, `1`, `true` or `false`.** Anything else used
  to read as `true`; it now fails the sheet with `Unrecognized boolean cell
  value`. A file that relied on the old reading will throw where it returned.
- **East Asian built-in number formats (ids 27–36 and 50–58) are dates.** Cells
  using them came back as numbers and now come back as dates under whichever
  `dates` policy is in force — tagged `date` rather than `num`.
- **An `<x15:workbookPr>` extension no longer resets the 1904 date system.**
  Affected xlsx files had every date four years and a day early; they are now
  right.
- Date serials past 9999-12-31 clamp to that day. Previously a large enough
  serial in a hostile file could panic inside calamine, which under
  `panic = "abort"` takes the wasm instance with it.
- The wasm is 388 KB gzipped (757 KB raw), up from 372 KB, mostly zip 9 and
  quick-xml 0.42 coming in with calamine.

### Fixed (upstream, in calamine 0.37)

- xls sheets with an embedded chart no longer leak the chart's cells into the
  sheet.
- xlsx formula string results decode `_xHHHH_` escapes, as shared and inline
  strings already did.
- xls: UTF-16 `PtgStr` formula operands, `DIMENSIONS` records with two trailing
  bytes, and a panic on a truncated `PtgExp` operand.
- The CFB reader under xls checks header sector counts before allocating, so a
  corrupt file can no longer ask for a huge allocation.

## 0.1.0 — 2026-08-11

The first release on npm. It is everything below: the first cut, and the work
that made it publishable.

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
- A release workflow that publishes with npm provenance. The tarball ships a
  740 KB wasm binary no reader can inspect, so a signed attestation tying those
  bytes to a commit and a workflow run is worth more here than it is for a
  package whose source is its published form. Publishing now happens only from
  CI, because a laptop cannot produce that attestation.

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

### First cut

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
