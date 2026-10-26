// Checks workbookProperties against the fixtures calamine added with it, with
// the expected values written out rather than read back from Rust: the shape
// (camelCase keys, every field present, `null` for unset) is this binding's
// decision, and the only way to check a decision is to state it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workbookProperties } from "calamine";
import type { WorkbookProperties } from "calamine";
import { corpus } from "../support/paths.ts";

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

const read = (file: string) => readFileSync(join(corpus, file));

const NONE: WorkbookProperties = {
  creator: null,
  lastModifiedBy: null,
  created: null,
  modified: null,
  title: null,
  subject: null,
  description: null,
  keywords: null,
  category: null,
  contentStatus: null,
  revision: null,
  version: null,
  application: null,
  appVersion: null,
  company: null,
  template: null,
  manager: null,
};

check("xlsx: every property, in key order", workbookProperties(read("workbook_properties.xlsx")), {
  creator: "Test Creator",
  lastModifiedBy: "Last Modifier",
  created: "2024-01-15T08:30:00Z",
  modified: "2024-06-20T14:22:00Z",
  title: "Workbook Title",
  subject: "Test Subject",
  description: "A test workbook",
  keywords: "test, calamine",
  category: "Testing",
  contentStatus: "Draft",
  revision: "3",
  version: "1.2",
  application: "Microsoft Excel",
  appVersion: "16.0300",
  // The file spells it `Contoso &amp; Co`; entity decoding is upstream's.
  company: "Contoso & Co",
  template: "Book.xltx",
  manager: "Jane Doe",
});

// No docProps at all. Asserted as the whole object so a key dropped for being
// null — what serde-wasm-bindgen does by default — fails here.
const missing = workbookProperties(read("workbook_properties_missing.xlsx"));
check("xlsx without docProps: all null, no key dropped", missing, NONE);

const xlsb = workbookProperties(read("issues.xlsb"));
check(
  "xlsb reads the same parts",
  [xlsb.creator, xlsb.application, xlsb.company],
  ["Johann Tuffe (jtuffe010814)", "Microsoft Excel", "SOCIETE GENERALE"],
);

// calamine does not read properties from these formats. An object of nulls
// would say the file has none, which nobody checked.
for (const file of ["date.xls", "date.ods"]) {
  let error = "";
  try {
    workbookProperties(read(file));
  } catch (e) {
    error = (e as Error).message;
  }
  check(
    `${file.split(".")[1]} throws rather than claiming no properties`,
    error.startsWith("could not read workbook properties"),
    true,
  );
}

console.log(failures === 0 ? "\nall property cases pass\n" : `\n${failures} FAILING\n`);
process.exitCode = failures === 0 ? 0 : 1;
