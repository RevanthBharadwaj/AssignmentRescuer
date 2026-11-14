// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--send-reminders") {
        std::process::exit(assignment_rescue_ai_lib::send_reminders_cli(args.get(2)));
    }
    assignment_rescue_ai_lib::run()
}
