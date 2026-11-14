//! Reminders leave the app in two ways: a desktop notification, and a text
//! message through the student's own Twilio account. The Twilio auth token
//! lives in the OS keychain; the phone number and account SID stay in the
//! local database. Nothing is sent unless the student turned reminders on.

use base64::Engine;
use std::time::Duration;
use tauri_plugin_notification::NotificationExt;

/// Digits only, with a leading +. A 10 digit US number gets +1.
pub fn normalise_phone(raw: &str) -> Result<String, String> {
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    let plus = raw.trim_start().starts_with('+');
    match (plus, digits.len()) {
        (false, 10) => Ok(format!("+1{digits}")),
        (false, 11) if digits.starts_with('1') => Ok(format!("+{digits}")),
        (true, 8..=15) => Ok(format!("+{digits}")),
        _ => Err("That phone number does not look right. Use 10 digits, like 9135550123, or +country code.".into()),
    }
}

#[tauri::command]
pub fn send_sms(sid: String, from: String, to: String, body: String) -> Result<(), String> {
    let sid = sid.trim();
    if !sid.starts_with("AC") || sid.len() < 20 {
        return Err("The Twilio Account SID should start with AC.".into());
    }
    if body.trim().is_empty() || body.len() > 1500 {
        return Err("The message is empty or too long.".into());
    }
    let to = normalise_phone(&to)?;
    let from = normalise_phone(&from)?;
    let token = crate::ai::entry("twilio")?
        .get_password()
        .map_err(|_| "No Twilio auth token saved. Add it in Semester setup → Reminders.".to_string())?;
    let auth = base64::engine::general_purpose::STANDARD.encode(format!("{sid}:{token}"));
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(30)).build();
    agent
        .post(&format!("https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"))
        .set("authorization", &format!("Basic {auth}"))
        .send_form(&[("To", &to), ("From", &from), ("Body", &body)])
        .map(|_| ())
        .map_err(|e| match e {
            ureq::Error::Status(401, _) => "Twilio rejected the Account SID or auth token.".to_string(),
            ureq::Error::Status(code, r) => {
                let text = r.into_string().unwrap_or_default();
                let msg = serde_json::from_str::<serde_json::Value>(&text).ok()
                    .and_then(|v| v["message"].as_str().map(String::from)).unwrap_or_default();
                format!("Twilio answered {code}. {msg}").trim().to_string()
            }
            ureq::Error::Transport(_) => "Could not reach Twilio. Check your internet connection.".to_string(),
        })
}

#[tauri::command]
pub fn notify_desktop(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    let n = app.notification();
    let _ = n.request_permission();
    n.builder().title(title).body(body).show().map_err(|e| format!("Could not show a notification: {e}"))
}

#[cfg(test)]
mod tests {
    use super::normalise_phone;

    #[test]
    fn phone_numbers_are_made_international() {
        assert_eq!(normalise_phone("9135550123").unwrap(), "+19135550123");
        assert_eq!(normalise_phone("(913) 555-0123").unwrap(), "+19135550123");
        assert_eq!(normalise_phone("1 913 555 0123").unwrap(), "+19135550123");
        assert_eq!(normalise_phone("+44 20 7946 0958").unwrap(), "+442079460958");
        assert!(normalise_phone("12345").is_err());
    }
}
