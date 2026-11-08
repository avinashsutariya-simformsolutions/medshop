mod batch;

use tauri_plugin_sql::{Migration, MigrationKind};

/// Database file name. Tauri stores it in the app data folder
/// (Windows: %APPDATA%\com.medshop.app\medshop.db).
pub const DB_URL: &str = "sqlite:medshop.db";

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "gst 2.0 rates, import tables",
            sql: include_str!("../migrations/002_gst2_and_imports.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .manage(batch::BatchDb::default())
        .invoke_handler(tauri::generate_handler![batch::run_batch, batch::batch_db_ready])
        .run(tauri::generate_context!())
        .expect("error while running MedShop");
}
