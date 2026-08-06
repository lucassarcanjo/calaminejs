// Fixtures for the branches calamine's own corpus barely reaches.
//
// Running the corpus with coverage counters showed 6 `dtiso` cells and 2
// `duriso` cells across all 130 files — near-zero exercise of the ISO parsing,
// which is the code most likely to be wrong. These files fill that in, and are
// written into the same directory the differential harness scans, so they get
// the identical treatment: dumped natively, re-read through wasm, and checked
// against an expectation recomputed in JS.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeXlsx, makeZip, sheet } from "./zip.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "fixtures", "crafted");
mkdirSync(outDir, { recursive: true });

// ── ODS: the format that actually produces dtiso / duriso ────────────────────

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

function ods(rows) {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
<office:body><office:spreadsheet><table:table table:name="Sheet1">
${rows.map((r) => `<table:table-row>${r}</table:table-row>`).join("\n")}
</table:table></office:spreadsheet></office:body></office:document-content>`;
  return makeZip([
    { name: "mimetype", data: "application/vnd.oasis.opendocument.spreadsheet" },
    { name: "META-INF/manifest.xml", data: MANIFEST },
    { name: "content.xml", data: content },
  ]);
}

const dateCell = (v) =>
  `<table:table-cell office:value-type="date" office:date-value="${v}"><text:p>d</text:p></table:table-cell>`;
const timeCell = (v) =>
  `<table:table-cell office:value-type="time" office:time-value="${v}"><text:p>t</text:p></table:table-cell>`;

// Understood — these must convert and follow the `dates` policy.
const GOOD_DATES = [
  "2020-01-01T12:34:56",
  "2020-01-01",
  "2020-01-01T12:34:56.5",
  "2020-01-01T12:34:56.25",
  "2020-01-01T12:34:56.123456789",
  "2020-01-01 12:34:56",
  "1899-12-31T00:00:00",
  "0001-01-01T00:00:00",
  "1900-02-28T23:59:59",
  "2020-02-29T00:00:00",
  "9999-12-31T23:59:59.999",
  "1969-12-31T23:59:59",
  "1970-01-01T00:00:00",
];

// Not understood — these must pass through byte-for-byte, not be half-read.
const BAD_DATES = [
  "2020-01-01T12:34:56Z",
  "2020-01-01T12:34:56+05:00",
  "2020-01-01T12:34:56-08:00",
  "2020-01-01T12:34",
  "2020-01-01T12",
  "2020-13-01T00:00:00",
  "2020-01-32T00:00:00",
  "2020-01-01T24:00:00",
  "2020-01-01T00:60:00",
  "2020-01-01T00:00:60",
  "2020-00-01",
  "2020-01-00",
  "2020-01-01T12:34:56.123abc",
  "2020-01-01T12:34:56.",
];

const GOOD_DURATIONS = [
  "PT36H0M0S",
  "PT0H0M0S",
  "PT1H30M15S",
  "-PT2H0M0S",
  "P1DT2H30M",
  "PT0.5S",
  "P1W",
  "PT12H",
  "PT0.001S",
  "-PT0H0M1S",
  "P400D",
];

const BAD_DURATIONS = ["P1Y", "P1M", "PT36", "36H", "PT", "P", "PT1X"];

writeFileSync(
  join(outDir, "iso_dates.ods"),
  ods([...GOOD_DATES, ...BAD_DATES].map((v) => dateCell(v))),
);
writeFileSync(
  join(outDir, "iso_durations.ods"),
  ods([...GOOD_DURATIONS, ...BAD_DURATIONS].map((v) => timeCell(v))),
);

// ── xlsx: t="d" cells, the other dtiso source, plus error and type coverage ──

writeFileSync(
  join(outDir, "iso_dates.xlsx"),
  makeXlsx(
    sheet(
      `A1:A${GOOD_DATES.length + BAD_DATES.length}`,
      [...GOOD_DATES, ...BAD_DATES]
        .map((v, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="d"><v>${v}</v></c></row>`)
        .join(""),
    ),
  ),
);

// `err` saw 70 cells in the corpus but not every variant.
//
// "#DATA!" is deliberately absent. calamine has a CellErrorType::GettingData
// that prints as "#DATA!", but its xlsx reader rejects that spelling on the way
// in — a sheet containing one fails to read entirely. Including it made this
// whole fixture unreadable, and the differential harness counted that as both
// sides agreeing, so none of the other seven were ever checked.
const ERRORS = ["#DIV/0!", "#N/A", "#NAME?", "#NULL!", "#NUM!", "#REF!", "#VALUE!"];
writeFileSync(
  join(outDir, "errors.xlsx"),
  makeXlsx(
    sheet(
      `A1:A${ERRORS.length}`,
      ERRORS.map((e, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="e"><v>${e}</v></c></row>`).join(""),
    ),
  ),
);

// `bool` saw 41 cells and `int` 625; both are cheap to pin down properly.
const MISC = [
  '<c r="A1" t="b"><v>1</v></c>',
  '<c r="B1" t="b"><v>0</v></c>',
  '<c r="C1"><v>0</v></c>',
  '<c r="D1"><v>-0</v></c>',
  '<c r="E1"><v>1e308</v></c>',
  '<c r="F1"><v>-1e308</v></c>',
  '<c r="G1"><v>1e-308</v></c>',
  '<c r="H1"><v>0.1</v></c>',
  '<c r="I1" t="inlineStr"><is><t></t></is></c>',
  '<c r="J1" t="inlineStr"><is><t>  spaced  </t></is></c>',
  '<c r="K1" t="inlineStr"><is><t>emoji 🧮 and ünïcöde</t></is></c>',
];
writeFileSync(
  join(outDir, "misc_types.xlsx"),
  makeXlsx(sheet("A1:K1", `<row r="1">${MISC.join("")}</row>`)),
);

console.log(`wrote 5 crafted fixtures to ${outDir}`);
console.log(
  `  dates: ${GOOD_DATES.length} understood + ${BAD_DATES.length} must-pass-through (x2 formats)`,
);
console.log(`  durations: ${GOOD_DURATIONS.length} understood + ${BAD_DURATIONS.length} must-pass-through`);
console.log(`  errors: ${ERRORS.length} CellErrorType variants (all but #DATA!, see above)`);
