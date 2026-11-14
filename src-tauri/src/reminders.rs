//! Reminders that go out even when the app is closed.
//!
//! The app has no server, so it asks the computer to do the waiting: while
//! reminders are on, it writes the coming emails to a small file in its data
//! folder and installs one scheduled job (a launchd agent on macOS, a Task
//! Scheduler task on Windows). Every 15 minutes the job starts this program
//! with `--send-reminders <file>`, which sends what is due and exits without
//! opening a window. Turning reminders off removes the job and the file.
//! The computer must be on (a sleeping computer sends when it wakes).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

const LABEL: &str = "ai.assignmentrescue.reminders";
const TASK: &str = "AssignmentRescueReminders";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Item {
    pub id: String,
    /// YYYY-MM-DD in local time.
    pub send_on: String,
    pub subject: String,
    pub body: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Plan {
    pub gmail: String,
    #[serde(default)]
    pub to: String,
    /// Hour of day (0 to 23) after which the day's email goes out.
    pub hour: u32,
    pub items: Vec<Item>,
    #[serde(default)]
    pub sent: Vec<String>,
}

/// What is due now: today's emails, after the chosen hour, not sent before.
pub fn due<'a>(plan: &'a Plan, today: &str, hour_now: u32) -> Vec<&'a Item> {
    if hour_now < plan.hour {
        return vec![];
    }
    plan.items.iter().filter(|i| i.send_on == today && !plan.sent.contains(&i.id)).collect()
}

fn check(plan: &Plan) -> Result<(), String> {
    crate::notify::clean_address(&plan.gmail)?;
    if !plan.to.trim().is_empty() {
        crate::notify::clean_address(&plan.to)?;
    }
    if plan.hour > 23 || plan.items.len() > 400 || plan.items.iter().any(|i| i.body.len() > 20_000 || i.subject.len() > 300) {
        return Err("The reminder plan is not valid.".into());
    }
    Ok(())
}

fn read(path: &Path) -> Result<Plan, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("Could not read the reminder plan: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("The reminder plan is damaged: {e}"))
}

fn write(path: &Path, plan: &Plan) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec(plan).map_err(|e| e.to_string())?).map_err(|e| format!("Could not save the reminder plan: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("Could not save the reminder plan: {e}"))
}

/// Send what is due and remember it. Returns how many emails went out.
pub fn run_due(path: &Path) -> Result<usize, String> {
    let mut plan = read(path)?;
    check(&plan)?;
    let now = chrono::Local::now();
    let (today, hour) = (now.format("%Y-%m-%d").to_string(), chrono::Timelike::hour(&now));
    let ids: Vec<(String, String, String)> = due(&plan, &today, hour).iter().map(|i| (i.id.clone(), i.subject.clone(), i.body.clone())).collect();
    let mut sent = 0;
    for (id, subject, body) in ids {
        crate::notify::deliver(&plan.gmail, &plan.to, &subject, &body)?;
        plan.sent.push(id);
        write(path, &plan)?; // remember each one at once, so a crash never sends it twice
        sent += 1;
    }
    Ok(sent)
}

/// Entry point for `--send-reminders <file>`; the exit code tells the scheduler how it went.
pub fn cli(path: Option<&String>) -> i32 {
    match path.map(PathBuf::from).map(|p| run_due(&p)) {
        Some(Ok(_)) => 0,
        _ => 1,
    }
}

fn xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

pub fn launchd_plist(exe: &str, file: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n  <key>Label</key><string>{LABEL}</string>\n  <key>ProgramArguments</key>\n  <array><string>{}</string><string>--send-reminders</string><string>{}</string></array>\n  <key>StartInterval</key><integer>900</integer>\n  <key>RunAtLoad</key><true/>\n</dict>\n</plist>\n",
        xml(exe), xml(file)
    )
}

pub fn schtasks_args(exe: &str, file: &str) -> Vec<String> {
    let run = format!("\"{exe}\" --send-reminders \"{file}\"");
    ["/Create", "/F", "/SC", "MINUTE", "/MO", "15", "/TN", TASK, "/TR", run.as_str()].iter().map(|s| s.to_string()).collect()
}

fn run(cmd: &str, args: &[&str]) -> bool {
    let mut c = Command::new(cmd);
    c.args(args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c.status().map(|s| s.success()).unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn plist_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "Could not find your home folder.".to_string())?;
    Ok(PathBuf::from(home).join("Library/LaunchAgents").join(format!("{LABEL}.plist")))
}

fn install(file: &Path) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let (exe, file) = (exe.to_string_lossy().to_string(), file.to_string_lossy().to_string());
    #[cfg(target_os = "macos")]
    {
        let path = plist_path()?;
        std::fs::create_dir_all(path.parent().ok_or("bad path")?).map_err(|e| e.to_string())?;
        std::fs::write(&path, launchd_plist(&exe, &file)).map_err(|e| format!("Could not install the background job: {e}"))?;
        let p = path.to_string_lossy().to_string();
        let _ = run("launchctl", &["unload", &p]);
        return if run("launchctl", &["load", "-w", &p]) { Ok(()) } else { Err("macOS would not start the background job. Reminders will still go out while the app is open.".into()) };
    }
    #[cfg(windows)]
    {
        let args = schtasks_args(&exe, &file);
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        return if run("schtasks", &refs) { Ok(()) } else { Err("Windows would not create the scheduled task. Reminders will still go out while the app is open.".into()) };
    }
    #[allow(unreachable_code)]
    {
        let _ = (exe, file);
        Err("Reminders when the app is closed work on macOS and Windows.".into())
    }
}

fn uninstall() {
    #[cfg(target_os = "macos")]
    if let Ok(path) = plist_path() {
        let p = path.to_string_lossy().to_string();
        let _ = run("launchctl", &["unload", "-w", &p]);
        let _ = std::fs::remove_file(path);
    }
    #[cfg(windows)]
    let _ = run("schtasks", &["/Delete", "/F", "/TN", TASK]);
}

fn installed() -> bool {
    #[cfg(target_os = "macos")]
    return plist_path().map(|p| p.exists()).unwrap_or(false);
    #[cfg(windows)]
    return run("schtasks", &["/Query", "/TN", TASK]);
    #[allow(unreachable_code)]
    false
}

fn plan_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("reminders.json"))
}

/// Save the coming emails and make sure the scheduled job exists. Safe to call again and again.
#[tauri::command(async)]
pub fn reminders_sync(app: tauri::AppHandle, mut plan: Plan) -> Result<(), String> {
    check(&plan)?;
    let file = plan_file(&app)?;
    // Keep what was already sent for emails that are still in the plan.
    if let Ok(old) = read(&file) {
        for id in old.sent {
            if plan.items.iter().any(|i| i.id == id) && !plan.sent.contains(&id) {
                plan.sent.push(id);
            }
        }
    }
    write(&file, &plan)?;
    install(&file)
}

/// Remove the scheduled job and the saved plan.
#[tauri::command(async)]
pub fn reminders_off(app: tauri::AppHandle) -> Result<(), String> {
    uninstall();
    let _ = std::fs::remove_file(plan_file(&app)?);
    Ok(())
}

#[tauri::command(async)]
pub fn reminders_installed() -> bool {
    installed()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(hour: u32, sent: &[&str]) -> Plan {
        Plan {
            gmail: "a@gmail.com".into(), to: String::new(), hour,
            items: vec![
                Item { id: "mail:2026-11-14".into(), send_on: "2026-11-14".into(), subject: "S".into(), body: "B".into() },
                Item { id: "mail:2026-11-15".into(), send_on: "2026-11-15".into(), subject: "S2".into(), body: "B2".into() },
            ],
            sent: sent.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn only_todays_unsent_emails_after_the_hour_are_due() {
        assert_eq!(due(&plan(9, &[]), "2026-11-14", 10).len(), 1);
        assert!(due(&plan(9, &[]), "2026-11-14", 8).is_empty());
        assert!(due(&plan(9, &["mail:2026-11-14"]), "2026-11-14", 10).is_empty());
        assert!(due(&plan(9, &[]), "2026-11-16", 10).is_empty());
    }

    #[test]
    fn plans_are_checked() {
        assert!(check(&plan(9, &[])).is_ok());
        assert!(check(&plan(24, &[])).is_err());
        let mut bad = plan(9, &[]);
        bad.gmail = "not an address".into();
        assert!(check(&bad).is_err());
    }

    #[test]
    fn the_scheduled_job_is_described_correctly() {
        let p = launchd_plist("/Applications/Assignment Rescue AI.app/Contents/MacOS/app", "/Users/a&b/reminders.json");
        assert!(p.contains("<string>--send-reminders</string>"));
        assert!(p.contains("<integer>900</integer>"));
        assert!(p.contains("/Users/a&amp;b/reminders.json"));
        let args = schtasks_args("C:\\Program Files\\App\\app.exe", "C:\\Users\\a\\reminders.json");
        assert_eq!(args[args.iter().position(|a| a == "/MO").unwrap() + 1], "15");
        assert!(args.last().unwrap().starts_with("\"C:\\Program Files\\App\\app.exe\" --send-reminders"));
    }

    #[test]
    fn a_plan_survives_a_round_trip_on_disk() {
        let dir = std::env::temp_dir().join(format!("ar-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("reminders.json");
        write(&file, &plan(9, &["mail:2026-11-14"])).unwrap();
        assert_eq!(read(&file).unwrap().sent, vec!["mail:2026-11-14".to_string()]);
        std::fs::remove_dir_all(dir).ok();
    }
}
