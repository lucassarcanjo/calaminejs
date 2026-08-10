# calaminejs vs the field

Every number here is printed by [`bench/compare/run.mjs`](../bench/compare/run.mjs).
Nothing is quoted from documentation, because what a library documents and what
it returns for a given cell are different questions, and only the second one
matters when the file is already on disk.

```sh
bun run fixtures                          # the corpus these tests read
bun add -d exceljs read-excel-file        # optional; xlsx is already a devDependency
bun run compare
```

Measured on Node 22.18, macOS arm64, `America/Sao_Paulo`, 2026-08-10. Versions:
`xlsx` 0.18.5 (npm's latest), `exceljs` 4.4.0, `read-excel-file` 9.3.9,
`node-xlsx` 0.24.0.

**The timezone matters and is not incidental.** Several results below change
depending on where the machine is. That is itself the finding.

## The short version

calaminejs is a *reader*, and a narrow one. It does not write, style, or
evaluate formulas, and it never will do all three as well as the incumbents. It
is worth using when the values have to be right, on files you did not create.

The speed is real — about 4x — but it is the least interesting thing here.

Two caveats on reading any comparison written by one of the parties: the
"where calaminejs loses" section is not decoration, and the memory numbers are
noisy enough that they are rounded rather than quoted. Where a competitor does
something better — ExcelJS on ordinary dates, SheetJS on formats and maturity —
it says so.

## Who is being compared

| | what it is |
|---|---|
| **SheetJS** (`xlsx`) | the incumbent. Widest format coverage anywhere, reads and writes |
| **ExcelJS** | xlsx/csv only, but rich: styles, images, streaming, formulas |
| **node-xlsx** | a thin wrapper whose only dependency *is* SheetJS |
| **read-excel-file** | xlsx only, schema validation, small |
| **calaminejs** | read-only, four formats, one wasm artifact for every runtime |

## 1. Formats

The same four files, opened by each library.

| | xlsx | xls | xlsb | ods |
|---|---|---|---|---|
| calaminejs | ✅ | ✅ | ✅ | ✅ |
| SheetJS | ✅ | ✅ | ✅ | ✅ |
| ExcelJS | ✅ | ❌ | ❌ | ❌ |
| read-excel-file | ✅ | ❌ | ❌ | ❌ |

SheetJS goes considerably further than this table — csv, dbf, Numbers, html and
more. calaminejs reads these four and nothing else, including **no csv**.

## 2. Dates

The load-bearing section. `test/support/make-date-fixture.ts` writes each cell
as a raw serial plus a number format, with no `Date` object anywhere in the
writing path, so the value in the file is known exactly.

| cell | in the file | calaminejs | SheetJS | ExcelJS |
|---|---|---|---|---|
| tz-mangled serial | `2019-12-31T20:59:32` | ✅ exact | ❌ `23:59:59.999Z` | ✅ correct |
| serial 60 | `1900-02-29` | ✅ preserved | ❌ `1900-02-28T03:06:28Z` | ❌ `1900-02-28` |
| `[h]:mm:ss` = 1.5 | 36 hours | ✅ `PT36H0M0S` | ❌ `1899-12-31T15:06:28Z` | ❌ `1899-12-31T12:00Z` |

Three separate failure modes, none of them bugs exactly — they are all what
happens when a wall-clock value is forced into a type that means an instant.

**The offset.** `03:06:28` is São Paulo's local mean time, used before Brazil
adopted standard time in 1914. A `Date` constructed near 1900 picks up the
historical offset for wherever the machine is, so this row reads differently in
London and produces a different wrong answer again in Tokyo.

**The impossible day.** Excel believes 1900 was a leap year, so serial 60 is
`1900-02-29` — a date that does not exist in any real calendar and therefore
cannot survive a round trip through `Date`. calaminejs returns the string
`"1900-02-29T00:00:00.000"` because it never builds a `Date` at all. This is
also why `dates: "iso"` is the default and `epoch-millis` is documented as
lossy: under `epoch-millis` serials 60 and 61 collide, and no instant-based
representation can avoid that.

**Durations.** A cell formatted `[h]:mm:ss` holding `1.5` is a *length* of time
— 36 hours — not a point on a calendar. Both competitors return a date in 1899.

ExcelJS handles the ordinary case correctly by treating the civil time as UTC,
which is the same choice `dates: "epoch-millis"` makes. Its date handling is
meaningfully better than SheetJS's.

## 3. Type fidelity

A1 is a real date cell, A2 is text that renders identically, A3 is an error.

```
calaminejs   A1 {"t":"date","v":"2020-01-01T12:00:00.000"}
             A2 {"t":"str", "v":"2020-01-01T12:00:00.000"}
             A3 {"t":"err", "v":"#DIV/0!"}

SheetJS      A3 via sheet_to_json  null
             A3 via raw cell       {"t":"e","v":7,"w":"#DIV/0!"}
```

All three libraries can distinguish A1 from A2. The difference is what it costs
you: with `tagged: true` the type travels *with* the value, so no second lookup
is needed and no convenience wrapper can drop it.

Which is what happens to A3. SheetJS preserves the error faithfully at the cell
level — `t:"e"`, `w:"#DIV/0!"` — but `sheet_to_json`, the API its own docs lead
with, flattens it to `null`. The information is there; the ergonomic path
discards it.

## 4. Cost

23 MB, 1.8M cells. **One subprocess per library** — measured in a shared
process, whichever runs second inherits the first's memory, which made SheetJS
look 400 MB worse than it is.

| | time | peak RSS | after GC |
|---|---|---|---|
| calaminejs | **~1.0 s** | ~400 MB | ~380 MB |
| SheetJS | ~4.0 s | ~620 MB | ~530 MB |

Timings are stable to within a few percent. **The memory figures are not** —
they moved by ±50 MB across runs on an idle machine, so they are rounded and
should be read as "which order of magnitude", not as a benchmark. Anything
closer than about 100 MB apart here is noise.

Neither returns much memory to the OS. We start from less, but the wasm ceiling
is harder: wasm32 caps at 4 GB, so there is a file size past which calaminejs
simply cannot go while SheetJS degrades gracefully. That limit has not been
measured — see [roadmap.md](roadmap.md).

## 5. Dependencies

| | dependencies | installed | `npm audit` |
|---|---|---|---|
| calaminejs | **0** | **1.8 MB** | nothing to audit |
| SheetJS | 7 | 7.2 MB | **high, no fix available** |
| node-xlsx | 1 (SheetJS) | 7.8 MB | inherits the above |
| ExcelJS | 9 | 22 MB | moderate (`uuid`) |
| read-excel-file | 4 | 3.3 MB | clean |

The SheetJS row deserves explanation, because it is not the project's fault and
it is easy to misread as an attack.

**npm's `xlsx` is frozen at 0.18.5.** SheetJS moved distribution to
`cdn.sheetjs.com`; releases since then — including the fixes for prototype
pollution and the ReDoS — are not on npm. So `npm audit` reports:

```
xlsx  *  Severity: high
  Prototype Pollution in sheetJS
  SheetJS Regular Expression Denial of Service (ReDoS)
  No fix available
```

The fixed versions exist and are maintained; they are simply not installable the
way most projects install things. Anyone with an audit gate in CI has to
special-case it, vendor from the CDN, or use a fork. `node-xlsx` sidesteps this
by depending on a **direct CDN tarball URL**, which has its own consequences for
registry mirrors, offline installs and lockfile review.

calaminejs has no dependencies, so this class of problem does not arise. That is
a property of being a wasm binary with a narrow job, not virtue.

## Where calaminejs loses

Not close, and worth being explicit about:

- **No writing.** At all. Need to emit a spreadsheet? Not a candidate.
- **No styles, formulas, merged cells, images, or column widths.** ExcelJS does
  all of it. calamine exposes formulas and merges upstream — this binding just
  does not surface them yet, so it is a roadmap item rather than a wall.
- **No streaming.** Whole sheet, one call. ExcelJS has a streaming reader for
  files that do not fit in memory.
- **Fewer formats.** Four. No csv, dbf, Numbers or html.
- **Maturity.** 0.1.0, one maintainer, against a decade of SheetJS in
  production. The differential suite over calamine's own corpus is the argument
  for trusting it anyway, and it is a weaker argument than a decade.
- **wasm.** 370 KB gzipped before any of your code runs, and environments that
  cannot execute WebAssembly are excluded outright.

## Choosing

| you need | use |
|---|---|
| values to be exactly right, on files you did not create | **calaminejs** |
| to write a spreadsheet, or styles and formulas | **ExcelJS** |
| an unusual format, or one library for everything | **SheetJS**, from their CDN |
| xlsx with schema validation, small footprint | **read-excel-file** |

The honest positioning is not "a faster SheetJS". It is **a correct reader with
a deliberately narrow surface**. Being 4x faster in a fifth of the install size
is a consequence of doing less, not the reason to pick it.
