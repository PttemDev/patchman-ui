//! Plugin developer mode (PLUGIN_MARKETPLACE_RFC invariant 5: a separate,
//! visible mode). Settings → Plugins can restart the app into developer mode
//! for ONE session: the command writes a flag file after a fresh Touch ID
//! prompt, boot consumes it (deletes it before trusting it) and hands
//! `PATCHMAN_PLUGIN_DEV=1` to the sidecar. The next normal launch is back in
//! the safe mode, so a forgotten dev mode cannot linger.
//!
//! Starting the binary with `PATCHMAN_PLUGIN_DEV=1` still works; boot removes
//! the variable from this process so a restart out of dev mode really leaves
//! it (a relaunch inherits our environment).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};

const FLAG: &str = "plugin-dev.once";
const ENV: &str = "PATCHMAN_PLUGIN_DEV";

/// Whether this session runs in plugin developer mode.
pub struct PluginDev(pub AtomicBool);

fn flag_path(app_data: &Path) -> PathBuf {
    app_data.join(FLAG)
}

/// One-shot: true only if the flag existed AND was removed, so a flag that
/// cannot be deleted never turns into a permanent developer mode.
pub fn consume_flag(app_data: &Path) -> bool {
    let p = flag_path(app_data);
    match std::fs::symlink_metadata(&p) {
        Ok(m) if m.is_file() => std::fs::remove_file(&p).is_ok(),
        Ok(_) => {
            // Not a regular file (symlink, dir): never trust it, try to clear it.
            let _ = std::fs::remove_file(&p).or_else(|_| std::fs::remove_dir_all(&p));
            false
        }
        Err(_) => false,
    }
}

/// Resolves the mode for this session (flag or environment) and clears both
/// sources so a relaunch starts in the safe mode unless asked again.
pub fn resolve(app_data: &Path) -> bool {
    let from_flag = consume_flag(app_data);
    let from_env = std::env::var(ENV).as_deref() == Ok("1");
    std::env::remove_var(ENV);
    from_flag || from_env
}

fn write_flag(app_data: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(app_data)?;
    crate::security::write_private(&flag_path(app_data), b"1\n")
}

fn restart(app: &AppHandle) {
    // A restart goes through ExitRequested; mark it confirmed so the
    // quit-confirm guard lets it through and the sidecar is killed first.
    crate::ALLOW_EXIT.store(true, Ordering::SeqCst);
    app.request_restart();
}

#[tauri::command]
pub fn plugin_dev_state(window: tauri::WebviewWindow, dev: tauri::State<'_, PluginDev>) -> Result<bool, String> {
    crate::security::own_window(&window)?;
    Ok(dev.0.load(Ordering::SeqCst))
}

/// enable=true: Touch ID (always, not the step-up window), write the flag,
/// restart. enable=false: restart without it (leaving dev mode needs no auth).
/// Only the main window may call it: never a plugin iframe (no IPC there) or
/// a detached window.
#[tauri::command]
pub async fn plugin_dev_restart(window: tauri::WebviewWindow, app: AppHandle, enable: bool) -> Result<(), String> {
    if window.label() != "main" {
        return Err("not allowed".into());
    }
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if enable {
        let a = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if a.state::<crate::security::Security>().snapshot().locked {
                return Err("locked".to_string());
            }
            if crate::security::auth_available() {
                crate::security::authenticate("restart PatchMan in plugin developer mode")?;
            }
            write_flag(&app_data).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
    } else {
        // A pending flag (e.g. a failed restart) must not survive "leave".
        let _ = consume_flag(&app_data);
    }
    restart(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pm-plugindev-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn flag_is_one_shot() {
        let d = tmp("once");
        assert!(!consume_flag(&d));
        write_flag(&d).unwrap();
        assert!(consume_flag(&d), "flag turns dev mode on");
        assert!(!flag_path(&d).exists(), "flag is deleted");
        assert!(!consume_flag(&d), "next launch is back in safe mode");
    }

    #[cfg(unix)]
    #[test]
    fn symlink_flag_is_ignored() {
        let d = tmp("link");
        let target = d.join("target");
        std::fs::write(&target, b"1").unwrap();
        std::os::unix::fs::symlink(&target, flag_path(&d)).unwrap();
        assert!(!consume_flag(&d));
        assert!(target.exists(), "symlink target is never touched");
    }

    #[cfg(unix)]
    #[test]
    fn flag_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp("perm");
        write_flag(&d).unwrap();
        let mode = std::fs::metadata(flag_path(&d)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn env_is_consumed() {
        let d = tmp("env");
        std::env::set_var(ENV, "1");
        assert!(resolve(&d));
        assert!(std::env::var(ENV).is_err(), "a relaunch must not inherit it");
        assert!(!resolve(&d));
    }
}
