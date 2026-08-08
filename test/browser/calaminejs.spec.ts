// The browser suite.
//
// Everything else in this repo runs under Node, where the wasm is handed to the
// glue as bytes from the filesystem. This is the only place the streaming path
// is actually exercised — `fetch` + `WebAssembly.instantiateStreaming` against a
// real HTTP response, in a real engine. The Node suite can only prove that path
// *fails* there, which is why the `node` condition exists.
//
// Each test gets a fresh page. The entries share one glue module and ES modules
// are singletons, so two entries in one page would let the first initialise the
// second and hide a broken loader.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { ReadOptions, TaggedCell } from "calaminejs";

const HARNESS = "/test/browser/harness.html";
const ERRORS_XLSX = "/test/fixtures/crafted/errors.xlsx";
const DATES_XLSX = "/test/fixtures/dates.xlsx";

/** Records every URL the page requests, so we can prove *how* the wasm arrived. */
function trackRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

/** What test/browser/worker.js posts back. */
interface WorkerResult {
  ok: boolean;
  error?: string;
  names?: string[];
  firstCsvLine?: string;
  firstCell?: TaggedCell;
}

test.describe("streaming entry (browsers and bundlers)", () => {
  test("loads the wasm as its own request, served as application/wasm", async ({ page }) => {
    const urls = trackRequests(page);
    const wasmResponse = page.waitForResponse((r) => r.url().endsWith("calamine_wasm_bg.wasm"));

    await page.goto(HARNESS);
    await page.evaluate(() => window.loadEntry("streaming.js").then(() => window.calamine.ready()));

    const response = await wasmResponse;
    // Not application/wasm means instantiateStreaming refuses and the glue
    // quietly buffers instead — the test would still pass while proving
    // nothing about streaming.
    expect(response.headers()["content-type"]).toBe("application/wasm");
    expect(urls.filter((u) => u.endsWith(".wasm"))).toHaveLength(1);
  });

  test("reads a workbook after ready()", async ({ page }) => {
    await page.goto(HARNESS);
    const result = await page.evaluate(async (fixture) => {
      await window.loadEntry("streaming.js");
      await window.calamine.ready();
      const bytes = await window.fetchFixture(fixture);
      return {
        names: window.calamine.sheetNames(bytes),
        csv: window.calamine.toCsv(bytes).split("\n").slice(0, 2),
        markdown: window.calamine.toMarkdown(bytes).split("\n")[1],
      };
    }, ERRORS_XLSX);

    expect(result.names).toEqual(["Sheet1"]);
    expect(result.csv).toEqual(["#DIV/0!", "#N/A"]);
    expect(result.markdown).toBe("| --- |");
  });

  test("says what is wrong when called before ready()", async ({ page }) => {
    await page.goto(HARNESS);
    const message = await page.evaluate(async () => {
      await window.loadEntry("streaming.js");
      try {
        window.calamine.sheetNames(new Uint8Array());
        return "NO ERROR";
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(message).toContain("await ready()");
    expect(message).toContain("calaminejs");
  });

  test("keeps a date distinguishable from text that looks like one", async ({ page }) => {
    await page.goto(HARNESS);
    const rows = await page.evaluate(async (fixture) => {
      await window.loadEntry("streaming.js");
      await window.calamine.ready();
      const bytes = await window.fetchFixture(fixture);
      return JSON.parse(window.calamine.readCells(bytes, { tagged: true }));
    }, DATES_XLSX);

    // Row 0 is a date-formatted serial; the last row is the same serial with a
    // General format, so it must stay a number.
    expect(rows[0][1]).toEqual({ t: "date", v: "2020-01-01T00:00:00.000" });
    expect(rows.at(-1)[1]).toEqual({ t: "num", v: 43831 });
  });

  test("rejects an unknown option instead of ignoring it", async ({ page }) => {
    await page.goto(HARNESS);
    const message = await page.evaluate(async (fixture) => {
      await window.loadEntry("streaming.js");
      await window.calamine.ready();
      const bytes = await window.fetchFixture(fixture);
      try {
        window.calamine.readCells(bytes, { sheets: "Sheet1" } as ReadOptions);
        return "NO ERROR";
      } catch (error) {
        return (error as Error).message;
      }
    }, ERRORS_XLSX);

    expect(message).toContain("unknown option");
  });
});

test.describe("inline entry", () => {
  test("works with no companion asset and fetches no wasm", async ({ page }) => {
    const urls = trackRequests(page);

    await page.goto(HARNESS);
    const result = await page.evaluate(async (fixture) => {
      await window.loadEntry("inline.js");
      const bytes = await window.fetchFixture(fixture);
      return {
        // No ready() needed: base64 decodes synchronously at import.
        names: window.calamine.sheetNames(bytes),
        firstCsvLine: window.calamine.toCsv(bytes).split("\n")[0],
      };
    }, ERRORS_XLSX);

    expect(result.names).toEqual(["Sheet1"]);
    expect(result.firstCsvLine).toBe("#DIV/0!");
    // The whole point of this entry: nothing but JS was fetched.
    expect(urls.filter((u) => u.endsWith(".wasm"))).toHaveLength(0);
  });
});

test.describe("web worker", () => {
  test("parses off the main thread", async ({ page }) => {
    await page.goto(HARNESS);
    const result = await page.evaluate(async (fixture) => {
      const bytes = await window.fetchFixture(fixture);
      const worker = new Worker("/test/browser/worker.js", { type: "module" });
      return await new Promise<WorkerResult>((resolve, reject) => {
        worker.onmessage = ({ data }: MessageEvent<WorkerResult>) => resolve(data);
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage(bytes);
      });
    }, ERRORS_XLSX);

    expect(result.ok, result.error).toBe(true);
    expect(result.names).toEqual(["Sheet1"]);
    expect(result.firstCsvLine).toBe("#DIV/0!");
    expect(result.firstCell).toEqual({ t: "err", v: "#DIV/0!" });
  });
});

test.describe("large input", () => {
  test("survives a workbook built in the page", async ({ page }) => {
    await page.goto(HARNESS);
    // Not a size record — just enough to cross out of the trivial case and
    // confirm nothing about wasm memory growth breaks in a browser.
    const result = await page.evaluate(async (fixture) => {
      await window.loadEntry("streaming.js");
      await window.calamine.ready();
      const bytes = await window.fetchFixture(fixture);
      let rows = 0;
      for (let i = 0; i < 25; i++) {
        rows = JSON.parse(window.calamine.readCells(bytes)).length;
      }
      return rows;
    }, DATES_XLSX);

    expect(result).toBe(11);
  });
});
