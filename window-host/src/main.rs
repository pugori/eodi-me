// EODI.ME — Embedded WebView2 Window Host
//
// A lightweight Rust binary that creates a production-quality WebView2 window
// for the eodi.me application. Embeds the web content from the Go HTTP server
// with full browser-control: no context menu, no external navigation, no
// DevTools (release), blocked shortcuts, and more.
//
// Usage:
//   eodi-window --url http://localhost:8000 [--title "eodi.me"] [--width 1440] [--height 900]
//
// Signals (stderr, for Go process management):
//   [window-host] Starting WebView2 window: <url>
//   [window-host] WebView2 window ready
//   [window-host] Window close requested
//
// Architecture:
//   eodi.exe (Go)
//     ├── HTTP server (localhost:8000)
//     ├── React SPA (embedded)
//     ├── eodi-engine.exe (Rust, AES-256-GCM — extracted to temp)
//     └── eodi-window.exe (Rust, WebView2 — extracted to temp)  ← this binary
//           └── WebView2 → http://localhost:{port}

// In release builds, use the Windows GUI subsystem (no console window).
// In debug builds, keep the console for debugging output.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tao::{
    dpi::{LogicalSize, PhysicalPosition},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::{WebViewBuilder, WebContext, NewWindowResponse};

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Parse command-line arguments
    let url = get_arg(&args, "--url").unwrap_or_else(|| {
        eprintln!(
            "Usage: eodi-window --url <url> [--title <title>] [--width <w>] [--height <h>]"
        );
        std::process::exit(1);
    });
    let title = get_arg(&args, "--title").unwrap_or_else(|| "eodi.me".to_string());
    let width: f64 = get_arg(&args, "--width")
        .and_then(|s| s.parse().ok())
        .unwrap_or(1440.0);
    let height: f64 = get_arg(&args, "--height")
        .and_then(|s| s.parse().ok())
        .unwrap_or(900.0);

    eprintln!("[window-host] Starting WebView2 window: {}", url);

    // ── Persistent user data directory ──────────────────────────────────────
    // Use %LOCALAPPDATA%/eodi.me/WebView2 so localStorage, cookies, and
    // preferences persist across app restarts.
    let data_dir = {
        let base = std::env::var("LOCALAPPDATA")
            .unwrap_or_else(|_| std::env::var("APPDATA").unwrap_or_else(|_| ".".into()));
        std::path::PathBuf::from(base).join("eodi.me").join("WebView2")
    };
    let mut web_context = WebContext::new(Some(data_dir));

    // ── Create window ───────────────────────────────────────────────────────
    let event_loop = EventLoop::new();

    let window = WindowBuilder::new()
        .with_title(&title)
        .with_inner_size(LogicalSize::new(width, height))
        .with_min_inner_size(LogicalSize::new(800.0, 600.0))
        .with_decorations(true)
        .build(&event_loop)
        .expect("Failed to create window");

    // Center window on the primary monitor
    if let Some(monitor) = window.current_monitor() {
        let screen = monitor.size();
        let win = window.outer_size();
        let x = (screen.width as i32 - win.width as i32) / 2;
        let y = (screen.height as i32 - win.height as i32) / 2;
        window.set_outer_position(PhysicalPosition::new(x.max(0), y.max(0)));
    }

    // ── Production security script (injected before every page load) ────────
    let init_script = r#"
        'use strict';

        // ── Disable right-click context menu ────────────────────────────────
        document.addEventListener('contextmenu', function(e) {
            e.preventDefault();
        }, true);

        // ── Block dangerous keyboard shortcuts ──────────────────────────────
        document.addEventListener('keydown', function(e) {
            // Ctrl + key combos (no shift, no alt)
            if (e.ctrlKey && !e.shiftKey && !e.altKey) {
                var key = e.key.toLowerCase();
                // p=print, s=save, u=source, g=find, f=find,
                // l=address bar, h=history, j=downloads
                if ('psugflhj'.indexOf(key) !== -1) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            }
            // Ctrl+Shift combos
            if (e.ctrlKey && e.shiftKey) {
                var key2 = e.key.toLowerCase();
                // i=devtools, j=console, c=? 
                if ('ijc'.indexOf(key2) !== -1) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            }
            // Function keys: F5=refresh, F7=caret, F12=devtools
            if (e.key === 'F5' || e.key === 'F7' || e.key === 'F12') {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
            // Ctrl+R = reload
            if (e.ctrlKey && e.key.toLowerCase() === 'r') {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        }, true);

        // ── Disable file drag-and-drop onto the window ──────────────────────
        document.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.stopPropagation();
        }, true);
        document.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
        }, true);
    "#;

    // ── Create WebView2 with production lockdown ────────────────────────────
    let _webview = WebViewBuilder::new_with_web_context(&mut web_context)
        .with_url(&url)
        .with_initialization_script(init_script)
        // DevTools: enabled in debug builds only
        .with_devtools(cfg!(debug_assertions))
        // Disable zoom via Ctrl+/- and Ctrl+scroll
        .with_hotkeys_zoom(false)
        // Disable swipe back/forward navigation
        .with_back_forward_navigation_gestures(false)
        // Navigation guard: only allow localhost and CDN URLs for the main frame.
        // External navigations (wikipedia, etc.) are blocked here; they're handled
        // by with_new_window_req_handler which opens them in the system browser.
        .with_navigation_handler(|uri: String| {
            uri.starts_with("http://localhost:")
                || uri.starts_with("http://127.0.0.1:")
                || uri.starts_with("https://cdn.jsdelivr.net/")
                || uri == "about:blank"
                || uri.starts_with("data:")
        })
        // External links (window.open / target=_blank) → system default browser
        .with_new_window_req_handler(|uri: String, _features| {
            if uri.starts_with("http://") || uri.starts_with("https://") {
                #[cfg(target_os = "windows")]
                {
                    let _ = std::process::Command::new("cmd")
                        .args(["/C", "start", "", &uri])
                        .spawn();
                }
            }
            NewWindowResponse::Deny
        })
        // Block file downloads
        .with_download_started_handler(|_, _| false)
        // Auto-focus the webview
        .with_focused(true)
        // Custom user agent
        .with_user_agent("eodi.me/1.0")
        // Dark background color to prevent white flash (#121216 = app bg)
        .with_background_color((18, 18, 22, 255))
        // Build the webview inside our window
        .build(&window)
        .expect("Failed to create WebView2 — is WebView2 Runtime installed?");

    eprintln!("[window-host] WebView2 window ready");

    // ── Event loop ──────────────────────────────────────────────────────────
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            eprintln!("[window-host] Window close requested");
            *control_flow = ControlFlow::Exit;
        }
    });
}

/// Parse a `--flag value` pair from the argument list.
fn get_arg(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}
