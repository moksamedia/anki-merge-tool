//! HTTP proxy to AnkiConnect and anki-ai-bridge. Calling from Rust rather than
//! the webview means neither service needs CORS configuration for this app.

use std::sync::LazyLock;
use std::time::Duration;

use serde_json::{json, Value};

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

fn unreachable(service: &str, url: &str, e: reqwest::Error) -> String {
    if e.is_connect() {
        format!("Cannot reach {service} at {url} — is Anki running with the add-on installed?")
    } else if e.is_timeout() {
        format!("{service} at {url} timed out")
    } else {
        format!("{service} request failed: {e}")
    }
}

/// Calls an AnkiConnect action, returning `result` or AnkiConnect's `error` string.
pub async fn anki_connect(url: &str, action: &str, params: Value, timeout_secs: u64) -> Result<Value, String> {
    let res = CLIENT
        .post(url)
        .timeout(Duration::from_secs(timeout_secs))
        .json(&json!({ "action": action, "version": 6, "params": params }))
        .send()
        .await
        .map_err(|e| unreachable("AnkiConnect", url, e))?;
    let body: Value = res.json().await.map_err(|e| format!("AnkiConnect returned invalid JSON: {e}"))?;
    match &body["error"] {
        Value::Null => Ok(body["result"].clone()),
        Value::String(msg) => Err(format!("AnkiConnect {action}: {msg}")),
        other => Err(format!("AnkiConnect {action}: {other}")),
    }
}

/// Calls an anki-ai-bridge route. Non-2xx responses become the bridge's `error` message.
pub async fn bridge(
    base_url: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
    timeout_secs: u64,
) -> Result<Value, String> {
    let url = format!("{}{}", base_url.trim_end_matches('/'), path);
    let req = match method {
        "GET" => CLIENT.get(&url),
        "POST" => CLIENT.post(&url).json(&body.unwrap_or(Value::Null)),
        other => return Err(format!("Unsupported method {other}")),
    };
    let res = req
        .timeout(Duration::from_secs(timeout_secs))
        .send()
        .await
        .map_err(|e| unreachable("anki-ai-bridge", base_url, e))?;
    let status = res.status();
    let payload: Value = res.json().await.unwrap_or(Value::Null);
    if status.is_success() {
        Ok(payload)
    } else {
        let msg = payload["error"].as_str().unwrap_or("unknown error");
        Err(format!("Bridge {method} {path} failed ({}): {msg}", status.as_u16()))
    }
}
