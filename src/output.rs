//! Convenience outputs: objects, CSV, Markdown.
//!
//! CSV and Markdown are built here, in Rust, and cross the boundary as a single
//! string. Nothing is allocated per cell on the JavaScript side.
//!
//! That makes CSV the cheapest materialised output, though not a free one —
//! rendering 1.8M cells to text still costs. Measured against a `parse only`
//! floor of 634 ms on that sheet: CSV 865 ms, JSON values 981 ms, tagged cells
//! 1.53 s. So the boundary shrinks rather than disappears.

use std::collections::HashMap;

use calamine::{Data, Range};
use serde_json::{Map, Value};

use crate::cells::{cell_to_json, cell_to_text};
use crate::dates::DatePolicy;

/// Spreadsheet column label: 0 → `A`, 25 → `Z`, 26 → `AA`.
pub fn column_label(mut index: usize) -> String {
    let mut label = String::new();
    loop {
        label.insert(0, (b'A' + (index % 26) as u8) as char);
        if index < 26 {
            return label;
        }
        index = index / 26 - 1;
    }
}

/// Column names taken from the first row.
///
/// A blank header becomes the column's spreadsheet label (`A`, `B`, …) rather
/// than an empty key. Repeats get a numeric suffix, so two columns called
/// `total` become `total` and `total_2` — losing one silently would be worse.
fn header_names(range: &Range<Data>, policy: DatePolicy) -> Vec<String> {
    let width = range.get_size().1;
    let first = range.rows().next();
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut names = Vec::with_capacity(width);

    for col in 0..width {
        let raw = first
            .and_then(|row| row.get(col))
            .map(|cell| cell_to_text(cell, policy))
            .unwrap_or_default();
        let base = if raw.trim().is_empty() {
            column_label(col)
        } else {
            raw
        };
        let count = seen.entry(base.clone()).or_insert(0);
        *count += 1;
        names.push(if *count == 1 {
            base
        } else {
            format!("{base}_{count}")
        });
    }
    names
}

/// Rows as arrays, header row included.
pub fn to_arrays(range: &Range<Data>, policy: DatePolicy, tagged: bool) -> Value {
    Value::Array(
        range
            .rows()
            .map(|row| {
                Value::Array(
                    row.iter()
                        .map(|c| cell_to_json(c, policy, tagged))
                        .collect(),
                )
            })
            .collect(),
    )
}

/// Rows as objects keyed by the first row.
pub fn to_objects(range: &Range<Data>, policy: DatePolicy, tagged: bool) -> Value {
    let names = header_names(range, policy);
    Value::Array(
        range
            .rows()
            .skip(1)
            .map(|row| {
                let mut object = Map::with_capacity(names.len());
                for (index, name) in names.iter().enumerate() {
                    let value = row
                        .get(index)
                        .map(|c| cell_to_json(c, policy, tagged))
                        .unwrap_or(Value::Null);
                    object.insert(name.clone(), value);
                }
                Value::Object(object)
            })
            .collect(),
    )
}

fn write_csv_field(out: &mut String, field: &str, delimiter: char) {
    let needs_quotes = field.contains(delimiter)
        || field.contains('"')
        || field.contains('\n')
        || field.contains('\r');
    if !needs_quotes {
        out.push_str(field);
        return;
    }
    out.push('"');
    for c in field.chars() {
        if c == '"' {
            out.push('"'); // RFC 4180: a quote inside a quoted field is doubled
        }
        out.push(c);
    }
    out.push('"');
}

/// RFC 4180 CSV, with `\n` line endings.
pub fn to_csv(range: &Range<Data>, policy: DatePolicy, delimiter: char) -> String {
    let mut out = String::new();
    for row in range.rows() {
        for (index, cell) in row.iter().enumerate() {
            if index > 0 {
                out.push(delimiter);
            }
            write_csv_field(&mut out, &cell_to_text(cell, policy), delimiter);
        }
        out.push('\n');
    }
    out
}

/// A pipe inside a cell would end the column early, and a newline would end the
/// row, so both are neutralised. `<br>` is what GitHub-flavoured Markdown
/// renders as a line break inside a table cell.
fn escape_markdown(field: &str) -> String {
    field
        .replace('\\', "\\\\")
        .replace('|', "\\|")
        .replace("\r\n", "<br>")
        .replace(['\n', '\r'], "<br>")
}

fn push_markdown_row<I: Iterator<Item = String>>(out: &mut String, fields: I) {
    out.push('|');
    for field in fields {
        out.push(' ');
        out.push_str(&escape_markdown(&field));
        out.push_str(" |");
    }
    out.push('\n');
}

/// A GitHub-flavoured Markdown table. The first row becomes the header, since
/// Markdown tables have no way to express a table without one.
pub fn to_markdown(range: &Range<Data>, policy: DatePolicy) -> String {
    let (height, width) = range.get_size();
    if height == 0 || width == 0 {
        return String::new();
    }

    // The header row goes out verbatim, *not* through `header_names`. Markdown
    // is a display format: two columns really called `total` should both read
    // `total`, and a blank header should stay blank. Renaming is only needed
    // when the names have to work as object keys.
    let header: Vec<String> = range
        .rows()
        .next()
        .map(|row| row.iter().map(|c| cell_to_text(c, policy)).collect())
        .unwrap_or_default();

    let mut out = String::new();
    push_markdown_row(&mut out, header.into_iter());

    out.push('|');
    for _ in 0..width {
        out.push_str(" --- |");
    }
    out.push('\n');

    for row in range.rows().skip(1) {
        push_markdown_row(&mut out, row.iter().map(|c| cell_to_text(c, policy)));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn range(rows: Vec<Vec<Data>>) -> Range<Data> {
        let height = rows.len() as u32;
        let width = rows.first().map_or(0, |r| r.len()) as u32;
        let mut range = Range::new((0, 0), (height.saturating_sub(1), width.saturating_sub(1)));
        for (r, row) in rows.into_iter().enumerate() {
            for (c, cell) in row.into_iter().enumerate() {
                range.set_value((r as u32, c as u32), cell);
            }
        }
        range
    }

    fn s(v: &str) -> Data {
        Data::String(v.to_string())
    }

    #[test]
    fn column_labels_roll_over() {
        assert_eq!(column_label(0), "A");
        assert_eq!(column_label(25), "Z");
        assert_eq!(column_label(26), "AA");
        assert_eq!(column_label(51), "AZ");
        assert_eq!(column_label(52), "BA");
        assert_eq!(column_label(701), "ZZ");
        assert_eq!(column_label(702), "AAA");
    }

    #[test]
    fn objects_keep_column_order() {
        // Alphabetical key order would be wrong; the sheet's order is the order.
        let r = range(vec![
            vec![s("zebra"), s("apple")],
            vec![Data::Float(1.0), Data::Float(2.0)],
        ]);
        let out = to_objects(&r, DatePolicy::Iso, false);
        let keys: Vec<&String> = out[0].as_object().unwrap().keys().collect();
        assert_eq!(keys, vec!["zebra", "apple"]);
    }

    #[test]
    fn duplicate_and_blank_headers_get_usable_names() {
        let r = range(vec![
            vec![s("total"), s("total"), Data::Empty],
            vec![Data::Float(1.0), Data::Float(2.0), Data::Float(3.0)],
        ]);
        let out = to_objects(&r, DatePolicy::Iso, false);
        assert_eq!(out[0], json!({ "total": 1.0, "total_2": 2.0, "C": 3.0 }));
    }

    #[test]
    fn csv_quotes_only_what_needs_it() {
        let r = range(vec![vec![
            s("plain"),
            s("has,comma"),
            s("has\"quote"),
            s("has\nnewline"),
        ]]);
        assert_eq!(
            to_csv(&r, DatePolicy::Iso, ','),
            "plain,\"has,comma\",\"has\"\"quote\",\"has\nnewline\"\n"
        );
    }

    #[test]
    fn csv_honours_a_different_delimiter() {
        // With semicolons, a comma is no longer special and must not be quoted.
        let r = range(vec![vec![s("a,b"), s("c;d")]]);
        assert_eq!(to_csv(&r, DatePolicy::Iso, ';'), "a,b;\"c;d\"\n");
    }

    #[test]
    fn markdown_neutralises_pipes_and_newlines() {
        let r = range(vec![vec![s("a"), s("b")], vec![s("x|y"), s("two\nlines")]]);
        assert_eq!(
            to_markdown(&r, DatePolicy::Iso),
            "| a | b |\n| --- | --- |\n| x\\|y | two<br>lines |\n"
        );
    }

    #[test]
    fn markdown_keeps_the_header_row_verbatim() {
        // Unlike `to_objects`, which must produce usable keys.
        let r = range(vec![
            vec![s("total"), s("total"), Data::Empty],
            vec![Data::Float(1.0), Data::Float(2.0), Data::Float(3.0)],
        ]);
        assert_eq!(
            to_markdown(&r, DatePolicy::Iso).lines().next().unwrap(),
            "| total | total |  |"
        );
    }

    #[test]
    fn empty_range_produces_nothing() {
        let r: Range<Data> = Range::empty();
        assert_eq!(to_markdown(&r, DatePolicy::Iso), "");
        assert_eq!(to_csv(&r, DatePolicy::Iso, ','), "");
    }
}
