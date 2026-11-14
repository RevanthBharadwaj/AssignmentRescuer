//! Desktop shell. Academic logic lives in the TypeScript core so it is
//! tested once and behaves the same on macOS and Windows. Rust provides the
//! window and a local SQLite file. No network access is configured.

mod db;

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
        .invoke_handler(tauri::generate_handler![db::db_batch, db::db_select])
        .run(tauri::generate_context!())
        .expect("error while running Assignment Rescue AI");
}
