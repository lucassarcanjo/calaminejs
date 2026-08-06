// Fails loudly and early rather than letting every test report a confusing
// 404. Both of these are build artifacts that are deliberately not committed.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { crafted, datesFixture, dist } from "../support/paths.mjs";

export default function globalSetup() {
  const required = [
    [join(dist, "streaming.js"), "bun run build"],
    [join(dist, "calamine_wasm_bg.wasm"), "bun run build"],
    [join(dist, "inline.js"), "bun run build"],
    [datesFixture, "bun run fixtures"],
    [join(crafted, "errors.xlsx"), "bun run fixtures"],
  ];

  const missing = required.filter(([path]) => !existsSync(path));
  if (missing.length) {
    const lines = missing.map(([path, fix]) => `  ${path}\n      run: ${fix}`);
    throw new Error(`browser suite is missing build artifacts:\n${lines.join("\n")}`);
  }
}
