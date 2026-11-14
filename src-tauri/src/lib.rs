//! Desktop shell. Academic logic lives in the TypeScript core so it is
//! tested once and behaves the same on macOS and Windows. Rust provides the
//! window, a local SQLite file, and one network request: downloading the
//! student's own calendar feed when they press Sync.

mod db;
mod feed;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let database = db::Db::open(&dir.join("assignment_rescue.db"))?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db::db_batch, db::db_select, feed::fetch_calendar_feed])
        .run(tauri::generate_context!())
        .expect("error while running Assignment Rescue AI");
}
