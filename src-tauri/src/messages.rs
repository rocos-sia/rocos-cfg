//! Serializable display metadata. Native code never reads the UI locale;
//! operating-system errors and user paths remain literal values.
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize)]
pub struct MessageTemplate {
    pub key: String,
    pub values: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
pub struct Message {
    pub message: String,
    pub text: MessageTemplate,
}

impl Message {
    pub fn plain(key: &'static str) -> Self {
        Self {
            message: key.into(),
            text: MessageTemplate {
                key: key.into(),
                values: BTreeMap::new(),
            },
        }
    }

    pub fn detail(key: &'static str, detail: impl Into<String>) -> Self {
        let detail = detail.into();
        Self {
            // Replace only tokens in the original template, never in the data.
            message: key.replace("{detail}", &detail),
            text: MessageTemplate {
                key: key.into(),
                values: BTreeMap::from([("detail".into(), detail)]),
            },
        }
    }
}
