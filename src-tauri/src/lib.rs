// PatchMan desktop shell.
//
// Boot sequence:
//   1. Reserve a free localhost port.
//   2. Spawn the bundled Go sidecar (`patchman-server-<target-triple>`) bound
//      to that port, pointed at a SQLite DB under the OS app-data dir.
//   3. Drain the sidecar's stdout/stderr into a log file for its whole life
//      and wait until it accepts TCP connections (up to 30s, or until it
//      exits).
//   4. Build the main webview window with an `initialization_script` that
//      pins `window.__PATCHMAN_LOCAL_API__` BEFORE any SPA JS runs, so the
//      FE's `getLocalApiUrl()` reads the right base URL from the start.
//   5. On app exit, kill the sidecar so the SQLite file closes cleanly.
//
// A boot failure shows an error dialog and exits; it must never panic —
// `panic = "abort"` turns a setup panic into a SIGABRT crash report.

use std::fs::File;
use std::io::Write;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

// Set just before a CONFIRMED quit (the FE quit-confirm flow, or the tray Quit
// item) so the ExitRequested guard lets that exit through instead of bouncing
// it back to the FE for another confirm. Cmd+Q with this still false triggers
// the confirm dialog.
static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, RunEvent, TitleBarStyle, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
#[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

type BootError = Box<dyn std::error::Error>;

/// How long boot waits for the sidecar to accept connections. A healthy
/// sidecar listens in well under a second; the slack covers first-launch
/// migrations on a large database and a cold disk.
const READY_TIMEOUT: Duration = Duration::from_secs(30);

/// Past this size the sidecar log is rotated to `sidecar.log.1`.
const SIDECAR_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

/// Append-only sidecar output log with a single rotation. Each boot starts a
/// fresh file and keeps the previous run's log as `sidecar.log.1`, so the
/// output of a failed launch is still there after the next one. Every write
/// is best effort: a log that can't be written must never stop the sidecar's
/// output from being drained.
struct SidecarLog {
    path: PathBuf,
    file: Option<File>,
    written: u64,
}

impl SidecarLog {
    fn open(dir: &Path) -> Self {
        let _ = std::fs::create_dir_all(dir);
        let path = dir.join("sidecar.log");
        let mut log = Self { path, file: None, written: 0 };
        log.rotate();
        log
    }

    fn rotate(&mut self) {
        self.file = None;
        let _ = std::fs::rename(&self.path, self.path.with_extension("log.1"));
        self.file = File::create(&self.path).ok();
        self.written = 0;
    }

    fn write(&mut self, bytes: &[u8]) {
        if self.written >= SIDECAR_LOG_MAX_BYTES {
            self.rotate();
        }
        let Some(file) = self.file.as_mut() else { return };
        let newline = !bytes.ends_with(b"\n");
        if file.write_all(bytes).is_ok() && (!newline || file.write_all(b"\n").is_ok()) {
            self.written += bytes.len() as u64 + u64::from(newline);
        }
    }
}

/// Consume every event the sidecar emits for as long as it runs.
///
/// This is load-bearing, not just logging: tauri-plugin-shell delivers the
/// child's stdout/stderr through a channel of capacity 1. If nobody receives
/// from it, the pipe-reader threads block, the 64 KiB stdout pipe fills, and
/// the Go sidecar blocks on its next write — before it ever binds its port
/// (1.58.0 launch crash: gin's route listing alone crossed 64 KiB).
fn drain_sidecar_events(
    mut rx: tauri::async_runtime::Receiver<CommandEvent>,
    mut log: SidecarLog,
    exited: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        while let Some(event) = rx.blocking_recv() {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => log.write(&line),
                CommandEvent::Error(err) => log.write(format!("[sidecar error] {err}").as_bytes()),
                CommandEvent::Terminated(payload) => {
                    exited.store(true, Ordering::SeqCst);
                    log.write(
                        format!(
                            "[sidecar exited] code={:?} signal={:?}",
                            payload.code, payload.signal
                        )
                        .as_bytes(),
                    );
                }
                _ => {}
            }
        }
    });
}

struct SidecarHandle {
    child: Mutex<Option<CommandChild>>,
}

impl SidecarHandle {
    fn new() -> Self {
        Self { child: Mutex::new(None) }
    }

    fn set(&self, child: CommandChild) {
        let mut guard = self.child.lock().expect("sidecar lock poisoned");
        *guard = Some(child);
    }

    fn kill(&self) {
        let mut guard = self.child.lock().expect("sidecar lock poisoned");
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }
}

fn reserve_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn wait_for_ready(port: u16, timeout: Duration, exited: &AtomicBool) -> Result<(), String> {
    let addr: SocketAddr = format!("127.0.0.1:{}", port)
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok() {
            return Ok(());
        }
        if exited.load(Ordering::SeqCst) {
            return Err("The local backend stopped while starting.".to_string());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(format!(
        "The local backend did not start within {} seconds.",
        timeout.as_secs()
    ))
}

fn build_init_script(url: &str) -> String {
    let encoded = serde_json::to_string(url).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        "try {{ window.__PATCHMAN_LOCAL_API__ = {encoded}; }} catch (e) {{ console.error('Failed to pin local API URL', e); }}"
    )
}

fn boot(app: &tauri::App, sidecar: &SidecarHandle) -> Result<(), BootError> {
    let port = reserve_port()?;
    let url = format!("http://127.0.0.1:{port}");

    let app_data = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_data).ok();
    let db_path = app_data.join("patchman.db");
    let db_path_str = db_path
        .to_str()
        .ok_or("app-data path is not valid UTF-8")?;

    let cmd = app.shell().sidecar("patchman-server")?.args([
        "--mode",
        "embedded",
        "--db-driver",
        "sqlite",
        "--db-path",
        db_path_str,
        "--bind",
        &format!("127.0.0.1:{port}"),
    ]);
    let log = SidecarLog::open(&app.path().app_log_dir()?);
    let log_path = log.path.clone();
    let exited = Arc::new(AtomicBool::new(false));
    let (rx, child) = cmd.spawn()?;
    sidecar.set(child);
    drain_sidecar_events(rx, log, exited.clone());

    wait_for_ready(port, READY_TIMEOUT, &exited)
        .map_err(|e| format!("{e}\n\nLog: {}", log_path.display()))?;

    let init_script = build_init_script(&url);
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("PatchMan")
        // Merge the OS title bar into the app's own top bar: transparent overlay
        // title bar (traffic lights over the content) + hidden title TEXT, so
        // there's no separate "PatchMan" strip above the in-app header.
        // trafficLightPosition below is only honored with this Overlay style.
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .inner_size(1400.0, 900.0)
        .initialization_script(&init_script)
        // Disable Tauri's OS-level drag-drop handler. When enabled (the
        // default) it intercepts all drag events over the webview, so in-app
        // HTML5 drag-and-drop never fires — tab reordering and the Hash/Base64
        // file dropzones silently do nothing in the desktop app (they work in
        // the browser, which has no such handler). We don't use Tauri's native
        // file-drop events anywhere, so turning it off is a pure win.
        .disable_drag_drop_handler();

    // Push the traffic-light cluster DOWN so it vertically centers in the app's
    // 48px (h-12) top bar. Builder form of the `trafficLightPosition` window
    // config — honored only with titleBarStyle Overlay (set above). y is the
    // inset from the window's top edge.
    #[cfg(target_os = "macos")]
    {
        builder = builder.traffic_light_position(tauri::LogicalPosition::new(8.0, 25.0));
    }

    let window = builder.build()?;

    // Close-to-tray: the red close button hides the window instead of quitting,
    // so the app keeps running in the menu bar (Quit from the tray exits for
    // real via app.exit → RunEvent::ExitRequested → sidecar kill).
    let win = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = win.hide();
        }
    });

    Ok(())
}

/// Bring the main window back to the foreground (from the tray / dock).
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Tray menu items kept in app state so the FE can push localized labels at
/// runtime (the menu is built with English defaults, then relabelled by
/// set_tray_labels on launch and whenever the app language changes).
struct TrayMenu {
    show: MenuItem<tauri::Wry>,
    new_request: MenuItem<tauri::Wry>,
    settings: MenuItem<tauri::Wry>,
    check_updates: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

#[derive(serde::Deserialize)]
struct TrayLabels {
    show: String,
    new_request: String,
    settings: String,
    check_updates: String,
    quit: String,
}

/// Relabel the tray menu in the app's current language. Called by the FE
/// (useTrayEvents) on mount and on every language change.
#[tauri::command]
fn set_tray_labels(labels: TrayLabels, menu: tauri::State<'_, TrayMenu>) -> Result<(), String> {
    menu.show.set_text(&labels.show).map_err(|e| e.to_string())?;
    menu.new_request.set_text(&labels.new_request).map_err(|e| e.to_string())?;
    menu.settings.set_text(&labels.settings).map_err(|e| e.to_string())?;
    menu.check_updates.set_text(&labels.check_updates).map_err(|e| e.to_string())?;
    menu.quit.set_text(&labels.quit).map_err(|e| e.to_string())?;
    Ok(())
}

/// Called by the FE after the user confirms the "Quit PatchMan?" dialog that a
/// Cmd+Q raised. Flags the exit as confirmed and exits for real (the sidecar is
/// killed by the RunEvent::Exit handler).
#[tauri::command]
fn confirm_quit(app: tauri::AppHandle) {
    ALLOW_EXIT.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// "Sign in with Grafana" for SSO-only users (no Grafana password): opens the
/// Grafana login page in its own window, lets the user finish whatever SSO
/// flow their Grafana uses (GitLab, Google, OAuth…), and returns the session
/// cookie from the webview's native cookie store once the window is back on
/// Grafana outside /login. The FE stores it on a 'session' connection; the
/// backend rotates it from then on. Err("cancelled") when the user closes
/// the window, Err("timeout") after 10 minutes.
#[tauri::command]
async fn grafana_sso_login(
    app: tauri::AppHandle,
    url: String,
    cookie_name: Option<String>,
) -> Result<String, String> {
    let base = tauri::Url::parse(url.trim().trim_end_matches('/')).map_err(|e| e.to_string())?;
    if base.scheme() != "http" && base.scheme() != "https" {
        return Err("Grafana URL must be http(s)".into());
    }
    let name = cookie_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "grafana_session".to_string());
    let base_path = base.path().trim_end_matches('/').to_string();
    let login_path = format!("{}/login", base_path);
    let mut login = base.clone();
    login.set_path(&login_path);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let label = format!("grafana-login-{}", stamp);
    let win = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(login))
        .title("Grafana")
        .inner_size(1000.0, 780.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let deadline = Instant::now() + Duration::from_secs(600);
        loop {
            std::thread::sleep(Duration::from_millis(600));
            if app2.get_webview_window(&label).is_none() {
                return Err("cancelled".to_string());
            }
            if Instant::now() > deadline {
                let _ = win.close();
                return Err("timeout".to_string());
            }
            let Ok(cur) = win.url() else { continue };
            let on_grafana = cur.host_str() == base.host_str() && cur.port_or_known_default() == base.port_or_known_default();
            if !on_grafana || cur.path().starts_with(&login_path) {
                continue;
            }
            let Ok(cookies) = win.cookies_for_url(base.clone()) else { continue };
            if let Some(c) = cookies.iter().find(|c| c.name() == name && !c.value().is_empty()) {
                let value = c.value().to_string();
                let _ = win.close();
                return Ok(value);
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Build the menu-bar tray icon: Show / New Request / Settings / Check for
/// Updates / Quit. Action items emit events the FE listens for (useTrayEvents);
/// labels are localized at runtime via set_tray_labels.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show PatchMan", true, None::<&str>)?;
    let new_request = MenuItem::with_id(app, "new_request", "New Request", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let check_updates =
        MenuItem::with_id(app, "check_updates", "Check for Updates…", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit PatchMan", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &new_request, &settings, &check_updates, &sep, &quit],
    )?;

    app.manage(TrayMenu {
        show: show.clone(),
        new_request: new_request.clone(),
        settings: settings.clone(),
        check_updates: check_updates.clone(),
        quit: quit.clone(),
    });

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("PatchMan")
        .menu(&menu)
        // Render as a monochrome menu-bar glyph (white/black to match the OS),
        // like the other status-bar icons — not the colored app icon.
        .icon_as_template(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "new_request" => {
                show_main(app);
                let _ = app.emit("tray://new-request", ());
            }
            "settings" => {
                show_main(app);
                let _ = app.emit("tray://open-settings", ());
            }
            "check_updates" => {
                show_main(app);
                let _ = app.emit("tray://check-updates", ());
            }
            "quit" => {
                // Tray Quit is an explicit action — exit without the Cmd+Q confirm.
                ALLOW_EXIT.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        });
    // A dedicated transparent, monochrome Pac-Man glyph (NOT the opaque colored
    // app icon, whose alpha is a full square → a filled block under template
    // rendering). With icon_as_template it tints to match the menu bar.
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png")) {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar = Arc::new(SidecarHandle::new());
    let sidecar_for_setup = sidecar.clone();
    let sidecar_for_exit = sidecar.clone();

    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_tray_labels, confirm_quit, grafana_sso_login])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
                // In dev, no bundled Info.plist registers the scheme. Register at runtime
                // so `open patchman://...` during development actually reaches this app.
                #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
                {
                    let _ = app.deep_link().register_all();
                }
            }
            if let Err(err) = boot(app, &sidecar_for_setup) {
                // Returning the error would make Tauri panic → SIGABRT. Show
                // why instead, then quit for real (ALLOW_EXIT skips the
                // quit-confirm guard; there is no window to confirm in).
                sidecar_for_setup.kill();
                eprintln!("PatchMan boot failed: {err}");
                let handle = app.handle().clone();
                app.dialog()
                    .message(format!("PatchMan could not start.\n\n{err}"))
                    .title("PatchMan")
                    .kind(MessageDialogKind::Error)
                    .show(move |_| {
                        ALLOW_EXIT.store(true, Ordering::SeqCst);
                        handle.exit(1);
                    });
                return Ok(());
            }
            build_tray(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Tauri app");

    app.run(move |app_handle, event| match event {
        // Cmd+Q (and any OS-initiated quit): unless the quit was already
        // confirmed (FE dialog or tray Quit), prevent it and ask the FE to show
        // the themed "Quit PatchMan?" confirm. window.confirm isn't usable in the
        // shell, so the confirm lives in the FE and calls back via confirm_quit.
        RunEvent::ExitRequested { api, .. } => {
            if ALLOW_EXIT.load(Ordering::SeqCst) {
                sidecar_for_exit.kill();
            } else {
                api.prevent_exit();
                show_main(app_handle);
                let _ = app_handle.emit("app://confirm-quit", ());
            }
        }
        RunEvent::Exit => sidecar_for_exit.kill(),
        // macOS: clicking the dock icon while the window is hidden (closed to
        // tray) brings it back.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(app_handle),
        _ => {}
    });
}
