//! The cell model.
//!
//! Two shapes, because two audiences want different things:
//!
//! - **values** — a bare JSON value per cell. Compact and easy, but a date cell
//!   and a text cell holding `"2020-01-01"` come out identical. Fine when you
//!   know your data.
//! - **tagged** — `{ "t": "date", "v": "2020-01-01T00:00:00.000" }`. Every cell
//!   says what it is. This is the faithful shape, and the one that survives
//!   round-tripping.
//!
//! The tags are `num`, `str`, `bool`, `date`, `dur` and `err`. Empty cells are
//! `null` in both shapes: a JSON null is already unambiguous, and empty cells
//! are common enough that wrapping them would cost real bytes for no gain.

use calamine::Data;
use serde_json::{json, Value};

use crate::dates::{
    duration_to_json, parse_iso_datetime, parse_iso_duration, Civil, DatePolicy,
};

/// Classifies a cell into a tag plus its value under the given date policy.
fn classify(cell: &Data, policy: DatePolicy) -> (&'static str, Value) {
    match cell {
        Data::Empty => ("empty", Value::Null),
        Data::String(s) => ("str", Value::String(s.clone())),
        Data::Int(i) => ("num", Value::from(*i)),
        Data::Float(f) => ("num", Value::from(*f)),
        Data::Bool(b) => ("bool", Value::Bool(*b)),
        Data::DateTime(dt) if dt.is_duration() => ("dur", duration_to_json(dt.as_f64(), policy)),
        Data::DateTime(dt) => ("date", Civil::from_excel(dt).to_json(policy)),
        // Already ISO in the file (ODS throughout, and xlsx `t="d"` cells).
        // Still routed through the policy so these cells answer to `dates` like
        // any other — otherwise asking for `serial` would return a string from
        // exactly these cells and the policy would be a lie.
        //
        // A string we cannot parse keeps the `date` tag rather than becoming a
        // `str`: the file says this cell is a date, and we only failed to
        // normalise it. Calling it text would destroy information the raw
        // string still carries.
        Data::DateTimeIso(s) => (
            "date",
            match parse_iso_datetime(s) {
                Some(civil) => civil.to_json(policy),
                None => Value::String(s.clone()),
            },
        ),
        Data::DurationIso(s) => (
            "dur",
            match parse_iso_duration(s) {
                Some(days) => duration_to_json(days, policy),
                None => Value::String(s.clone()),
            },
        ),
        // `Display` gives the Excel-facing spelling (`#DIV/0!`); the derived
        // `Debug` would leak Rust variant names (`Div0`) into the API.
        Data::Error(e) => ("err", Value::String(e.to_string())),
    }
}

pub fn cell_to_json(cell: &Data, policy: DatePolicy, tagged: bool) -> Value {
    let (tag, value) = classify(cell, policy);
    if !tagged || value.is_null() {
        return value;
    }
    json!({ "t": tag, "v": value })
}

/// Renders a cell as the text a person would expect to see — for CSV, for
/// Markdown, and for object keys taken from a header row.
///
/// Numbers are formatted with Rust's `Display` rather than through
/// `serde_json`, which would render the float `1.0` as `"1.0"`. A spreadsheet
/// shows `1`.
pub fn cell_to_text(cell: &Data, policy: DatePolicy) -> String {
    match classify(cell, policy).1 {
        Value::Null => String::new(),
        Value::String(s) => s,
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => match n.as_i64() {
            Some(i) => i.to_string(),
            None => n.as_f64().map(|f| format!("{f}")).unwrap_or_default(),
        },
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use calamine::{CellErrorType, ExcelDateTime, ExcelDateTimeType};

    fn date(serial: f64) -> Data {
        Data::DateTime(ExcelDateTime::new(serial, ExcelDateTimeType::DateTime, false))
    }

    fn duration(days: f64) -> Data {
        Data::DateTime(ExcelDateTime::new(days, ExcelDateTimeType::TimeDelta, false))
    }

    #[test]
    fn values_shape_is_bare() {
        let p = DatePolicy::Iso;
        assert_eq!(cell_to_json(&Data::Float(1.5), p, false), json!(1.5));
        assert_eq!(cell_to_json(&Data::String("a".into()), p, false), json!("a"));
        assert_eq!(cell_to_json(&Data::Empty, p, false), Value::Null);
    }

    #[test]
    fn tagged_shape_distinguishes_a_date_from_text_that_looks_like_one() {
        let p = DatePolicy::Iso;
        // The whole reason the tagged shape exists.
        let real_date = cell_to_json(&date(43831.0), p, true);
        let text = cell_to_json(&Data::String("2020-01-01T00:00:00.000".into()), p, true);
        assert_eq!(real_date, json!({ "t": "date", "v": "2020-01-01T00:00:00.000" }));
        assert_eq!(text, json!({ "t": "str", "v": "2020-01-01T00:00:00.000" }));
        assert_ne!(real_date, text);

        // Without tags they are genuinely indistinguishable, which is the
        // documented tradeoff rather than an oversight.
        assert_eq!(
            cell_to_json(&date(43831.0), p, false),
            cell_to_json(&Data::String("2020-01-01T00:00:00.000".into()), p, false)
        );
    }

    #[test]
    fn empty_stays_null_even_when_tagged() {
        assert_eq!(cell_to_json(&Data::Empty, DatePolicy::Iso, true), Value::Null);
    }

    #[test]
    fn durations_are_tagged_apart_from_dates() {
        let p = DatePolicy::Iso;
        assert_eq!(
            cell_to_json(&duration(1.5), p, true),
            json!({ "t": "dur", "v": "PT36H0M0S" })
        );
        // The same serial read as a date: day 1 is 1900-01-01, so 1.5 is midday
        // on the 1st — not 36 hours.
        assert_eq!(
            cell_to_json(&date(1.5), p, true),
            json!({ "t": "date", "v": "1900-01-01T12:00:00.000" })
        );
    }

    #[test]
    fn an_unparseable_iso_date_keeps_the_date_tag() {
        // The file says this is a date; we only failed to normalise it. Calling
        // it a string would throw away what the raw value still tells you.
        let cell = Data::DateTimeIso("2020-01-01T12:34:56Z".into());
        assert_eq!(
            cell_to_json(&cell, DatePolicy::Iso, true),
            json!({ "t": "date", "v": "2020-01-01T12:34:56Z" })
        );
    }

    #[test]
    fn errors_carry_the_excel_spelling() {
        assert_eq!(
            cell_to_json(&Data::Error(CellErrorType::Div0), DatePolicy::Iso, true),
            json!({ "t": "err", "v": "#DIV/0!" })
        );
    }

    #[test]
    fn text_rendering_matches_what_a_spreadsheet_shows() {
        let p = DatePolicy::Iso;
        // Not "1.0" — serde_json would render the float that way.
        assert_eq!(cell_to_text(&Data::Float(1.0), p), "1");
        assert_eq!(cell_to_text(&Data::Float(1.5), p), "1.5");
        assert_eq!(cell_to_text(&Data::Float(-0.0), p), "-0");
        assert_eq!(cell_to_text(&Data::Int(42), p), "42");
        assert_eq!(cell_to_text(&Data::Bool(true), p), "true");
        assert_eq!(cell_to_text(&Data::Empty, p), "");
        assert_eq!(cell_to_text(&date(43831.0), p), "2020-01-01T00:00:00.000");
        assert_eq!(cell_to_text(&Data::Error(CellErrorType::Ref), p), "#REF!");
    }
}
