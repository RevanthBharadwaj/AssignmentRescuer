//! AI requests. Three providers:
//! - Ollama on this computer (http://localhost only): nothing leaves the machine.
//! - Anthropic's API and OpenAI's API: keys live in the OS keychain (macOS
//!   Keychain, Windows Credential Manager), never in the database or the web view.
//! The front end only calls these after the student has turned AI on, and
//! for the cloud providers only after they agreed to send material.

use serde_json::{json, Value};
use std::time::Duration;

const SERVICE: &str = "ai.assignmentrescue.desktop";

fn account(provider: &str) -> Result<&'static str, String> {
    match provider {
        "anthropic" => Ok("anthropic-api-key"),
        "openai" => Ok("openai-api-key"),
        "gmail" => Ok("gmail-app-password"),
        _ => Err("Unknown key type.".into()),
    }
}

pub fn entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, account(provider)?).map_err(|e| format!("Keychain unavailable: {e}"))
}

fn check_key(provider: &str, k: &str) -> Result<(), String> {
    match provider {
        "anthropic" if !k.starts_with("sk-ant-") => Err("That does not look like an Anthropic API key (it should start with sk-ant-).".into()),
        "openai" if !k.starts_with("sk-") || k.starts_with("sk-ant-") => Err("That does not look like an OpenAI API key (it should start with sk-).".into()),
        "gmail" if k.len() != 16 || !k.chars().all(|c| c.is_ascii_alphanumeric()) => {
            Err("A Gmail app password is 16 letters (Google shows it in four groups). Create one at myaccount.google.com/apppasswords.".into())
        }
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn ai_set_key(provider: String, key: Option<String>) -> Result<(), String> {
    let e = entry(&provider)?;
    // Google shows app passwords in groups of four; the spaces are not part of it.
    let strip = |k: String| if provider == "gmail" { k.split_whitespace().collect::<String>() } else { k.trim().to_string() };
    match key.map(strip).filter(|k| !k.is_empty()) {
        Some(k) => {
            check_key(&provider, &k)?;
            e.set_password(&k).map_err(|e| format!("Could not save the key: {e}"))
        }
        None => match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(format!("Could not remove the key: {err}")),
        },
    }
}

#[tauri::command]
pub fn ai_has_key(provider: String) -> bool {
    entry(&provider).and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok()
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

#[derive(serde::Deserialize)]
pub struct Turn {
    role: String,
    content: String,
}

/// Earlier turns first, then the new prompt as the last user message.
fn conversation(history: &Option<Vec<Turn>>, prompt: &str) -> Vec<Value> {
    let mut v: Vec<Value> = history.iter().flatten()
        .filter(|t| (t.role == "user" || t.role == "assistant") && !t.content.is_empty())
        .map(|t| json!({ "role": t.role, "content": t.content }))
        .collect();
    v.push(json!({ "role": "user", "content": prompt }));
    v
}

#[tauri::command]
pub fn ai_complete(
    provider: String,
    model: String,
    system: String,
    prompt: String,
    base_url: Option<String>,
    history: Option<Vec<Turn>>,
    json_mode: Option<bool>,
) -> Result<String, String> {
    let total = prompt.len() + system.len() + history.iter().flatten().map(|t| t.content.len()).sum::<usize>();
    if total > 400_000 {
        return Err("The material is too long to send in one go.".into());
    }
    let json_mode = json_mode.unwrap_or(true);
    match provider.as_str() {
        "anthropic" => {
            let key = entry("anthropic")?.get_password().map_err(|_| "No Anthropic API key saved. Add it in Semester setup → AI assistant.".to_string())?;
            let body = json!({
                "model": model,
                "max_tokens": 4000,
                "system": system,
                "messages": conversation(&history, &prompt),
            });
            let resp: Value = agent(120)
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
        "openai" => {
            let key = entry("openai")?.get_password().map_err(|_| "No OpenAI API key saved. Add it in Semester setup → AI assistant.".to_string())?;
            let mut messages = vec![json!({ "role": "system", "content": system })];
            messages.extend(conversation(&history, &prompt));
            let mut body = json!({ "model": model, "max_completion_tokens": 4000, "messages": messages });
            if json_mode {
                body["response_format"] = json!({ "type": "json_object" });
            }
            let resp: Value = agent(120)
                .post("https://api.openai.com/v1/chat/completions")
                .set("authorization", &format!("Bearer {key}"))
                .send_json(body)
                .map_err(|e| http_error(e, "OpenAI"))?
                .into_json()
                .map_err(|_| "Unexpected answer from OpenAI.".to_string())?;
            resp["choices"][0]["message"]["content"].as_str().filter(|t| !t.is_empty()).map(String::from)
                .ok_or_else(|| "OpenAI returned no text.".into())
        }
        "ollama" => {
            let base = validate_local_url(base_url.as_deref().unwrap_or("http://localhost:11434"))?;
            let mut messages = vec![json!({ "role": "system", "content": system })];
            messages.extend(conversation(&history, &prompt));
            let mut body = json!({ "model": model, "stream": false, "messages": messages });
            if json_mode {
                body["format"] = json!("json");
            }
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


/// Reads a picture with a local vision model. The image never leaves this computer.
#[tauri::command]
pub fn ai_describe_image(model: String, base_url: Option<String>, image_base64: String, instruction: String) -> Result<String, String> {
    if image_base64.len() > 30_000_000 { return Err("That image is too large. Try a smaller screenshot.".into()); }
    let base = validate_local_url(base_url.as_deref().unwrap_or("http://localhost:11434"))?;
    let body = json!({
        "model": model, "stream": false,
        "messages": [{ "role": "user", "content": instruction, "images": [image_base64] }],
    });
    let resp: Value = agent(300)
        .post(&format!("{base}/api/chat"))
        .send_json(body)
        .map_err(|e| http_error(e, "Ollama"))?
        .into_json()
        .map_err(|_| "Unexpected answer from Ollama.".to_string())?;
    resp["message"]["content"].as_str().map(String::from).ok_or_else(|| "The vision model returned no text.".into())
}

/// Turns passages into number lists for search by meaning, with a local embedding model.
#[tauri::command]
pub fn ai_embed(model: String, base_url: Option<String>, texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() { return Ok(vec![]); }
    if texts.len() > 200 || texts.iter().map(|t| t.len()).sum::<usize>() > 400_000 { return Err("Too much text to search at once.".into()); }
    let base = validate_local_url(base_url.as_deref().unwrap_or("http://localhost:11434"))?;
    let resp: Value = agent(300)
        .post(&format!("{base}/api/embed"))
        .send_json(json!({ "model": model, "input": texts }))
        .map_err(|e| http_error(e, "Ollama"))?
        .into_json()
        .map_err(|_| "Unexpected answer from Ollama.".to_string())?;
    let rows = resp["embeddings"].as_array().ok_or_else(|| "The embedding model returned nothing.".to_string())?;
    Ok(rows.iter().map(|r| r.as_array().map(|a| a.iter().filter_map(|x| x.as_f64().map(|f| f as f32)).collect()).unwrap_or_default()).collect())
}

#[cfg(test)]
mod tests {
    use super::{check_key, conversation, validate_local_url, Turn};

    #[test]
    fn local_models_must_be_on_this_computer() {
        assert_eq!(validate_local_url("http://localhost:11434/").unwrap(), "http://localhost:11434");
        assert!(validate_local_url("http://127.0.0.1:11434").is_ok());
        assert!(validate_local_url("https://example.com:11434").is_err());
        assert!(validate_local_url("http://localhost.evil.com:11434").is_err());
        assert!(validate_local_url("http://user@localhost:11434").is_err());
    }

    #[test]
    fn keys_are_checked_by_provider() {
        assert!(check_key("anthropic", "sk-ant-abc").is_ok());
        assert!(check_key("anthropic", "sk-abc").is_err());
        assert!(check_key("openai", "sk-proj-abc").is_ok());
        assert!(check_key("openai", "sk-ant-abc").is_err());
        assert!(check_key("gmail", "short").is_err());
        assert!(check_key("gmail", "abcdefghijklmnop").is_ok());
    }

    #[test]
    fn history_comes_before_the_new_prompt() {
        let h = Some(vec![
            Turn { role: "user".into(), content: "hi".into() },
            Turn { role: "system".into(), content: "ignored".into() },
            Turn { role: "assistant".into(), content: "hello".into() },
        ]);
        let m = conversation(&h, "next");
        assert_eq!(m.len(), 3);
        assert_eq!(m[2]["content"], "next");
        assert_eq!(m[1]["role"], "assistant");
    }
}
