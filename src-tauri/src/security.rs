// App lock + step-up auth for the desktop app (DESKTOP_SECURITY_RFC L4/L6/L7).
//
// The shell owns the security state: settings live in `security.json` under
// the app-data dir (written only here, and weakening a setting needs the
// user's Touch ID / macOS password), the lock state and the step-up ("sudo")
// window live in memory. Every change is pushed to the embedded BE over a
// control token only this process knows, so the webview's JS alone can never
// unlock the BE.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

pub const STATE_EVENT: &str = "security://state";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Lock the app on launch, after idle, on sleep / screen lock.
    pub lock_enabled: bool,
    pub idle_minutes: u32,
    pub lock_on_sleep: bool,
    pub lock_on_screen_lock: bool,
    /// While locked, agents (MCP) get no data either.
    pub block_mcp_while_locked: bool,
    /// Revealing secrets, shells, port-forwards and cluster writes need a
    /// recent Touch ID / password.
    pub sudo_enabled: bool,
    pub sudo_minutes: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            lock_enabled: true,
            idle_minutes: 15,
            lock_on_sleep: true,
            lock_on_screen_lock: true,
            block_mcp_while_locked: true,
            sudo_enabled: true,
            sudo_minutes: 5,
        }
    }
}

impl Settings {
    fn clamp(mut self) -> Self {
        self.idle_minutes = self.idle_minutes.clamp(1, 480);
        self.sudo_minutes = self.sudo_minutes.clamp(1, 60);
        self
    }

    /// True when `next` protects less than `self` — such changes need auth.
    fn weakened_by(&self, next: &Settings) -> bool {
        (self.lock_enabled && !next.lock_enabled)
            || next.idle_minutes > self.idle_minutes
            || (self.lock_on_sleep && !next.lock_on_sleep)
            || (self.lock_on_screen_lock && !next.lock_on_screen_lock)
            || (self.block_mcp_while_locked && !next.block_mcp_while_locked)
            || (self.sudo_enabled && !next.sudo_enabled)
            || next.sudo_minutes > self.sudo_minutes
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub settings: Settings,
    pub locked: bool,
    /// Unix seconds until which step-up is fresh (0 = not fresh).
    pub sudo_until: u64,
    pub auth_available: bool,
}

struct State {
    settings: Settings,
    locked: bool,
    last_activity: Instant,
    sudo_until: u64,
}

pub struct Security {
    state: Mutex<State>,
    path: PathBuf,
    control_token: String,
    launch_token: String,
    port: Mutex<u16>,
}

fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

impl Security {
    pub fn new(app_data: PathBuf, launch_token: String, control_token: String) -> Self {
        let path = app_data.join("security.json");
        let settings = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Settings>(&b).ok())
            .unwrap_or_default()
            .clamp();
        let locked = settings.lock_enabled && auth::available();
        Security {
            state: Mutex::new(State { settings, locked, last_activity: Instant::now(), sudo_until: 0 }),
            path,
            control_token,
            launch_token,
            port: Mutex::new(0),
        }
    }

    pub fn starts_locked(&self) -> bool {
        self.state.lock().unwrap().locked
    }

    pub fn set_port(&self, port: u16) {
        *self.port.lock().unwrap() = port;
    }

    pub fn snapshot(&self) -> Snapshot {
        let s = self.state.lock().unwrap();
        Snapshot {
            settings: s.settings.clone(),
            locked: s.locked,
            sudo_until: if s.settings.sudo_enabled { s.sudo_until } else { 0 },
            auth_available: auth::available(),
        }
    }

    /// Pushes the state the BE enforces (lock, MCP block, sudo window).
    pub fn push(&self) {
        let port = *self.port.lock().unwrap();
        if port == 0 {
            return;
        }
        let snap = self.snapshot();
        let body = serde_json::json!({
            "locked": snap.locked,
            "blockMcp": snap.settings.block_mcp_while_locked,
            "sudoEnabled": snap.settings.sudo_enabled && snap.auth_available,
            "sudoUntil": snap.sudo_until,
        })
        .to_string();
        let req = format!(
            "POST /api/_local/security HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Local-Token: {}\r\nX-Local-Control: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            self.launch_token,
            self.control_token,
            body.len()
        );
        let res = (|| -> std::io::Result<String> {
            let mut s = TcpStream::connect(("127.0.0.1", port))?;
            s.set_read_timeout(Some(Duration::from_secs(3)))?;
            s.write_all(req.as_bytes())?;
            let mut buf = [0u8; 64];
            let n = s.read(&mut buf)?;
            Ok(String::from_utf8_lossy(&buf[..n]).to_string())
        })();
        match res {
            Ok(head) if head.starts_with("HTTP/1.1 204") || head.starts_with("HTTP/1.1 200") => {}
            Ok(head) => eprintln!("[security] BE refused state push: {}", head.lines().next().unwrap_or("")),
            Err(e) => eprintln!("[security] BE state push failed: {e}"),
        }
    }

    fn emit(&self, app: &AppHandle) {
        let _ = app.emit(STATE_EVENT, self.snapshot());
    }

    pub fn lock(&self, app: &AppHandle) {
        {
            let mut s = self.state.lock().unwrap();
            if s.locked || !s.settings.lock_enabled || !auth::available() {
                return;
            }
            s.locked = true;
            s.sudo_until = 0;
        }
        self.push();
        self.emit(app);
    }

    fn fresh_auth(&self) {
        let mut s = self.state.lock().unwrap();
        s.last_activity = Instant::now();
        s.sudo_until = now_unix() + u64::from(s.settings.sudo_minutes) * 60;
    }

    pub fn unlock(&self, app: &AppHandle) -> Result<Snapshot, String> {
        // Already unlocked: nothing to do — and above all no fresh step-up
        // window without a prompt (that would bypass `security_sudo`).
        if !self.state.lock().unwrap().locked {
            return Ok(self.snapshot());
        }
        auth::authenticate("unlock PatchMan")?;
        self.state.lock().unwrap().locked = false;
        self.fresh_auth();
        self.push();
        self.emit(app);
        Ok(self.snapshot())
    }

    /// Ensures a fresh step-up; prompts when the window has lapsed.
    pub fn sudo(&self, app: &AppHandle, reason: &str) -> Result<Snapshot, String> {
        let (enabled, until, locked) = {
            let s = self.state.lock().unwrap();
            (s.settings.sudo_enabled, s.sudo_until, s.locked)
        };
        if locked {
            return Err("locked".into());
        }
        if !enabled || !auth::available() || until > now_unix() {
            return Ok(self.snapshot());
        }
        auth::authenticate(reason)?;
        self.fresh_auth();
        self.push();
        self.emit(app);
        Ok(self.snapshot())
    }

    pub fn activity(&self) {
        let mut s = self.state.lock().unwrap();
        if !s.locked {
            s.last_activity = Instant::now();
        }
    }

    pub fn update(&self, app: &AppHandle, next: Settings) -> Result<Snapshot, String> {
        let next = next.clamp();
        let (weakened, locked) = {
            let s = self.state.lock().unwrap();
            (s.settings.weakened_by(&next), s.locked)
        };
        if locked {
            return Err("locked".into());
        }
        if weakened && auth::available() {
            auth::authenticate("change PatchMan security settings")?;
        }
        let bytes = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        write_private(&self.path, &bytes).map_err(|e| e.to_string())?;
        {
            let mut s = self.state.lock().unwrap();
            s.settings = next;
            s.last_activity = Instant::now();
        }
        self.push();
        self.emit(app);
        Ok(self.snapshot())
    }

    /// Background monitor: idle timeout, sleep (wall-clock jump) and screen
    /// lock. Polls every 5 s — cheap, and no OS notification plumbing.
    pub fn start_monitor(app: AppHandle) {
        std::thread::spawn(move || {
            let mut last_wall = SystemTime::now();
            loop {
                std::thread::sleep(Duration::from_secs(5));
                let wall = SystemTime::now();
                let slept = wall.duration_since(last_wall).map(|d| d > Duration::from_secs(30)).unwrap_or(false);
                last_wall = wall;
                let sec = app.state::<Security>();
                let reason = {
                    let s = sec.state.lock().unwrap();
                    if s.locked || !s.settings.lock_enabled {
                        None
                    } else if idle_for(s.last_activity) > Duration::from_secs(u64::from(s.settings.idle_minutes) * 60) {
                        Some("idle")
                    } else if s.settings.lock_on_sleep && slept {
                        Some("sleep")
                    } else if s.settings.lock_on_screen_lock && screen::is_locked() {
                        Some("screen")
                    } else {
                        None
                    }
                };
                if reason.is_some() {
                    sec.lock(&app);
                }
            }
        });
    }
}

/// How long the user has been away: the Mac's own input idle time (so working
/// in another app doesn't lock PatchMan), falling back to PatchMan activity
/// where the OS can't say.
fn idle_for(last_app_activity: Instant) -> Duration {
    screen::system_idle().unwrap_or_else(|| last_app_activity.elapsed())
}

pub(crate) fn write_private(path: &PathBuf, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(tmp, path)
}

// ── Touch ID / macOS password (LocalAuthentication) ─────────────────────

#[cfg(target_os = "macos")]
mod auth {
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2_foundation::NSString;

    #[link(name = "LocalAuthentication", kind = "framework")]
    extern "C" {}

    /// LAPolicyDeviceOwnerAuthentication: Touch ID, Apple Watch or the
    /// account password — works on Macs without Touch ID too.
    const POLICY: isize = 2;

    fn context() -> Option<Retained<AnyObject>> {
        let cls = AnyClass::get(c"LAContext")?;
        let ctx: Option<Retained<AnyObject>> = unsafe { msg_send![cls, new] };
        ctx
    }

    pub fn available() -> bool {
        let Some(ctx) = context() else { return false };
        let ok: Bool = unsafe { msg_send![&*ctx, canEvaluatePolicy: POLICY, error: std::ptr::null_mut::<*mut AnyObject>()] };
        ok.as_bool()
    }

    pub fn authenticate(reason: &str) -> Result<(), String> {
        let ctx = context().ok_or("LocalAuthentication unavailable")?;
        let (tx, rx) = mpsc::channel::<bool>();
        let block = RcBlock::new(move |success: Bool, _err: *mut AnyObject| {
            let _ = tx.send(success.as_bool());
        });
        let reason = NSString::from_str(reason);
        unsafe {
            let _: () = msg_send![&*ctx, evaluatePolicy: POLICY, localizedReason: &*reason, reply: &*block];
        }
        match rx.recv_timeout(Duration::from_secs(300)) {
            Ok(true) => Ok(()),
            Ok(false) => Err("authentication failed or cancelled".into()),
            Err(_) => Err("authentication timed out".into()),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod auth {
    // Windows Hello / polkit are not wired yet (RFC Q4): no lock, no step-up.
    pub fn available() -> bool {
        false
    }
    pub fn authenticate(_reason: &str) -> Result<(), String> {
        Err("not supported on this platform".into())
    }
}

/// Touch ID / account password, for callers outside the step-up window.
pub(crate) fn auth_available() -> bool {
    auth::available()
}

pub(crate) fn authenticate(reason: &str) -> Result<(), String> {
    auth::authenticate(reason)
}

// ── Screen lock + system idle ───────────────────────────────────────────

#[cfg(target_os = "macos")]
mod screen {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::CFString;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGSessionCopyCurrentDictionary() -> CFDictionaryRef;
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
    }

    pub fn is_locked() -> bool {
        unsafe {
            let raw = CGSessionCopyCurrentDictionary();
            if raw.is_null() {
                return false;
            }
            let dict: CFDictionary<CFString, CFType> = CFDictionary::wrap_under_create_rule(raw);
            dict.find(CFString::from_static_string("CGSSessionScreenIsLocked"))
                .and_then(|v| v.downcast::<CFBoolean>())
                .map(bool::from)
                .unwrap_or(false)
        }
    }

    /// Seconds since the last keyboard / mouse / trackpad input anywhere on
    /// the Mac (kCGEventSourceStateCombinedSessionState, kCGAnyInputEventType).
    pub fn system_idle() -> Option<std::time::Duration> {
        let secs = unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) };
        (secs.is_finite() && secs >= 0.0).then(|| std::time::Duration::from_secs_f64(secs))
    }
}

#[cfg(not(target_os = "macos"))]
mod screen {
    pub fn is_locked() -> bool {
        false
    }
    pub fn system_idle() -> Option<std::time::Duration> {
        None
    }
}

// ── Cipher key in the Keychain (RFC L5) ─────────────────────────────────
//
// The embedded BE encrypts stored secrets with an AES key that lives in
// `patchman.db.cipher.key` next to the DB — readable by anything that can read
// the user's files. This release copies it into the login Keychain (verified
// by reading it back) and hands the BE that copy through env; the file stays
// where it is, so an older build reading the same data dir still finds it and
// the BE always prefers the file when the two disagree. The item is only
// ever created after a confirmed "not found" (never overwritten on another
// error) and the BE pins the key with `<db>.cipher.kid`, so once this build
// is installed the key file can be deleted safely; until it is, L5 adds no
// protection on its own.

// Keychain account of the embedded cipher key. Builds with another bundle
// identifier (e.g. the open-source build) keep their own data dir, so they
// must not read or adopt this build's key: each identifier gets its own
// account. The original identifier keeps the original account name so
// existing installs find their item.
const LEGACY_APP_ID: &str = "com.pttem.patchman";

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn keychain_account(app_id: &str) -> String {
    if app_id.is_empty() || app_id == LEGACY_APP_ID {
        "embedded-cipher-key".to_string()
    } else {
        format!("embedded-cipher-key:{app_id}")
    }
}

#[cfg(target_os = "macos")]
pub fn cipher_key_from_keychain(db_path: &std::path::Path, app_id: &str) -> Option<String> {
    use security_framework::passwords::{get_generic_password, set_generic_password};
    const SERVICE: &str = "PatchMan";
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
    let account = keychain_account(app_id);

    let file = PathBuf::from(format!("{}.cipher.key", db_path.display()));
    let read_file = |p: &PathBuf| std::fs::read_to_string(p).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    match get_generic_password(SERVICE, &account) {
        Ok(bytes) => {
            let kc = String::from_utf8(bytes).ok()?.trim().to_string();
            if kc.is_empty() {
                return None;
            }
            // A file that disagrees wins (the BE checks too): never risk secrets.
            if let Some(f) = read_file(&file) {
                if f != kc {
                    eprintln!("[security] keychain key differs from cipher.key — keeping the file");
                    return None;
                }
            }
            return Some(kc);
        }
        // Only a confirmed "no such item" may create one. Any other error —
        // access denied, a re-signed build, a locked keychain — leaves the
        // item alone: overwriting it with a fresh key would lose every
        // stored secret once the key file is gone. The BE then falls back
        // to the file / .bak, or starts without the cipher.
        Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => {}
        Err(e) => {
            eprintln!("[security] keychain read failed ({}) — leaving the item untouched", e.code());
            return None;
        }
    }

    // First run on this version: adopt the file's key, or mint one.
    let key = match read_file(&file) {
        Some(k) => k,
        None => {
            // A backup, or a key fingerprint (BE `<db>.cipher.kid`), means
            // secrets already exist under some key: never mint over them.
            if file.with_extension("key.bak").exists() || file.with_extension("kid").exists() {
                return None;
            }
            let mut raw = [0u8; 32];
            getrandom::getrandom(&mut raw).ok()?;
            base64_std(&raw)
        }
    };
    set_generic_password(SERVICE, &account, key.as_bytes()).ok()?;
    let back = get_generic_password(SERVICE, &account).ok()?;
    if back != key.as_bytes() {
        return None;
    }
    Some(key)
}

#[cfg(not(target_os = "macos"))]
pub fn cipher_key_from_keychain(_db_path: &std::path::Path, _app_id: &str) -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
fn base64_std(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for c in bytes.chunks(3) {
        let n = (u32::from(c[0]) << 16) | (u32::from(*c.get(1).unwrap_or(&0)) << 8) | u32::from(*c.get(2).unwrap_or(&0));
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

// ── IPC commands ────────────────────────────────────────────────────────

pub(crate) fn own_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let l = window.label();
    if l == "main" || l.starts_with("detached-") {
        Ok(())
    } else {
        Err("not allowed".into())
    }
}

#[tauri::command]
pub fn security_state(window: tauri::WebviewWindow, sec: tauri::State<'_, Security>) -> Result<Snapshot, String> {
    own_window(&window)?;
    Ok(sec.snapshot())
}

#[tauri::command]
pub async fn security_unlock(window: tauri::WebviewWindow, app: AppHandle) -> Result<Snapshot, String> {
    own_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<Security>().unlock(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn security_lock(window: tauri::WebviewWindow, app: AppHandle, sec: tauri::State<'_, Security>) -> Result<(), String> {
    own_window(&window)?;
    sec.lock(&app);
    Ok(())
}

#[tauri::command]
pub fn security_activity(window: tauri::WebviewWindow, sec: tauri::State<'_, Security>) -> Result<(), String> {
    own_window(&window)?;
    sec.activity();
    Ok(())
}

#[tauri::command]
pub async fn security_sudo(window: tauri::WebviewWindow, app: AppHandle, reason: String) -> Result<Snapshot, String> {
    own_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<Security>().sudo(&app, &reason))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn security_update(window: tauri::WebviewWindow, app: AppHandle, settings: Settings) -> Result<Snapshot, String> {
    own_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<Security>().update(&app, settings))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keychain_account_per_identifier() {
        assert_eq!(keychain_account("com.pttem.patchman"), "embedded-cipher-key");
        assert_eq!(keychain_account(""), "embedded-cipher-key");
        assert_eq!(
            keychain_account("io.github.pttemdev.patchman"),
            "embedded-cipher-key:io.github.pttemdev.patchman"
        );
    }

    #[test]
    fn weakening_detection() {
        let base = Settings::default();
        assert!(!base.weakened_by(&base));
        assert!(base.weakened_by(&Settings { lock_enabled: false, ..base.clone() }));
        assert!(base.weakened_by(&Settings { idle_minutes: 60, ..base.clone() }));
        assert!(!base.weakened_by(&Settings { idle_minutes: 5, ..base.clone() }));
        assert!(base.weakened_by(&Settings { sudo_enabled: false, ..base.clone() }));
        assert!(base.weakened_by(&Settings { block_mcp_while_locked: false, ..base.clone() }));
        let off = Settings { lock_enabled: false, ..base.clone() };
        assert!(!off.weakened_by(&base), "turning protection on needs no auth");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn base64_matches_std() {
        assert_eq!(base64_std(b"hello"), "aGVsbG8=");
        assert_eq!(base64_std(b"hi"), "aGk=");
        assert_eq!(base64_std(&[0u8; 32]).len(), 44);
    }

    #[test]
    fn clamps_ranges() {
        let s = Settings { idle_minutes: 0, sudo_minutes: 999, ..Settings::default() }.clamp();
        assert_eq!((s.idle_minutes, s.sudo_minutes), (1, 60));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn system_idle_is_readable() {
        assert!(screen::system_idle().is_some());
    }
}
