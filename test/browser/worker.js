// A real Web Worker. Parsing a large spreadsheet on the main thread janks the
// page, so this is how most callers should use the library — which makes it
// worth proving the entry works here and not only on the main thread.
import { readCells, ready, sheetNames, toCsv } from "/dist/streaming.js";

self.onmessage = async ({ data: bytes }) => {
  try {
    await ready();
    self.postMessage({
      ok: true,
      names: sheetNames(bytes),
      firstCsvLine: toCsv(bytes).split("\n")[0],
      firstCell: JSON.parse(readCells(bytes, { tagged: true }))[0][0],
    });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error?.message ?? error) });
  }
};
