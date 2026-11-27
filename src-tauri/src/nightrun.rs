//! CR + QA night run (CR_QA_RFC P3): installs a per-user launchd job that runs
//! the person's own agent (Claude Code) on their review queue at a set time.
//! macOS only; the person clicks "Install" in the CR + QA Hub. The job always
//! runs `claude -p <prompt> --allowedTools <tools>`: the prompt and the tool
//! list are passed as separate arguments (no shell interpolation), and only
//! MCP tool names are accepted, so the webview can't schedule other programs
//! or pre-approve other tools.

use std::path::PathBuf;
use std::process::Command;

const LABEL: &str = "com.pttem.patchman.nightrun";

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NightRun {
    hour: u8,
    minute: u8,
    prompt: String,
    /// MCP tool names to pre-approve, e.g. mcp__patchman__qa_review_queue.
    allowed_tools: Vec<String>,
    /// 1 (Mon) … 7 (Sun); empty = every day.
    #[serde(default)]
    days: Vec<u8>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NightRunState {
    installed: bool,
    plist: String,
    log: String,
    supported: bool,
}

fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME").map(PathBuf::from).ok_or_else(|| "HOME is not set".to_string())
}

fn plist_path() -> Result<PathBuf, String> {
    Ok(home()?.join("Library/LaunchAgents").join(format!("{LABEL}.plist")))
}

fn log_path() -> Result<PathBuf, String> {
    Ok(home()?.join("Library/Logs/PatchMan/night-run.log"))
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn uid() -> Result<String, String> {
    let out = Command::new("/usr/bin/id").arg("-u").output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn plist(cfg: &NightRun, log: &str) -> String {
    let interval = |weekday: Option<u8>| {
        let wd = weekday.map(|d| format!("<key>Weekday</key><integer>{}</integer>", d % 7)).unwrap_or_default();
        format!("<dict>{wd}<key>Hour</key><integer>{}</integer><key>Minute</key><integer>{}</integer></dict>", cfg.hour, cfg.minute)
    };
    let cal = if cfg.days.is_empty() {
        interval(None)
    } else {
        format!("<array>{}</array>", cfg.days.iter().map(|d| interval(Some(*d))).collect::<String>())
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/zsh</string><string>-lc</string><string>mkdir -p "$HOME/.patchman/agent" &amp;&amp; cd "$HOME/.patchman/agent" &amp;&amp; exec claude -p "$1" --allowedTools "$2"</string><string>patchman-night-run</string><string>{prompt}</string><string>{tools}</string></array>
  <key>StartCalendarInterval</key>{cal}
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
"#,
        prompt = xml_escape(&cfg.prompt),
        tools = xml_escape(&cfg.allowed_tools.join(",")),
        log = xml_escape(log),
    )
}

/// mcp__<server>__<tool>, letters / digits / _ - . only.
fn valid_tool(t: &str) -> bool {
    let Some(rest) = t.strip_prefix("mcp__") else { return false };
    let Some((server, tool)) = rest.split_once("__") else { return false };
    let ok = |s: &str, extra: &str| !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || extra.contains(c));
    ok(server, "-.") && ok(tool, "")
}

#[tauri::command]
pub fn night_run_state() -> Result<NightRunState, String> {
    let p = plist_path()?;
    Ok(NightRunState {
        installed: p.exists(),
        plist: p.to_string_lossy().into_owned(),
        log: log_path()?.to_string_lossy().into_owned(),
        supported: cfg!(target_os = "macos"),
    })
}

#[tauri::command]
pub fn night_run_install(cfg: NightRun) -> Result<NightRunState, String> {
    if !cfg!(target_os = "macos") {
        return Err("Scheduling the night run is available on macOS; elsewhere use cron with the command shown.".into());
    }
    if cfg.prompt.trim().is_empty() || cfg.prompt.len() > 4000 || cfg.prompt.contains('\0') {
        return Err("The prompt is empty or too long.".into());
    }
    if cfg.allowed_tools.is_empty() || cfg.allowed_tools.len() > 24 || !cfg.allowed_tools.iter().all(|t| valid_tool(t)) {
        return Err("Allowed tools must be MCP tool names like mcp__patchman__qa_review_queue.".into());
    }
    if cfg.hour > 23 || cfg.minute > 59 || cfg.days.iter().any(|d| *d < 1 || *d > 7) {
        return Err("Invalid time or days.".into());
    }
    let p = plist_path()?;
    let log = log_path()?;
    if let Some(dir) = log.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, plist(&cfg, &log.to_string_lossy())).map_err(|e| e.to_string())?;
    let domain = format!("gui/{}", uid()?);
    let _ = Command::new("/bin/launchctl").args(["bootout", &format!("{domain}/{LABEL}")]).output();
    let out = Command::new("/bin/launchctl").args(["bootstrap", &domain, &p.to_string_lossy()]).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("launchctl: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    night_run_state()
}

#[tauri::command]
pub fn night_run_remove() -> Result<NightRunState, String> {
    let p = plist_path()?;
    if let Ok(u) = uid() {
        let _ = Command::new("/bin/launchctl").args(["bootout", &format!("gui/{u}/{LABEL}")]).output();
    }
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    night_run_state()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plist_escapes_and_lists_days() {
        let cfg = NightRun { hour: 2, minute: 30, prompt: "a & <b>; rm -rf ~".into(), allowed_tools: vec!["mcp__patchman__qa_review_queue".into()], days: vec![1, 7] };
        let x = plist(&cfg, "/tmp/l.log");
        // The prompt is its own argument, never part of the shell script.
        assert!(x.contains("exec claude -p \"$1\" --allowedTools \"$2\"</string>"));
        assert!(x.contains("<string>a &amp; &lt;b&gt;; rm -rf ~</string>"));
        assert!(x.contains("<string>mcp__patchman__qa_review_queue</string>"));
        assert!(x.contains("<key>Weekday</key><integer>1</integer>"));
        assert!(x.contains("<key>Weekday</key><integer>0</integer>")); // Sunday
        assert!(x.contains("<key>Hour</key><integer>2</integer>"));
    }

    #[test]
    fn tool_names() {
        assert!(valid_tool("mcp__patchman__qa_mr_context"));
        assert!(valid_tool("mcp__patchman-local__create_test_case"));
        assert!(!valid_tool("Bash"));
        assert!(!valid_tool("mcp__patchman"));
        assert!(!valid_tool("mcp__p__x;rm"));
    }
}
