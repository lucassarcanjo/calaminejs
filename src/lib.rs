//! calamine, compiled to WebAssembly.
//!
//! Reads xlsx / xls / xlsb / ods from bytes and hands the contents to
//! JavaScript in whichever shape the caller wants: values, tagged cells,
//! objects, CSV or Markdown.
//!
//! Every function takes the file as bytes and an options object. Nothing here
//! touches a filesystem — that is the caller's job, and it is what lets the
//! same artifact run in Node, Bun, Deno, a browser and an edge worker.

mod cells;
mod dates;
mod output;

use std::io::Cursor;

use calamine::{open_workbook_auto_from_rs, Data, Range, Reader};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

use crate::dates::DatePolicy;

#[wasm_bindgen(start)]
fn start() {
    console_error_panic_hook::set_once();
}

/// Which row supplies the object keys.
#[derive(Clone, Copy, PartialEq, Debug, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Header {
    /// Use the first row as keys and return objects.
    #[default]
    FirstRow,
    /// No header; return an array per row, first row included.
    None,
}

/// `deny_unknown_fields` is deliberate. A typo like `{ sheets: "Data" }` would
/// otherwise be ignored and quietly read the wrong sheet.
macro_rules! options {
    ($name:ident { $($field:ident : $ty:ty = $default:expr),* $(,)? }) => {
        // `default` at the struct level fills missing fields from this struct's
        // own `Default`. Per-field `default` would use each *type's* default
        // instead, which silently turned an absent `delimiter` into "".
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields, default)]
        struct $name {
            $($field: $ty),*
        }
        impl Default for $name {
            fn default() -> Self {
                Self { $($field: $default),* }
            }
        }
        impl $name {
            /// Field names as JavaScript spells them. All are single words, so
            /// they survive `rename_all = "camelCase"` unchanged — a multi-word
            /// field added later would need its camelCase spelling here.
            const ALLOWED: &'static [&'static str] = &[$(stringify!($field)),*];

            fn from_js(value: JsValue) -> Result<Self, JsError> {
                if value.is_undefined() || value.is_null() {
                    return Ok(Self::default());
                }

                // serde's `deny_unknown_fields` does nothing here: for a struct,
                // serde-wasm-bindgen looks up each known field by name instead
                // of walking the object, so extra keys are never seen. Checking
                // by hand is what actually stops `{ sheets: "Data" }` from
                // silently reading the wrong sheet.
                if let Some(object) = value.dyn_ref::<js_sys::Object>() {
                    for key in js_sys::Object::keys(object).iter() {
                        let key = key.as_string().unwrap_or_default();
                        if !Self::ALLOWED.contains(&key.as_str()) {
                            return Err(JsError::new(&format!(
                                "unknown option {:?}; expected one of: {}",
                                key,
                                Self::ALLOWED.join(", ")
                            )));
                        }
                    }
                }

                serde_wasm_bindgen::from_value(value)
                    .map_err(|e| JsError::new(&format!("invalid options: {e}")))
            }
        }
    };
}

options!(ReadOptions {
    sheet: Option<String> = None,
    dates: DatePolicy = DatePolicy::default(),
    tagged: bool = false,
});

options!(JsonOptions {
    sheet: Option<String> = None,
    dates: DatePolicy = DatePolicy::default(),
    tagged: bool = false,
    header: Header = Header::default(),
});

options!(CsvOptions {
    sheet: Option<String> = None,
    dates: DatePolicy = DatePolicy::default(),
    delimiter: String = ",".to_string(),
});

options!(MarkdownOptions {
    sheet: Option<String> = None,
    dates: DatePolicy = DatePolicy::default(),
});

fn read_range(bytes: &[u8], sheet: Option<String>) -> Result<Range<Data>, JsError> {
    let mut workbook = open_workbook_auto_from_rs(Cursor::new(bytes))
        .map_err(|e| JsError::new(&format!("could not open workbook: {e}")))?;

    let name = match sheet {
        Some(name) => name,
        None => workbook
            .sheet_names()
            .first()
            .cloned()
            .ok_or_else(|| JsError::new("workbook contains no sheets"))?,
    };

    workbook
        .worksheet_range(&name)
        .map_err(|e| JsError::new(&format!("could not read sheet {name:?}: {e}")))
}

fn to_json_string(value: &serde_json::Value) -> Result<String, JsError> {
    serde_json::to_string(value).map_err(|e| JsError::new(&format!("could not serialise: {e}")))
}

/// Sheet names, in workbook order. Cheap — only reads the workbook metadata.
#[wasm_bindgen(js_name = sheetNames)]
pub fn sheet_names(bytes: &[u8]) -> Result<Vec<String>, JsError> {
    let workbook = open_workbook_auto_from_rs(Cursor::new(bytes))
        .map_err(|e| JsError::new(&format!("could not open workbook: {e}")))?;
    Ok(workbook.sheet_names())
}

/// Rows of cells, as a JSON string for the caller to parse.
///
/// With `tagged: true` every cell becomes `{ t, v }` and a date is
/// distinguishable from text that looks like one. Without it, cells are bare
/// values and that distinction is lost — which is fine when you know your data
/// and want the smallest payload.
#[wasm_bindgen(js_name = readCells)]
pub fn read_cells(bytes: &[u8], options: JsValue) -> Result<String, JsError> {
    let options = ReadOptions::from_js(options)?;
    let range = read_range(bytes, options.sheet)?;
    to_json_string(&output::to_arrays(&range, options.dates, options.tagged))
}

/// Rows as objects keyed by the header row, as a JSON string.
#[wasm_bindgen(js_name = toJson)]
pub fn to_json(bytes: &[u8], options: JsValue) -> Result<String, JsError> {
    let options = JsonOptions::from_js(options)?;
    let range = read_range(bytes, options.sheet)?;
    let value = match options.header {
        Header::FirstRow => output::to_objects(&range, options.dates, options.tagged),
        Header::None => output::to_arrays(&range, options.dates, options.tagged),
    };
    to_json_string(&value)
}

/// RFC 4180 CSV. Built entirely in Rust, so only one string crosses the
/// boundary however large the sheet is.
#[wasm_bindgen(js_name = toCsv)]
pub fn to_csv(bytes: &[u8], options: JsValue) -> Result<String, JsError> {
    let options = CsvOptions::from_js(options)?;
    let mut chars = options.delimiter.chars();
    let delimiter = match (chars.next(), chars.next()) {
        (Some(c), None) => c,
        _ => {
            return Err(JsError::new(&format!(
                "delimiter must be exactly one character, got {:?}",
                options.delimiter
            )))
        }
    };
    let range = read_range(bytes, options.sheet)?;
    Ok(output::to_csv(&range, options.dates, delimiter))
}

/// A GitHub-flavoured Markdown table, first row as the header.
#[wasm_bindgen(js_name = toMarkdown)]
pub fn to_markdown(bytes: &[u8], options: JsValue) -> Result<String, JsError> {
    let options = MarkdownOptions::from_js(options)?;
    let range = read_range(bytes, options.sheet)?;
    Ok(output::to_markdown(&range, options.dates))
}

/// Benchmark instrumentation: parses fully and returns a single integer, so the
/// time it takes is the floor below which no output shape can go. Anything
/// above it is what the JS/wasm boundary costs.
#[wasm_bindgen(js_name = parseOnly)]
pub fn parse_only(bytes: &[u8], options: JsValue) -> Result<usize, JsError> {
    let options = ReadOptions::from_js(options)?;
    let range = read_range(bytes, options.sheet)?;
    Ok(range.used_cells().count())
}

/// Benchmark instrumentation: the same rows built as JS values through
/// serde-wasm-bindgen instead of a JSON string, to compare the two boundary
/// strategies.
#[wasm_bindgen(js_name = readCellsAsValue)]
pub fn read_cells_as_value(bytes: &[u8], options: JsValue) -> Result<JsValue, JsError> {
    let options = ReadOptions::from_js(options)?;
    let range = read_range(bytes, options.sheet)?;
    serde_wasm_bindgen::to_value(&output::to_arrays(&range, options.dates, options.tagged))
        .map_err(|e| JsError::new(&format!("could not convert sheet: {e}")))
}
