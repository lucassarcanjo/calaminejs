// Checks the convenience outputs against a fixture whose every cell is chosen
// to break a naive implementation: a comma, a quote, a pipe, an embedded
// newline, a duplicate header, a blank header, an error cell, a real date and
// text that looks exactly like one.
import { readCellsParsed, toCsv, toJsonParsed, toMarkdown } from "calaminejs";
import type { CsvOptions, JsonOptions, ReadOptions } from "calaminejs";
import { makeXlsx, sheet } from "../support/zip.ts";

const str = (r: number, c: string, v: string) =>
  `<c r="${c}${r}" t="inlineStr"><is><t>${v}</t></is></c>`;
const num = (r: number, c: string, v: number) => `<c r="${c}${r}"><v>${v}</v></c>`;
const err = (r: number, c: string, v: string) => `<c r="${c}${r}" t="e"><v>${v}</v></c>`;
const date = (r: number, c: string, v: string) => `<c r="${c}${r}" t="d"><v>${v}</v></c>`;

// A | B | C(blank hdr) | D(dup of A)
const book = makeXlsx(
  sheet(
    "A1:D3",
    [
      `<row r="1">${str(1, "A", "name")}${str(1, "B", "when")}${str(1, "C", "")}${str(1, "D", "name")}</row>`,
      `<row r="2">${str(2, "A", "a,b")}${date(2, "B", "2020-01-01T12:00:00")}${num(2, "C", 1)}${str(2, "D", 'say "hi"')}</row>`,
      `<row r="3">${str(3, "A", "pipe|here")}${str(3, "B", "2020-01-01T12:00:00.000")}${err(3, "C", "#DIV/0!")}</row>`,
    ].join(""),
  ),
);

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.log(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

// ── tagged cells: the point of the whole exercise ────────────────────────────
// Typed TaggedCell[][] with no cast — the overload picks it from `tagged: true`.
const tagged = readCellsParsed(book, { tagged: true });
check("real date is tagged as a date", tagged[1]?.[1], {
  t: "date",
  v: "2020-01-01T12:00:00.000",
});
check("identical-looking text stays text", tagged[2]?.[1], {
  t: "str",
  v: "2020-01-01T12:00:00.000",
});
check("error keeps its Excel spelling", tagged[2]?.[2], { t: "err", v: "#DIV/0!" });
check("empty cell is null, not a tag", tagged[2]?.[3], null);

// Untagged, the first two are genuinely indistinguishable — documented, not a bug.
const plain = readCellsParsed(book);
check("untagged loses the distinction", plain[1]?.[1] === plain[2]?.[1], true);

// ── objects ─────────────────────────────────────────────────────────────────
const objects = toJsonParsed(book);
check("blank header becomes its column label, duplicate gets a suffix", Object.keys(objects[0] ?? {}), [
  "name",
  "when",
  "C",
  "name_2",
]);
check(
  "header:none returns arrays including the header row",
  toJsonParsed(book, { header: "none" }).length,
  3,
);

// ── csv ─────────────────────────────────────────────────────────────────────
check(
  "csv quotes only what needs it",
  toCsv(book),
  'name,when,,name\n"a,b",2020-01-01T12:00:00.000,1,"say ""hi"""\npipe|here,2020-01-01T12:00:00.000,#DIV/0!,\n',
);
// A comma is no longer special, but a quote still forces quoting per RFC 4180.
check(
  "csv with a semicolon leaves commas alone",
  toCsv(book, { delimiter: ";" }).split("\n")[1],
  'a,b;2020-01-01T12:00:00.000;1;"say ""hi"""',
);
// Split on "," would cut through the quoted "a,b" field, so match instead.
check(
  "csv honours the dates policy",
  toCsv(book, { dates: "serial" }).includes("43831.5"),
  true,
);

// ── markdown ────────────────────────────────────────────────────────────────
const md = toMarkdown(book).split("\n");
// Verbatim: duplicates stay duplicated and a blank header stays blank.
check("markdown header row is verbatim", md[0], "| name | when |  | name |");
check("markdown alignment row", md[1], "| --- | --- | --- | --- |");
check("markdown escapes a pipe", md[3], "| pipe\\|here | 2020-01-01T12:00:00.000 | #DIV/0! |  |");

// ── option validation ───────────────────────────────────────────────────────
// Each of these is rejected at compile time too, which is the point of the
// casts: the runtime check exists for callers not using TypeScript, and it is
// that runtime behaviour being asserted here.
const invalid: Array<[string, () => unknown]> = [
  ["a typo in an option name is rejected", () => readCellsParsed(book, { sheets: "Sheet1" } as ReadOptions)],
  ["a multi-character delimiter is rejected", () => toCsv(book, { delimiter: "||" } as CsvOptions)],
  ["an unknown header mode is rejected", () => toJsonParsed(book, { header: "second-row" } as unknown as JsonOptions)],
];

for (const [name, fn] of invalid) {
  try {
    fn();
    failures++;
    console.log(`✗ ${name} — it was accepted`);
  } catch (error) {
    console.log(`✓ ${name}: ${(error as Error).message.slice(0, 68)}`);
  }
}

console.log(failures === 0 ? "\nall output cases pass\n" : `\n${failures} FAILING\n`);
process.exitCode = failures === 0 ? 0 : 1;
