//! Desktop shell. Academic logic lives in the TypeScript core so it is
//! tested once and behaves the same on macOS and Windows. Rust provides the
//! window, a local SQLite file, the calendar feed download (on Sync), and
//! AI requests (only when the student turns AI on; see ai.rs).

mod db;
mod feed;
mod ai;
mod notify;
mod scholar;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let database = db::Db::open(&dir.join("assignment_rescue.db"))?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db::db_batch, db::db_select, feed::fetch_calendar_feed, ai::ai_complete, ai::ai_set_key, ai::ai_has_key, notify::send_sms, scholar::scholar_get, notify::notify_desktop])
        .run(tauri::generate_context!())
        .expect("error while running Assignment Rescue AI");
}
