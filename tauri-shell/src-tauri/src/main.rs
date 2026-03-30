// Prevents additional console window on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod engine;
mod license;
mod menu;

use commands::*;
use engine::EngineManager;
use menu::{create_system_tray, handle_system_tray_event};
use tauri::Manager;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

fn main() {
    // Initialize logging
    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(EnvFilter::from_default_env().add_directive(tracing::Level::INFO.into()))
        .init();

    // Read license once at startup — determines plan flag passed to the engine
    let license_status = license::read_license();
    tracing::info!(
        "License on startup: plan={} active={}",
        license_status.plan.as_str(),
        license_status.is_active,
    );

    let engine_manager = EngineManager::new();

    tauri::Builder::default()
        .manage(engine_manager)
        .system_tray(create_system_tray())
        .on_system_tray_event(handle_system_tray_event)
        .setup(move |app| {
            let handle = app.handle();
            // Use the actual plan tier so the engine enforces correct endpoint access
            let plan = if license_status.is_active {
                license_status.plan.clone()
            } else {
                license::Plan::Free
            };
            std::thread::spawn(move || {
                let window = match handle.get_window("main") {
                    Some(w) => w,
                    None => {
                        tracing::error!("Window 'main' not found — cannot start engine");
                        return;
                    }
                };
                let engine = handle.state::<EngineManager>();
                match engine.start_with_plan(window.clone(), &plan) {
                    Ok(cfg) => {
                        tracing::info!("Engine ready on port {}", cfg.port);
                        window.emit("engine-ready", &cfg.port).ok();
                    }
                    Err(e) => {
                        tracing::error!("Engine failed to start: {}", e);
                        window.emit("engine-error", &format!("{}", e)).ok();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_engine_config,
            start_engine,
            stop_engine,
            is_engine_running,
            restart_engine,
            // License commands
            get_license_status,
            activate_license,
            deactivate_license,
            verify_license_online,
            // Local API commands
            get_local_api_info,
            regenerate_local_api_key,
            // Data export / import
            export_user_data,
            import_user_data,
            // DB distribution / setup
            check_db_status,
            download_db_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
