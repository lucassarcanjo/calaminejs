// Static server for the browser suite.
//
// The MIME type is the point. `WebAssembly.instantiateStreaming` refuses a
// response that is not `application/wasm` and the glue then falls back to
// buffering — which would still pass a naive test while silently proving
// nothing about the streaming path. Serving it correctly is what makes the
// assertion meaningful.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

import { root } from "../support/paths.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".json": "application/json",
};

export function createStaticServer() {
  return createServer((req, res) => {
    // Strip the query string, then normalise — a request for /../../etc must
    // not escape the repo even in a test server.
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ""));

    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }

    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      // A stale wasm between runs would be maddening to debug.
      "cache-control": "no-store",
      // Harmless here, and keeps the door open for a threaded build later.
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
    });
    createReadStream(file).pipe(res);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  createStaticServer().listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
}
