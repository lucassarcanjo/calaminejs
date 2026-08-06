//! Dumps a workbook as calamine natively sees it, before any of this crate's
//! opinions are applied.
//!
//! This is the reference side of the differential test. It deliberately does
//! *not* call `cell_to_json` — it reflects the raw `Data` enum, so the JS
//! harness can recompute the expected output independently and catch a bug in
//! our mapping. Comparing our own conversion against itself would only prove
//! the wasm target behaves like the host, which is the weaker claim.

use std::io::Cursor;

use calamine::{open_workbook_auto_from_rs, Data, Reader};
use serde_json::{json, Value};

fn cell(data: &Data) -> Value {
    match data {
        Data::Empty => json!({ "t": "empty" }),
        Data::String(s) => json!({ "t": "str", "v": s }),
        Data::Int(i) => json!({ "t": "int", "v": i }),
        Data::Float(f) => json!({ "t": "float", "v": f }),
        Data::Bool(b) => json!({ "t": "bool", "v": b }),
        Data::DateTime(dt) => {
            let (y, mo, d, h, mi, s, ms) = dt.to_ymd_hms_milli();
            json!({
                "t": "datetime",
                "serial": dt.as_f64(),
                "duration": dt.is_duration(),
                // calamine's own serial -> civil conversion. Reimplementing it
                // in JS would be testing calamine, not us.
                "civil": [y, mo, d, h, mi, s, ms],
            })
        }
        Data::DateTimeIso(s) => json!({ "t": "dtiso", "v": s }),
        Data::DurationIso(s) => json!({ "t": "duriso", "v": s }),
        Data::Error(e) => json!({ "t": "err", "v": e.to_string() }),
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("usage: dump_native <workbook>");

    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            println!("{}", json!({ "error": format!("read failed: {e}") }));
            return;
        }
    };

    let mut workbook = match open_workbook_auto_from_rs(Cursor::new(&bytes[..])) {
        Ok(wb) => wb,
        Err(e) => {
            println!("{}", json!({ "error": format!("could not open workbook: {e}") }));
            return;
        }
    };

    let mut sheets = Vec::new();
    for name in workbook.sheet_names() {
        match workbook.worksheet_range(&name) {
            Ok(range) => {
                let rows: Vec<Vec<Value>> = range
                    .rows()
                    .map(|row| row.iter().map(cell).collect())
                    .collect();
                sheets.push(json!({ "name": name, "rows": rows }));
            }
            // A sheet that fails to read is data too: the wasm side must fail
            // on the same sheet, not silently skip it.
            Err(e) => sheets.push(json!({ "name": name, "error": e.to_string() })),
        }
    }

    println!("{}", json!({ "sheets": sheets }));
}
