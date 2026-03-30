use crate::engine::EngineManager;
use tauri::{
    AppHandle, CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu,
    SystemTrayMenuItem,
};

pub fn create_system_tray() -> SystemTray {
    let quit = CustomMenuItem::new("quit".to_string(), "Quit");
    let show = CustomMenuItem::new("show".to_string(), "Show");
    let hide = CustomMenuItem::new("hide".to_string(), "Hide");
    let restart = CustomMenuItem::new("restart".to_string(), "Restart Engine");
    let open_data = CustomMenuItem::new("open_data".to_string(), "Open Data Folder");

    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_item(hide)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(open_data)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit);

    SystemTray::new().with_menu(tray_menu)
}

pub fn handle_system_tray_event(app: &AppHandle, event: SystemTrayEvent) {
    match event {
        SystemTrayEvent::LeftClick { .. } => {
            if let Some(window) = app.get_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
            "quit" => {
                let engine: tauri::State<EngineManager> = app.state();
                let _ = engine.stop();
                app.exit(0);
            }
            "show" => {
                if let Some(window) = app.get_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "hide" => {
                if let Some(window) = app.get_window("main") {
                    let _ = window.hide();
                }
            }
            "restart" => {
                let handle = app.clone();
                std::thread::spawn(move || {
                    if let Some(window) = handle.get_window("main") {
                        let engine: tauri::State<EngineManager> = handle.state();
                        let _ = engine.stop();
                        let _ = engine.start(window);
                    }
                });
            }
            "open_data" => {
                if let Some(app_data) = app.path_resolver().app_data_dir() {
                    #[cfg(target_os = "windows")]
                    let _ = std::process::Command::new("explorer").arg(app_data).spawn();
                    #[cfg(target_os = "macos")]
                    let _ = std::process::Command::new("open").arg(app_data).spawn();
                    #[cfg(target_os = "linux")]
                    let _ = std::process::Command::new("xdg-open").arg(app_data).spawn();
                }
            }
            _ => {}
        },
        _ => {}
    }
}
