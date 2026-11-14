//! Calendar feed download. This is the app's only network request, and it
//! runs only when the student syncs their own feed link. The link is never
//! logged.

use std::io::Read;
use std::time::Duration;

const MAX_BYTES: u64 = 5 * 1024 * 1024;

pub fn validate(url: &str) -> Result<(), String> {
    let lower = url.trim().to_ascii_lowercase();
    if !lower.starts_with("https://") {
        return Err("The feed link must start with https://".into());
    }
    let after = &lower["https://".len()..];
    let host = after.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() || !host.contains('.') || host.contains('@') {
        return Err("That does not look like a web address.".into());
    }
    let path = &after[host.len()..];
    if !(path.contains(".ics") || path.contains("/feeds/") || path.contains("calendar")) {
        return Err("That does not look like a calendar feed link (it should end in .ics).".into());
    }
    Ok(())
}

#[tauri::command]
pub fn fetch_calendar_feed(url: String) -> Result<String, String> {
    validate(&url)?;
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(20))
        .redirects(3)
        .build();
    let resp = agent.get(url.trim()).call().map_err(|e| match e {
        ureq::Error::Status(code, _) => format!("The calendar server answered {code}. Check the link, or reset it in Canvas and paste the new one."),
        ureq::Error::Transport(_) => "Could not reach the calendar server. Check your internet connection.".into(),
    })?;
    let mut body = String::new();
    resp.into_reader().take(MAX_BYTES).read_to_string(&mut body).map_err(|_| "The feed could not be read as text.".to_string())?;
    if !body.trim_start().starts_with("BEGIN:VCALENDAR") {
        return Err("The link did not return a calendar. Copy the Calendar Feed link from Canvas again.".into());
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn accepts_calendar_feeds_only() {
        assert!(validate("https://school.instructure.com/feeds/calendars/user_abc.ics").is_ok());
        assert!(validate("http://school.instructure.com/feeds/calendars/user_abc.ics").is_err());
        assert!(validate("https://school.instructure.com/courses/1").is_err());
        assert!(validate("https://user@evil.example/feeds/x.ics").is_err());
        assert!(validate("file:///etc/passwd").is_err());
    }
}
