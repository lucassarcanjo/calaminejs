// One place that knows where things live, so moving a directory is one edit
// rather than a grep across every suite.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The assembled package. Suites import from here so what is tested is what ships. */
export const dist = join(root, "dist");

/** Test fixtures. Generated or fetched; never committed. */
export const fixtures = join(root, "test", "fixtures");

/** calamine's own corpus, fetched by support/fetch-fixtures.sh. */
export const corpus = join(fixtures, "calamine");

/** Fixtures built by support/make-crafted-fixtures.ts for branches the corpus misses. */
export const crafted = join(fixtures, "crafted");

/** The date fixture, written as raw serials so the bytes on disk are known. */
export const datesFixture = join(fixtures, "dates.xlsx");

/** Large fixtures for the benchmark. Separate because they are ~23 MB. */
export const benchFixtures = join(root, "bench", "fixtures");
