# Cloudflare Workers — not implemented yet

The `workerd` entry point (`dist/workerd.js`) is written and exported, but
nothing here runs it. It is the last untested path in the package.

It differs from every other entry in a way that cannot be checked from Node:

```js
import wasmModule from "./calamine_wasm_bg.wasm";
initSync({ module: wasmModule });
```

That import is not a filesystem read or a fetch. `wrangler` resolves it at build
time into a compiled `WebAssembly.Module`, which is what Workers want — the
platform will not compile a large module from bytes inside a request handler.
Nothing outside the Workers toolchain resolves that import at all, so this needs
a real `workerd`.

## What to do

`miniflare` runs `workerd` locally and is the right amount of machinery — a full
`wrangler dev` is not needed.

```sh
bun add -d miniflare
```

Then, in this directory:

- `worker.js` — a fetch handler importing `sheetNames` / `toCsv` from
  `calamine` (or `../../dist/workerd.js` before publishing), reading a fixture
  posted to it and returning the result as JSON.
- `wrangler.toml` — `compatibility_date`, and `rules` with
  `type = "CompiledWasm"` for `**/*.wasm` so the import resolves.
- `workerd.test.ts` — boots Miniflare, POSTs `test/fixtures/crafted/errors.xlsx`
  to the worker, asserts the CSV comes back as `#DIV/0!`.

Wire it into `test:worker` in `package.json`, which is currently a stub.

## What it should prove

1. The `.wasm` import resolves and `initSync` accepts a `WebAssembly.Module`
   rather than bytes — the one thing this entry does differently.
2. The functions work with no `ready()` call, matching the Node entry's contract.
3. The `workerd` export condition actually selects this entry, rather than the
   package falling through to `browser` and failing on a `fetch` that Workers
   will not serve.

Point 3 is the one most likely to be quietly broken, and the one no amount of
reading the `exports` map will settle.

## Vercel Edge

Same shape, different condition name (`edge-light`). Deliberately left out until
someone deploys and checks which condition Vercel actually resolves — that is a
deploy question, not a reading question.
