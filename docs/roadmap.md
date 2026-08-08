# What is left

Known gaps, in rough order of how much they would matter to a user.

1. **Vercel Edge.** Deliberately not handled. `workerd` covers Cloudflare; whether Vercel
   resolves `edge-light` for this layout needs a deploy to find out, not more reading. Adding
   the condition is a one-line change once someone checks.
2. **A real Worker.** `dist/workerd.js` is the last untested entry, and the one that differs
   most: it imports the `.wasm` as a module rather than reading or fetching it, which only the
   Workers toolchain resolves. [`test/worker/README.md`](../test/worker/README.md) sets out what
   to build with Miniflare and what it should prove.
3. **Memory ceiling.** Reading the 23 MB fixture settles at ~153 MB of wasm memory, roughly 6.6x
   the file size, and wasm32 caps at 4 GB. That puts the ceiling somewhere in the low hundreds
   of MB. Not measured, and worth knowing before someone finds it with a 200 MB export.
4. **`dates: "temporal"`.** Temporal reached Stage 4 in March 2026 and ships in Node 26; the
   `iso` output is already exactly what `Temporal.PlainDateTime.from()` accepts, so callers on
   a modern runtime can convert today. Returning Temporal objects directly measured 314x
   slower than strings (via `temporal-polyfill`, so native will be better), and Temporal
   rejects `1900-02-29` just as `Date` does — so the string stays the default and this is an
   opt-in at most.
