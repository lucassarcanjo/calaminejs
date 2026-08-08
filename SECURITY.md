# Security

## Reporting a vulnerability

Report privately through GitHub:
[**Report a vulnerability**](https://github.com/lucassarcanjo/calaminejs/security/advisories/new).
Please do not open a public issue for anything exploitable.

Include the file that triggers it if you can. A malformed spreadsheet is usually
the whole reproduction, and without it most parser bugs cannot be confirmed.

Expect an acknowledgement within a week. This is a small project maintained in
spare time — that is the realistic number rather than an aspirational one.

## What this library does with untrusted input

Reading a spreadsheet from an unknown source is the normal use of this package,
so hostile files are the expected case, not an edge case.

The parsing happens inside a WebAssembly module. That is a real boundary: wasm
has no filesystem, no network and no syscalls, and this module imports none. A
memory-safety bug in the parser cannot read files or open sockets the way the
equivalent native library could. It is contained to the module's own linear
memory.

What that boundary does **not** protect against:

- **Memory exhaustion.** Reading a 23 MB workbook settles at roughly 153 MB of
  wasm memory — about 6.6x the file size — and wasm32 caps at 4 GB. Memory is
  never returned to the OS after a read. If you accept uploads, bound the file
  size before calling this, and prefer a worker or subprocess you can tear down.
- **Data still crossing into your process.** Sheet names, cell strings and error
  values come from the file. They are strings, not code, but they are attacker
  controlled — treat them as you would any user input when they reach a
  template, a shell, a filename or a SQL statement.
- **`panic = "abort"`.** A panic anywhere in the parser kills the wasm instance
  for the whole process rather than the failing call. `test/node/adversarial.test.ts`
  feeds sixteen kinds of hostile input and re-reads a known-good file after each
  one to check the instance survived; all sixteen currently return or throw
  cleanly. A file that gets past that is worth reporting.

## Scope

In scope: anything that crashes the wasm instance, corrupts data silently,
escapes the module, or turns a bounded file into unbounded memory or CPU.

Out of scope: that a declared dimension of `A1:XFD1048576` is ignored in favour
of the cells actually present (deliberate — the alternative is a 17-billion-cell
allocation), and that non-finite floats become `null` (JSON has no `Infinity`,
and Excel cannot store one).

Bugs in the parser itself belong to
[calamine](https://github.com/tafia/calamine/security). If
`cargo run --release --example dump_native -- yourfile.xlsx` already shows the
problem, it is upstream, and reporting it there reaches more affected people.

## Supported versions

Pre-1.0: only the latest release gets fixes.
