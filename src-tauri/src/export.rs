//! Saves a finished document (for example a Word file) into the student's
//! Downloads folder. The name is cleaned and never overwrites an existing file.

use std::path::{Path, PathBuf};
use tauri::Manager;

pub fn clean_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { ' ' } else { c })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned = cleaned.trim_matches('.').trim().to_string();
    if cleaned.is_empty() { "Assignment draft.docx".into() } else { cleaned.chars().take(120).collect() }
}

pub fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() { return first; }
    let (stem, ext) = match name.rfind('.') { Some(i) => (&name[..i], &name[i..]), None => (name, "") };
    for n in 2..1000 {
        let p = dir.join(format!("{stem} ({n}){ext}"));
        if !p.exists() { return p; }
    }
    first
}

#[tauri::command]
pub fn save_download(app: tauri::AppHandle, name: String, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.is_empty() || bytes.len() > 50 * 1024 * 1024 { return Err("That file is empty or too large.".into()); }
    let name = clean_name(&name);
    if !name.to_ascii_lowercase().ends_with(".docx") { return Err("Only Word documents can be saved this way.".into()); }
    let dir = app.path().download_dir().map_err(|_| "Could not find your Downloads folder.".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|_| "Could not open your Downloads folder.".to_string())?;
    let path = free_path(&dir, &name);
    std::fs::write(&path, bytes).map_err(|_| "Could not save the file. Check that Downloads is writable.".to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_names() {
        assert_eq!(clean_name("Week 2: Draft v1?.docx"), "Week 2 Draft v1 .docx");
        assert_eq!(clean_name("../../evil.docx"), "evil.docx");
        assert_eq!(clean_name("   "), "Assignment draft.docx");
    }

    #[test]
    fn never_overwrites() {
        let dir = std::env::temp_dir().join(format!("ar-export-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.docx"), b"x").unwrap();
        assert_eq!(free_path(&dir, "a.docx"), dir.join("a (2).docx"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
