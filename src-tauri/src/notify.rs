//! Reminders leave the app in two ways: a desktop notification, and an email
//! sent from the student's own Gmail account. The Gmail app password lives in
//! the OS keychain; the addresses stay in the local database. Nothing is sent
//! unless the student turned reminders on.

use lettre::message::{header::ContentType, Mailbox};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use std::time::Duration;
use tauri_plugin_notification::NotificationExt;

/// A plain address like name@gmail.com. Anything with spaces, angle brackets or line breaks is refused.
pub fn clean_address(raw: &str) -> Result<String, String> {
    let a = raw.trim();
    let ok = a.len() <= 254
        && !a.chars().any(|c| c.is_whitespace() || c.is_control() || "<>(),;\"".contains(c))
        && a.split_once('@').map_or(false, |(user, host)| !user.is_empty() && host.contains('.') && !host.starts_with('.') && !host.ends_with('.'));
    if ok { Ok(a.to_string()) } else { Err(format!("'{a}' does not look like an email address.")) }
}

pub fn build_message(from: &str, to: &str, subject: &str, body: &str) -> Result<Message, String> {
    let from = clean_address(from)?;
    let to = clean_address(to)?;
    let subject = subject.replace(['\r', '\n'], " ");
    if subject.trim().is_empty() || subject.len() > 300 || body.trim().is_empty() || body.len() > 20_000 {
        return Err("The email is empty or too long.".into());
    }
    Message::builder()
        .from(from.parse::<Mailbox>().map_err(|e| e.to_string())?)
        .to(to.parse::<Mailbox>().map_err(|e| e.to_string())?)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body.to_string())
        .map_err(|e| format!("Could not build the email: {e}"))
}

#[tauri::command]
pub fn send_email(from: String, to: String, subject: String, body: String) -> Result<(), String> {
    let to = if to.trim().is_empty() { from.clone() } else { to };
    let message = build_message(&from, &to, &subject, &body)?;
    let password = crate::ai::entry("gmail")?
        .get_password()
        .map_err(|_| "No Gmail app password saved. Add it in Semester setup → Reminders.".to_string())?;
    let mailer = SmtpTransport::relay("smtp.gmail.com")
        .map_err(|e| format!("Could not set up the email connection: {e}"))?
        .credentials(Credentials::new(clean_address(&from)?, password))
        .timeout(Some(Duration::from_secs(30)))
        .build();
    mailer.send(&message).map(|_| ()).map_err(|e| {
        let text = e.to_string();
        if e.is_permanent() && (text.contains("535") || text.to_lowercase().contains("authentication")) {
            "Gmail rejected the address or app password. Check both, and that 2-Step Verification is on.".to_string()
        } else if e.is_transient() || text.to_lowercase().contains("connect") || text.to_lowercase().contains("timed out") {
            "Could not reach Gmail. Check your internet connection.".to_string()
        } else {
            format!("Gmail could not send the email: {text}")
        }
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
    use super::{build_message, clean_address};

    #[test]
    fn addresses_are_checked() {
        assert_eq!(clean_address(" revanth@gmail.com ").unwrap(), "revanth@gmail.com");
        assert!(clean_address("no-at-sign").is_err());
        assert!(clean_address("a b@gmail.com").is_err());
        assert!(clean_address("a@gmail").is_err());
        assert!(clean_address("a@gmail.com\nBcc: x@y.com").is_err());
        assert!(clean_address("Name <a@gmail.com>").is_err());
    }

    #[test]
    fn messages_are_built_and_line_breaks_in_subjects_are_removed() {
        let m = build_message("a@gmail.com", "b@gmail.com", "Essay 2 due\r\nBcc: x@y.com", "Hi").unwrap();
        let text = String::from_utf8(m.formatted()).unwrap();
        assert!(text.contains("Subject: Essay 2 due"));
        assert!(!text.lines().any(|l| l.starts_with("Bcc:")), "{text}");
        assert!(build_message("a@gmail.com", "b@gmail.com", "", "Hi").is_err());
        assert!(build_message("a@gmail.com", "b@gmail.com", "S", "  ").is_err());
    }
}
