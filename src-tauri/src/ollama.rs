//! Download free models for the student, after the student confirms in the app.
//! This talks to the Ollama server on this computer (`/api/tags` to list,
//! `/api/pull` to download), which is what `ollama pull` does, so it behaves
//! the same on macOS and Windows and needs no terminal. If the server is not
//! running, the app starts `ollama serve` (and nothing else). Only addresses on
//! this computer are used, and only plain model names are accepted.

use serde::Serialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::Emitter;

const NOT_RUNNING: &str = "Ollama is not installed or not running. Install it free from ollama.com/download, open it once, then press Download again.";

/// A model name like qwen3:8b or nomic-embed-text. No spaces, no leading dash, no path tricks.
pub fn valid_tag(tag: &str) -> bool {
    let ok_chars = tag.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-' | '/'));
    !tag.is_empty() && tag.len() <= 100 && ok_chars && tag.chars().next().map_or(false, |c| c.is_ascii_alphanumeric()) && !tag.contains("..") && !tag.contains("//")
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Progress {
    pub model: String,
    pub status: String,
    pub completed: u64,
    pub total: u64,
}

/// One line of the streamed answer. An error line becomes Err with Ollama's own words.
pub fn parse_progress(model: &str, line: &str) -> Result<Progress, String> {
    let v: Value = serde_json::from_str(line).map_err(|_| "Ollama sent something unexpected while downloading.".to_string())?;
    if let Some(e) = v["error"].as_str() {
        return Err(if e.to_lowercase().contains("not found") || e.to_lowercase().contains("file does not exist") {
            format!("Ollama does not have a model called {model}. Check the name.")
        } else {
            format!("Ollama could not download it: {e}")
        });
    }
    Ok(Progress {
        model: model.to_string(),
        status: v["status"].as_str().unwrap_or("").to_string(),
        completed: v["completed"].as_u64().unwrap_or(0),
        total: v["total"].as_u64().unwrap_or(0),
    })
}

fn quick() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(3)).build()
}

fn server_up(base: &str) -> bool {
    quick().get(&format!("{base}/api/tags")).call().is_ok()
}

fn quiet(cmd: &mut Command) -> &mut Command {
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    cmd
}

/// Make sure the Ollama server answers; start it when it is installed but not running.
fn ensure_server(base: &str) -> Result<(), String> {
    if server_up(base) {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    let _ = quiet(Command::new("open").args(["-a", "Ollama"])).status();
    #[allow(unused_mut)]
    let mut candidates: Vec<String> = vec!["ollama".into()];
    #[cfg(target_os = "macos")]
    candidates.extend(["/usr/local/bin/ollama", "/opt/homebrew/bin/ollama", "/Applications/Ollama.app/Contents/Resources/ollama"].map(String::from));
    #[cfg(windows)]
    if let Ok(p) = std::env::var("LOCALAPPDATA") {
        candidates.push(format!("{p}\\Programs\\Ollama\\ollama.exe"));
    }
    if !server_up(base) {
        for c in &candidates {
            if quiet(Command::new(c).arg("serve")).spawn().is_ok() {
                break;
            }
        }
    }
    for _ in 0..30 {
        if server_up(base) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err(NOT_RUNNING.into())
}

/// Names of the models already on this computer, or an error when Ollama is not running.
#[tauri::command(async)]
pub fn ollama_list(base_url: String) -> Result<Vec<String>, String> {
    let base = crate::ai::validate_local_url(&base_url)?;
    let body = quick().get(&format!("{base}/api/tags")).call().map_err(|_| NOT_RUNNING.to_string())?
        .into_string().map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    Ok(v["models"].as_array().map(|a| a.iter().filter_map(|m| m["name"].as_str().map(String::from)).collect()).unwrap_or_default())
}

/// Download one model. Progress is sent to the app as `ollama-pull` events. A stopped download resumes.
#[tauri::command(async)]
pub fn ollama_pull(app: tauri::AppHandle, base_url: String, model: String) -> Result<(), String> {
    let base = crate::ai::validate_local_url(&base_url)?;
    if !valid_tag(&model) {
        return Err("That does not look like a model name.".into());
    }
    ensure_server(&base)?;
    let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(10)).timeout_read(Duration::from_secs(180)).build();
    let resp = agent.post(&format!("{base}/api/pull")).send_json(json!({ "model": model, "name": model, "stream": true }))
        .map_err(|e| match e {
            ureq::Error::Status(404, _) => format!("Ollama does not have a model called {model}. Check the name."),
            ureq::Error::Status(code, _) => format!("Ollama answered {code} while starting the download."),
            ureq::Error::Transport(_) => NOT_RUNNING.to_string(),
        })?;
    let mut last = Instant::now() - Duration::from_secs(1);
    let mut finished = false;
    for line in BufReader::new(resp.into_reader()).lines() {
        let line = line.map_err(|_| "The download was interrupted. Press Download to continue where it left off.".to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let p = parse_progress(&model, &line)?;
        finished = p.status == "success";
        if finished || last.elapsed() >= Duration::from_millis(200) {
            last = Instant::now();
            let _ = app.emit("ollama-pull", p);
        }
    }
    if finished { Ok(()) } else { Err("The download stopped early. Press Download to continue where it left off.".into()) }
}

#[cfg(test)]
mod tests {
    use super::{parse_progress, valid_tag, Progress};

    #[test]
    fn model_names_are_plain() {
        for ok in ["qwen3:8b", "nomic-embed-text", "qwen2.5vl:3b", "hf.co/user/model:Q4_K_M", "llama3.1:8b"] {
            assert!(valid_tag(ok), "{ok}");
        }
        for bad in ["", "-rf", "a b", "a;b", "a&&b", "../x", "a//b", "$(x)", "name\nother", "`x`"] {
            assert!(!valid_tag(bad), "{bad}");
        }
    }

    #[test]
    fn progress_lines_are_read() {
        assert_eq!(
            parse_progress("qwen3:4b", r#"{"status":"pulling abc","digest":"sha256:abc","total":2500000000,"completed":1250000000}"#).unwrap(),
            Progress { model: "qwen3:4b".into(), status: "pulling abc".into(), completed: 1_250_000_000, total: 2_500_000_000 }
        );
        assert_eq!(parse_progress("m", r#"{"status":"success"}"#).unwrap().status, "success");
        assert!(parse_progress("m", r#"{"error":"pull model manifest: file does not exist"}"#).unwrap_err().contains("does not have a model called m"));
        assert!(parse_progress("m", "not json").is_err());
    }
}
