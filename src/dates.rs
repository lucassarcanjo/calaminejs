//! Spreadsheet dates, and the single decision this library refuses to make for
//! you.
//!
//! Excel stores a date as a plain number plus a display format. There is no
//! timezone anywhere in the file — calamine's own docs are explicit that the
//! format "doesn't use or encode timezone information in any way". So the value
//! is a *civil* (wall-clock) date-time, while a JS `Date` is an instant.
//! Converting one to the other has to invent an offset, and that invention is
//! where most spreadsheet libraries go wrong. [`DatePolicy`] hands the choice
//! to the caller instead of guessing.

use calamine::ExcelDateTime;
use serde::Deserialize;
use serde_json::Value;

/// How a date/time cell is represented on the JS side.
#[derive(Clone, Copy, PartialEq, Debug, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DatePolicy {
    /// ISO-8601 with no offset: `2025-10-13T12:59:02.400`. Lossless, and it is
    /// exactly the serialisation `Temporal.PlainDateTime.from()` accepts, so
    /// callers on a runtime with Temporal get a real date object for free.
    ///
    /// The time part is always emitted, even at midnight — `new Date()` parses
    /// a bare `2020-01-01` as UTC but `2020-01-01T00:00:00.000` as local, so a
    /// uniform shape keeps that inconsistency away from callers.
    #[default]
    Iso,
    /// The raw serial, untouched. For callers doing their own date maths.
    Serial,
    /// Milliseconds since the Unix epoch, obtained by *asserting* the civil
    /// time is UTC. Feeds `new Date(n)` directly. Convenient and deterministic,
    /// but it is an assertion the file does not support.
    EpochMillis,
}

/// Days from 1970-01-01 for a civil date. Howard Hinnant's algorithm; valid
/// well beyond Excel's range and, unlike a serial-offset shortcut, indifferent
/// to whether the workbook used the 1900 or 1904 epoch.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Days from 1899-12-30 (serial 0 in the 1900 system) to 1970-01-01.
const UNIX_EPOCH_SERIAL: i64 = 25_569;

/// Civil date-time components — the common currency between the three ways a
/// date reaches us: an Excel serial, an ISO string already in the file, and a
/// duration. Routing all of them through one type is what keeps [`DatePolicy`]
/// honest no matter which the file happened to use.
#[derive(Clone, Copy)]
pub struct Civil {
    pub y: i64,
    pub mo: u8,
    pub d: u8,
    pub h: u8,
    pub mi: u8,
    pub s: u8,
    pub ms: u16,
}

impl Civil {
    pub fn from_excel(dt: &ExcelDateTime) -> Self {
        let (y, mo, d, h, mi, s, ms) = dt.to_ymd_hms_milli();
        Self { y: y as i64, mo, d, h, mi, s, ms }
    }

    fn millis_of_day(&self) -> i64 {
        self.h as i64 * 3_600_000 + self.mi as i64 * 60_000 + self.s as i64 * 1_000 + self.ms as i64
    }

    pub fn to_iso(self) -> String {
        let Civil { y, mo, d, h, mi, s, ms } = self;
        format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{ms:03}")
    }

    fn to_epoch_millis(self) -> i64 {
        days_from_civil(self.y, self.mo as i64, self.d as i64) * 86_400_000 + self.millis_of_day()
    }

    /// Note: for dates before 1900-03-01 this disagrees with Excel by a day,
    /// because Excel's numbering there is built on its belief that 1900 was a
    /// leap year. Reading a serial is exact; only this reverse direction is
    /// affected, and only for a range no real workbook uses as a date.
    fn to_serial(self) -> f64 {
        let days = days_from_civil(self.y, self.mo as i64, self.d as i64) + UNIX_EPOCH_SERIAL;
        days as f64 + self.millis_of_day() as f64 / 86_400_000.0
    }

    pub fn to_json(self, policy: DatePolicy) -> Value {
        match policy {
            DatePolicy::Iso => Value::String(self.to_iso()),
            DatePolicy::EpochMillis => Value::from(self.to_epoch_millis()),
            DatePolicy::Serial => Value::from(self.to_serial()),
        }
    }
}

/// Parses the ISO-8601 date-times that appear verbatim in a file — ODS uses
/// them throughout, and xlsx `t="d"` cells carry them too. Without this, a
/// caller asking for `serial` would get a string back from those cells and
/// nothing else, which would make the policy a lie.
///
/// Strict by design: anything not fully understood returns `None` and is passed
/// through to the caller verbatim rather than half-converted. Two cases make
/// that the only honest option:
///
/// - `2020-01-01T12:34:56Z` and `...+05:00` carry an offset, which makes them
///   instants. [`Civil`] cannot hold an offset, so converting would silently
///   drop it and quietly move the value by hours.
/// - `2020-01-01T12:34` is a time we cannot read in full. Treating it as
///   date-only would silently discard 12:34.
pub fn parse_iso_datetime(s: &str) -> Option<Civil> {
    let bytes = s.as_bytes();
    if bytes.len() < 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let num = |range: std::ops::Range<usize>| s.get(range)?.parse::<u32>().ok();

    let y = num(0..4)? as i64;
    let mo = num(5..7)? as u8;
    let d = num(8..10)? as u8;

    // Date-only is legal and common (ODS writes it for date cells).
    let (mut h, mut mi, mut sec, mut ms) = (0u8, 0u8, 0u8, 0u16);
    if bytes.len() > 10 {
        if bytes.len() < 19
            || (bytes[10] != b'T' && bytes[10] != b' ')
            || bytes[13] != b':'
            || bytes[16] != b':'
        {
            return None;
        }
        h = num(11..13)? as u8;
        mi = num(14..16)? as u8;
        sec = num(17..19)? as u8;

        let tail = &s[19..];
        if !tail.is_empty() {
            // Only fractional seconds are understood here. Anything else is a
            // timezone designator, and see above.
            let frac = tail.strip_prefix('.')?;
            if frac.is_empty() || !frac.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            // Left-align to milliseconds: ".5" is 500ms, ".0005" is 0ms.
            ms = format!("{frac:0<3}")[..3].parse::<u16>().ok()?;
        }
    }

    // Reject impossible components rather than emitting a nonsense ISO string.
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 59 {
        return None;
    }
    Some(Civil { y, mo, d, h, mi, s: sec, ms })
}

/// Parses `PT36H0M0S` / `-PT1H30M` / `P1DT2H` into days, matching the units
/// calamine uses for durations elsewhere.
pub fn parse_iso_duration(s: &str) -> Option<f64> {
    let (sign, rest) = match s.strip_prefix('-') {
        Some(rest) => (-1.0, rest),
        None => (1.0, s),
    };
    let rest = rest.strip_prefix('P')?;
    let (date_part, time_part, had_t) = match rest.split_once('T') {
        Some((d, t)) => (d, t, true),
        None => (rest, "", false),
    };
    // "P1DT" — a designator introducing nothing.
    if had_t && time_part.is_empty() {
        return None;
    }

    let mut days = 0.0;
    let mut number = String::new();
    let mut components = 0;
    for c in date_part.chars() {
        if c.is_ascii_digit() || c == '.' {
            number.push(c);
        } else {
            let value: f64 = number.parse().ok()?;
            number.clear();
            components += 1;
            days += match c {
                'D' => value,
                'W' => value * 7.0,
                // Y and M are not fixed-length, so refuse rather than guess.
                _ => return None,
            };
        }
    }
    for c in time_part.chars() {
        if c.is_ascii_digit() || c == '.' {
            number.push(c);
        } else {
            let value: f64 = number.parse().ok()?;
            number.clear();
            components += 1;
            days += match c {
                'H' => value / 24.0,
                'M' => value / 1_440.0,
                'S' => value / 86_400.0,
                _ => return None,
            };
        }
    }
    if !number.is_empty() {
        return None; // trailing digits with no unit
    }
    // ISO-8601 requires at least one component: bare "P" and "PT" are not
    // zero-length durations, they are not durations. Without this they parsed
    // as 0 and a meaningless string became a confident-looking value.
    if components == 0 {
        return None;
    }
    Some(sign * days)
}

/// Renders a duration.
///
/// A duration is *not* a date. A cell formatted `[h]:mm:ss` holding 1.5 means
/// 36 hours, not 1900-01-01T12:00. Treating it as a serial date would silently
/// produce a nonsense date in 1900, so durations get their own path.
///
/// Under `epoch-millis` the result is a count of milliseconds, not a point in
/// time — there is no instant to report for "36 hours".
pub fn duration_to_json(days: f64, policy: DatePolicy) -> Value {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn iso(s: &str) -> Option<String> {
        parse_iso_datetime(s).map(Civil::to_iso)
    }

    #[test]
    fn parses_iso_datetimes() {
        assert_eq!(iso("2020-01-01").unwrap(), "2020-01-01T00:00:00.000");
        assert_eq!(iso("2020-01-01T12:34:56").unwrap(), "2020-01-01T12:34:56.000");
        // Fractional seconds are left-aligned to milliseconds, not read as an integer.
        assert_eq!(iso("2020-01-01T12:34:56.5").unwrap(), "2020-01-01T12:34:56.500");
        assert_eq!(iso("2020-01-01T12:34:56.25").unwrap(), "2020-01-01T12:34:56.250");
        assert_eq!(iso("2020-01-01T12:34:56.123456").unwrap(), "2020-01-01T12:34:56.123");
        // A space separator shows up in the wild.
        assert_eq!(iso("2020-01-01 12:34:56").unwrap(), "2020-01-01T12:34:56.000");
    }

    #[test]
    fn refuses_to_half_understand_a_datetime() {
        // An offset makes this an instant; Civil cannot hold one, and dropping
        // it would move the value by hours without saying so.
        assert!(iso("2020-01-01T12:34:56Z").is_none());
        assert!(iso("2020-01-01T12:34:56+05:00").is_none());
        assert!(iso("2020-01-01T12:34:56-08:00").is_none());
        // Truncated time: treating it as date-only would discard 12:34.
        assert!(iso("2020-01-01T12:34").is_none());
        assert!(iso("2020-01-01T12").is_none());
        // Impossible components produce a nonsense ISO string if waved through.
        assert!(iso("2020-13-01T00:00:00").is_none());
        assert!(iso("2020-01-32T00:00:00").is_none());
        assert!(iso("2020-01-01T24:00:00").is_none());
        assert!(iso("2020-01-01T00:60:00").is_none());
        assert!(iso("2020-00-01").is_none());
        // Trailing junk after an otherwise valid fraction.
        assert!(iso("2020-01-01T12:34:56.123abc").is_none());
    }

    #[test]
    fn rejects_non_iso_datetimes() {
        assert!(iso("not a date").is_none());
        assert!(iso("2020-1-1").is_none());
        assert!(iso("").is_none());
        assert!(iso("2020-01").is_none());
    }

    #[test]
    fn parses_iso_durations() {
        let day = 86_400.0;
        assert_eq!(parse_iso_duration("PT36H0M0S").unwrap(), 1.5);
        assert_eq!(parse_iso_duration("P1DT12H").unwrap(), 1.5);
        assert_eq!(parse_iso_duration("P1W").unwrap(), 7.0);
        assert!((parse_iso_duration("PT0.5S").unwrap() - 0.5 / day).abs() < 1e-12);
        assert!((parse_iso_duration("-PT1H30M").unwrap() + 1.5 / 24.0).abs() < 1e-12);
    }

    #[test]
    fn rejects_ambiguous_or_malformed_durations() {
        // Years and months are not a fixed number of days; refuse rather than guess.
        assert!(parse_iso_duration("P1Y").is_none());
        assert!(parse_iso_duration("P1M").is_none());
        assert!(parse_iso_duration("PT36").is_none()); // digits with no unit
        assert!(parse_iso_duration("36H").is_none()); // no leading P
        assert!(parse_iso_duration("").is_none());
        // Caught by the differential test, not by these: a designator with no
        // components parsed as 0.0, turning a meaningless string into a
        // confident-looking value.
        assert!(parse_iso_duration("P").is_none());
        assert!(parse_iso_duration("PT").is_none());
        assert!(parse_iso_duration("-PT").is_none());
        assert!(parse_iso_duration("P1DT").is_none());
        assert!(parse_iso_duration("PT1X").is_none());
    }

    #[test]
    fn serial_round_trips_through_civil() {
        // calamine's own documented example.
        let dt = ExcelDateTime::new(45943.541, calamine::ExcelDateTimeType::DateTime, false);
        let civil = Civil::from_excel(&dt);
        assert_eq!(civil.to_iso(), "2025-10-13T12:59:02.400");
        assert!((civil.to_serial() - 45943.541).abs() < 1e-9);
    }

    #[test]
    fn epoch_millis_matches_a_known_instant() {
        // 2020-01-01T00:00:00Z
        let dt = ExcelDateTime::new(43831.0, calamine::ExcelDateTimeType::DateTime, false);
        assert_eq!(Civil::from_excel(&dt).to_epoch_millis(), 1_577_836_800_000);
    }

    #[test]
    fn days_from_civil_handles_negative_years() {
        // The pre-year-0 branch is reachable from a hostile file carrying a
        // large negative serial, so it must not be silently wrong. Asserted as
        // relationships rather than magic constants: a day-count function is
        // correct iff consecutive days differ by exactly one, across every
        // boundary that has ever hidden an off-by-one.
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(1969, 12, 31), -1);
        assert_eq!(days_from_civil(1900, 1, 1), -25_567); // 70y = 25550 + 17 leaps

        // Hinnant's algorithm is anchored at 0000-03-01.
        assert_eq!(days_from_civil(0, 3, 1), -719_468);

        // Year 0 is a leap year in the proleptic Gregorian calendar (÷400),
        // so 0000-02-29 exists and is the day before the anchor.
        assert_eq!(days_from_civil(0, 2, 29), days_from_civil(0, 3, 1) - 1);

        // Crossing from a negative year into year 0 must stay contiguous.
        assert_eq!(days_from_civil(-1, 12, 31) + 1, days_from_civil(0, 1, 1));
        assert_eq!(days_from_civil(-1, 12, 31), -719_529);

        // And every step across the -1/0 boundary is one day.
        for (a, b) in [
            ((-1, 12, 30), (-1, 12, 31)),
            ((-1, 12, 31), (0, 1, 1)),
            ((0, 1, 1), (0, 1, 2)),
            ((0, 2, 28), (0, 2, 29)),
        ] {
            assert_eq!(
                days_from_civil(a.0, a.1, a.2) + 1,
                days_from_civil(b.0, b.1, b.2),
                "{a:?} -> {b:?}"
            );
        }
    }
}
