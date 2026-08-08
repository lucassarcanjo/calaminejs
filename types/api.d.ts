// The shared API surface. Every entry point exposes exactly this; they differ
// only in how the wasm gets loaded, which is what index.d.ts and slim.d.ts add
// on top.
//
// These files are copied into dist/ verbatim by scripts/build.mjs. They live
// here rather than inside that script because they are type-checked: the test
// suites import the built package as TypeScript, so a declaration that does not
// match the runtime fails `bun run typecheck` instead of reaching a user.

/**
 * How a date or time cell is represented.
 *
 * A spreadsheet date is a civil (wall-clock) value with no timezone, while a JS
 * `Date` is an instant — converting one to the other has to invent an offset.
 * This picks who decides.
 */
export type DatePolicy =
  /** ISO-8601, no offset: `2025-10-13T12:59:02.400`. Also what `Temporal.PlainDateTime.from()` accepts. */
  | "iso"
  /** The raw Excel serial. */
  | "serial"
  /** Milliseconds since the Unix epoch, asserting the civil time is UTC. */
  | "epoch-millis";

/** A cell's type in the tagged shape. */
export type CellType = "num" | "str" | "bool" | "date" | "dur" | "err";

/** A cell when `tagged: true`. Empty cells are `null` rather than tagged. */
export type TaggedCell = { t: CellType; v: string | number | boolean } | null;

/** A cell when `tagged` is off. A date and text that looks like one are identical here. */
export type Cell = string | number | boolean | null;

/** A row from `toJsonParsed`, keyed by the header row. */
export type Row = Record<string, Cell>;

/** A row from `toJsonParsed` with `tagged: true`. */
export type TaggedRow = Record<string, TaggedCell>;

export interface ReadOptions {
  /** Sheet name. Defaults to the first sheet. */
  sheet?: string;
  /** @default "iso" */
  dates?: DatePolicy;
  /** Wrap each cell as `{ t, v }` so its type survives. @default false */
  tagged?: boolean;
}

export interface JsonOptions extends ReadOptions {
  /** `"first-row"` keys objects by the header row; `"none"` returns arrays. @default "first-row" */
  header?: "first-row" | "none";
}

export interface CsvOptions extends Omit<ReadOptions, "tagged"> {
  /** Exactly one character. @default "," */
  delimiter?: string;
}

export type MarkdownOptions = Omit<ReadOptions, "tagged">;

/** Sheet names, in workbook order. Cheap — only reads the workbook metadata. */
export function sheetNames(bytes: Uint8Array): string[];

/**
 * Rows of cells, as a JSON string. Parse it with `JSON.parse`, or use
 * {@link readCellsParsed}, which does that and knows the resulting type.
 *
 * The string is the primitive because only one value crosses the wasm boundary
 * however large the sheet is.
 */
export function readCells(bytes: Uint8Array, options?: ReadOptions): string;

/** Rows as objects keyed by the header row, as a JSON string. See {@link toJsonParsed}. */
export function toJson(bytes: Uint8Array, options?: JsonOptions): string;

/** RFC 4180 CSV, built in Rust so only one string crosses the boundary. */
export function toCsv(bytes: Uint8Array, options?: CsvOptions): string;

/** A GitHub-flavoured Markdown table, first row as the header. */
export function toMarkdown(bytes: Uint8Array, options?: MarkdownOptions): string;

/**
 * {@link readCells}, parsed — `JSON.parse` and nothing more.
 *
 * The return type follows `tagged`, which is the whole reason this exists:
 * `JSON.parse` returns `any`, so the hand-written cast at every call site was
 * the only thing keeping `Cell` and `TaggedCell` meaningful.
 *
 * Overload resolution needs `tagged` to be statically known. Passing an options
 * object typed as plain `ReadOptions` selects the untagged overload regardless
 * of the runtime value — annotate the literal `as const`, or cast the result,
 * when the flag is computed.
 */
export function readCellsParsed(
  bytes: Uint8Array,
  options: ReadOptions & { tagged: true },
): TaggedCell[][];
export function readCellsParsed(bytes: Uint8Array, options?: ReadOptions): Cell[][];

/**
 * {@link toJson}, parsed. The return type follows both `header` and `tagged`:
 * `header: "none"` gives arrays per row, anything else gives objects keyed by
 * the header row.
 */
export function toJsonParsed(
  bytes: Uint8Array,
  options: JsonOptions & { header: "none"; tagged: true },
): TaggedCell[][];
export function toJsonParsed(
  bytes: Uint8Array,
  options: JsonOptions & { header: "none" },
): Cell[][];
export function toJsonParsed(
  bytes: Uint8Array,
  options: JsonOptions & { tagged: true },
): TaggedRow[];
export function toJsonParsed(bytes: Uint8Array, options?: JsonOptions): Row[];
