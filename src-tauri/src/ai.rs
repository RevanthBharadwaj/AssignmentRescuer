//! AI requests. Two providers:
//! - Ollama on this computer (http://localhost only): nothing leaves the machine.
//! - Anthropic's API: the key lives in the OS keychain (macOS Keychain,
//!   Windows Credential Manager), never in the database or the web view.
//! The front end only calls these after the student has turned AI on, and
//! for Anthropic only after they agreed to send material.

use serde_json::{json, Value};
use std::time::Duration;

const SERVICE: &str = "ai.assignmentrescue.desktop";
const ACCOUNT: &str = "anthropic-api-key";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Keychain unavailable: {e}"))
}

#[tauri::command]
pub fn ai_set_key(key: Option<String>) -> Result<(), String> {
    let e = entry()?;
    match key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        Some(k) => {
            if !k.starts_with("sk-ant-") {
                return Err("That does not look like an Anthropic API key (it should start with sk-ant-).".into());
            }
            e.set_password(&k).map_err(|e| format!("Could not save the key: {e}"))
        }
        None => match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(format!("Could not remove the key: {err}")),
        },
    }
}

#[tauri::command]
pub fn ai_has_key() -> bool {
    entry().and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok()
}

pub fn validate_local_url(url: &str) -> Result<String, String> {
    let u = url.trim().trim_end_matches('/');
    let ok = ["http://localhost:", "http://127.0.0.1:", "http://[::1]:"].iter().any(|p| u.starts_with(p))
        || u == "http://localhost" || u == "http://127.0.0.1";
    if !ok || u.contains('@') {
        return Err("The local model address must be on this computer, like http://localhost:11434".into());
    }
    Ok(u.to_string())
}

fn agent(secs: u64) -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(secs)).build()
}

fn http_error(e: ureq::Error, who: &str) -> String {
    match e {
        ureq::Error::Status(401, _) => format!("{who} rejected the API key. Check it in Semester setup → AI assistant."),
        ureq::Error::Status(404, _) if who == "Ollama" => "Ollama does not have that model. Run `ollama pull <model>` first.".into(),
        ureq::Error::Status(429, _) => format!("{who} is busy or the usage limit was reached. Try again shortly."),
        ureq::Error::Status(code, r) => {
            let body = r.into_string().unwrap_or_default();
            let msg = serde_json::from_str::<Value>(&body).ok()
                .and_then(|v| v["error"]["message"].as_str().or(v["error"].as_str()).map(String::from))
                .unwrap_or_default();
            format!("{who} answered {code}. {msg}").trim().to_string()
        }
        ureq::Error::Transport(_) if who == "Ollama" => "Could not reach Ollama. Make sure the Ollama app is running.".into(),
        ureq::Error::Transport(_) => format!("Could not reach {who}. Check your internet connection."),
    }
}

#[tauri::command]
pub fn ai_complete(provider: String, model: String, system: String, prompt: String, base_url: Option<String>) -> Result<String, String> {
    if prompt.len() > 200_000 {
        return Err("The material is too long to analyze in one go.".into());
    }
    match provider.as_str() {
        "anthropic" => {
            let key = entry()?.get_password().map_err(|_| "No Anthropic API key saved. Add it in Semester setup → AI assistant.".to_string())?;
            let body = json!({
                "model": model,
                "max_tokens": 2000,
                "system": system,
                "messages": [{ "role": "user", "content": prompt }],
            });
            let resp: Value = agent(90)
                .post("https://api.anthropic.com/v1/messages")
                .set("x-api-key", &key)
                .set("anthropic-version", "2023-06-01")
                .send_json(body)
                .map_err(|e| http_error(e, "Anthropic"))?
                .into_json()
                .map_err(|_| "Unexpected answer from Anthropic.".to_string())?;
            let text = resp["content"].as_array().map(|parts| {
                parts.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("")
            }).unwrap_or_default();
            if text.is_empty() { Err("Anthropic returned no text.".into()) } else { Ok(text) }
        }
        "ollama" => {
            let base = validate_local_url(base_url.as_deref().unwrap_or("http://localhost:11434"))?;
            let body = json!({
                "model": model,
                "stream": false,
                "format": "json",
                "messages": [{ "role": "system", "content": system }, { "role": "user", "content": prompt }],
            });
            let resp: Value = agent(300)
                .post(&format!("{base}/api/chat"))
                .send_json(body)
                .map_err(|e| http_error(e, "Ollama"))?
                .into_json()
                .map_err(|_| "Unexpected answer from Ollama.".to_string())?;
            resp["message"]["content"].as_str().map(String::from).ok_or_else(|| "Ollama returned no text.".into())
        }
        _ => Err("AI is turned off. Choose a provider in Semester setup → AI assistant.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_local_url;

    #[test]
    fn local_models_must_be_on_this_computer() {
        assert_eq!(validate_local_url("http://localhost:11434/").unwrap(), "http://localhost:11434");
        assert!(validate_local_url("http://127.0.0.1:11434").is_ok());
        assert!(validate_local_url("https://example.com:11434").is_err());
        assert!(validate_local_url("http://localhost.evil.com:11434").is_err());
        assert!(validate_local_url("http://user@localhost:11434").is_err());
    }
}
