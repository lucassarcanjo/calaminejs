//! Spike: calamine compiled to wasm32-unknown-unknown.
//!
//! Two questions this crate exists to answer:
//!
//! 1. How much of the wall-clock time is calamine parsing vs. the JS/wasm
//!    boundary? Hence `parse_only` (the floor) alongside two ways of handing
//!    the same data back.
//! 2. What should a spreadsheet date become in JS? See `DatePolicy`.

use std::io::Cursor;

use calamine::{open_workbook_auto_from_rs, Data, ExcelDateTime, Range, Reader};
use serde_json::Value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
fn start() {
    console_error_panic_hook::set_once();
}

/// How a date/time cell is represented on the JS side.
///
/// Excel stores a date as a plain number plus a display format. There is no
/// timezone anywhere in the file — calamine's own docs are explicit that the
/// format "doesn't use or encode timezone information in any way". So the
/// value is a *civil* (wall-clock) date-time, and any conversion to a JS
/// `Date`, which is an instant, has to invent an offset. This enum makes that
/// choice the caller's instead of guessing.
#[derive(Clone, Copy, PartialEq)]
enum DatePolicy {
    /// ISO-8601 with no offset: `2025-10-13T12:59:02.400`. Lossless, and it is
    /// exactly the serialisation `Temporal.PlainDateTime.from()` accepts.
    /// The time part is always emitted, even at midnight — `new Date()` parses
    /// a bare `2020-01-01` as UTC but `2020-01-01T00:00:00.000` as local, so a
    /// uniform shape avoids handing callers that inconsistency.
    Iso,
    /// The raw serial, untouched. For callers doing their own date maths.
    Serial,
    /// Milliseconds since the Unix epoch, obtained by *asserting* the civil
    /// time is UTC. Feeds `new Date(n)` directly. Convenient and deterministic,
    /// but it is an assertion the file does not support.
    EpochMillis,
}

impl DatePolicy {
    fn parse(value: Option<String>) -> Result<Self, JsError> {
        match value.as_deref() {
            None | Some("iso") => Ok(Self::Iso),
            Some("serial") => Ok(Self::Serial),
            Some("epoch-millis") => Ok(Self::EpochMillis),
            Some(other) => Err(JsError::new(&format!(
                "unknown dates option {other:?}; expected \"iso\", \"serial\" or \"epoch-millis\""
            ))),
        }
    }
}

/// Days from 1970-01-01 for a civil date. Howard Hinnant's algorithm; valid
/// well beyond Excel's range and, unlike a serial-offset shortcut, indifferent
/// to whether the workbook used the 1900 or 1904 epoch.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn datetime_to_json(dt: &ExcelDateTime, policy: DatePolicy) -> Value {
    if policy == DatePolicy::Serial {
        return Value::from(dt.as_f64());
    }

    let (y, mo, d, h, mi, s, ms) = dt.to_ymd_hms_milli();

    match policy {
        DatePolicy::Iso => Value::String(format!(
            "{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{ms:03}"
        )),
        DatePolicy::EpochMillis => {
            let days = days_from_civil(y as i64, mo as i64, d as i64);
            let millis = days * 86_400_000
                + h as i64 * 3_600_000
                + mi as i64 * 60_000
                + s as i64 * 1_000
                + ms as i64;
            Value::from(millis)
        }
        DatePolicy::Serial => unreachable!("handled above"),
    }
}

/// A duration is *not* a date. A cell formatted `[h]:mm:ss` holding 1.5 means
/// 36 hours, not 1900-01-01T12:00. Calling `to_ymd_hms_milli` on it would
/// silently produce a nonsense date, so durations get their own path: an
/// ISO-8601 duration string, or raw days under the `serial` policy.
fn duration_to_json(dt: &ExcelDateTime, policy: DatePolicy) -> Value {
    let days = dt.as_f64();
    if policy == DatePolicy::Serial {
        return Value::from(days);
    }

    let total_ms = (days * 86_400_000.0).round() as i64;
    if policy == DatePolicy::EpochMillis {
        return Value::from(total_ms);
    }

    let sign = if total_ms < 0 { "-" } else { "" };
    let abs = total_ms.abs();
    let (h, m, s, ms) = (
        abs / 3_600_000,
        (abs / 60_000) % 60,
        (abs / 1_000) % 60,
        abs % 1_000,
    );
    Value::String(if ms == 0 {
        format!("{sign}PT{h}H{m}M{s}S")
    } else {
        format!("{sign}PT{h}H{m}M{s}.{ms:03}S")
    })
}

fn cell_to_json(cell: &Data, policy: DatePolicy) -> Value {
    match cell {
        Data::Empty => Value::Null,
        Data::String(s) => Value::String(s.clone()),
        Data::Int(i) => Value::from(*i),
        Data::Float(f) => Value::from(*f),
        Data::Bool(b) => Value::Bool(*b),
        Data::DateTime(dt) if dt.is_duration() => duration_to_json(dt, policy),
        Data::DateTime(dt) => datetime_to_json(dt, policy),
        // Already ISO-8601 in the file; pass through untouched.
        Data::DateTimeIso(s) | Data::DurationIso(s) => Value::String(s.clone()),
        Data::Error(e) => Value::String(format!("#ERR:{e:?}")),
    }
}

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

fn to_rows(range: &Range<Data>, policy: DatePolicy) -> Vec<Vec<Value>> {
    range
        .rows()
        .map(|row| row.iter().map(|c| cell_to_json(c, policy)).collect())
        .collect()
}

/// List sheet names. Cheap — only touches the workbook metadata.
#[wasm_bindgen]
pub fn sheet_names(bytes: &[u8]) -> Result<Vec<String>, JsError> {
    let workbook = open_workbook_auto_from_rs(Cursor::new(bytes))
        .map_err(|e| JsError::new(&format!("could not open workbook: {e}")))?;
    Ok(workbook.sheet_names())
}

/// Baseline: full parse, nothing crosses the boundary but a single integer.
/// Everything above this number is boundary overhead.
#[wasm_bindgen]
pub fn parse_only(bytes: &[u8], sheet: Option<String>) -> Result<usize, JsError> {
    let range = read_range(bytes, sheet)?;
    Ok(range.used_cells().count())
}

/// Strategy A: serialise to a JSON string in Rust, let the caller `JSON.parse`.
#[wasm_bindgen]
pub fn sheet_to_json(
    bytes: &[u8],
    sheet: Option<String>,
    dates: Option<String>,
) -> Result<String, JsError> {
    let policy = DatePolicy::parse(dates)?;
    let range = read_range(bytes, sheet)?;
    serde_json::to_string(&to_rows(&range, policy))
        .map_err(|e| JsError::new(&format!("could not serialise sheet: {e}")))
}

/// Strategy B: build the JS values directly through serde-wasm-bindgen.
#[wasm_bindgen]
pub fn sheet_to_jsvalue(
    bytes: &[u8],
    sheet: Option<String>,
    dates: Option<String>,
) -> Result<JsValue, JsError> {
    let policy = DatePolicy::parse(dates)?;
    let range = read_range(bytes, sheet)?;
    serde_wasm_bindgen::to_value(&to_rows(&range, policy))
        .map_err(|e| JsError::new(&format!("could not convert sheet: {e}")))
}
