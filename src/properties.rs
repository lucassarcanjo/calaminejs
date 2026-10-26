//! Workbook document properties — author, title, dates and the rest of what a
//! spreadsheet application writes about the file rather than in it.
//!
//! calamine reads these from `docProps/core.xml` and `docProps/app.xml` for
//! xlsx, and from the same parts of an xlsb. It does not read them for xls or
//! ods, and says so with an error rather than an empty struct. That is kept:
//! an all-`null` result would claim the file has no properties, when the truth
//! is that nobody looked.

use calamine::WorkbookProperties;
use serde::Serialize;

/// The JS shape. Every field is always present and `null` when the file does
/// not set it, so callers can destructure without guarding for `undefined` and
/// a missing property cannot be confused with a misspelt key.
///
/// Mirrored field by field rather than derived on calamine's struct, which is
/// `#[non_exhaustive]` and has no `Serialize`. A field added upstream therefore
/// stays out of the API until someone adds it here and to `types/api.d.ts`,
/// which is the order those two should change in anyway.
///
/// `created` and `modified` are passed through as the file spells them —
/// W3CDTF, normally with a `Z`. That makes them instants, not civil times, so
/// the `dates` policy that governs cells does not apply to them.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Properties {
    creator: Option<String>,
    last_modified_by: Option<String>,
    created: Option<String>,
    modified: Option<String>,
    title: Option<String>,
    subject: Option<String>,
    description: Option<String>,
    keywords: Option<String>,
    category: Option<String>,
    content_status: Option<String>,
    revision: Option<String>,
    version: Option<String>,
    application: Option<String>,
    app_version: Option<String>,
    company: Option<String>,
    template: Option<String>,
    manager: Option<String>,
}

impl From<WorkbookProperties> for Properties {
    fn from(p: WorkbookProperties) -> Self {
        Self {
            creator: p.creator,
            last_modified_by: p.last_modified_by,
            created: p.created,
            modified: p.modified,
            title: p.title,
            subject: p.subject,
            description: p.description,
            keywords: p.keywords,
            category: p.category,
            content_status: p.content_status,
            revision: p.revision,
            version: p.version,
            application: p.application,
            app_version: p.app_version,
            company: p.company,
            template: p.template,
            manager: p.manager,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_fields_serialise_as_null_with_camel_case_keys() {
        let mut p = WorkbookProperties::default();
        p.last_modified_by = Some("someone".into());
        let value = serde_json::to_value(Properties::from(p)).unwrap();

        assert_eq!(value["lastModifiedBy"], json!("someone"));
        assert_eq!(value["creator"], json!(null));
        // Every field present, none dropped for being `None`.
        assert_eq!(value.as_object().unwrap().len(), 17);
        assert!(value.get("last_modified_by").is_none());
    }
}
