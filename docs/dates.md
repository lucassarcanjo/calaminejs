# Dates

Why a spreadsheet date is not a `Date`, what the three policies do, and where
the conversion is genuinely lossy.

Excel has no timezone concept. A date cell is a plain number plus a display format, and
calamine's own docs are explicit that the format *"doesn't use or encode timezone information
in any way"*. So a spreadsheet date is a **civil (wall-clock)** value, while a JS `Date` is an
**instant** — converting one to the other requires inventing an offset. That invention is where
most libraries go wrong, so this one refuses to guess and makes it a policy:

| `dates` | result for serial `45943.541` | notes |
|---|---|---|
| `"iso"` (default) | `"2025-10-13T12:59:02.400"` | No offset. Lossless. Exactly what `Temporal.PlainDateTime.from()` accepts. |
| `"serial"` | `45943.541` | Raw, untouched. |
| `"epoch-millis"` | `1760360342400` | Asserts the civil time is UTC. Feeds `new Date(n)`. |

An unrecognised value throws rather than falling back.

The time component is always emitted under `iso`, even at midnight, because `new Date()`
parses a bare `2020-01-01` as UTC but `2020-01-01T00:00:00.000` as local — a uniform shape
keeps that inconsistency away from callers.

**Durations are not dates.** A cell formatted `[h]:mm:ss` holding `1.5` is 36 hours, not
`1900-01-01T12:00`. Those become ISO-8601 durations (`PT36H0M0S`).

## Known sharp edges

- **`epoch-millis` collides serials 60 and 61**, both landing on `1900-03-01`. Excel believes
  1900 was a leap year, so serial 60 is `1900-02-29` — a date that does not exist in a real
  calendar and therefore cannot survive the trip through a JS `Date`. Unavoidable for any
  instant-based representation; it is the main reason `iso` is the default.
- Below serial 60 the epoch is `1899-12-31`, not the `1899-12-30` anchor that only lines up
  *after* the leap-year bug. `serial 0.5` is `1899-12-31T12:00:00.000`.
- Untagged, a date cell and a string cell are both strings and indistinguishable. Pass
  `tagged: true` when that matters.

Cells that already hold an ISO string in the file (ODS throughout, xlsx `t="d"`) are parsed and
routed through the same policy, so they answer to `dates` like any other cell rather than
ignoring it. A string that cannot be parsed is passed through unchanged rather than lost.

Error cells carry their Excel spelling — `#DIV/0!`, `#N/A`, `#REF!`.

## SheetJS does not round-trip its own dates

Worth knowing if you benchmark against it. Writing `new Date(Date.UTC(2020,0,1))` on a machine
in `America/Sao_Paulo` stores serial `43830.87467592592`, which is `2019-12-31T20:59:32` — the
writer applied a local offset. Its reader then applies a *different* fudge and returns
`23:59:59.999`. calamine returns the value the file actually contains.
