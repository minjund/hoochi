//! The hookwich window: a little always-on-top bubble that opens into the
//! editor, hides to the menu bar, and reads/writes ~/.hookwich.
//!
//! The Claude Code side (the plugin) reads config.json on every hook event,
//! writes activity.json, and writes control.json to show or hide this window.

use std::{
    fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, SystemTime},
};

use serde::Serialize;
use serde_json::Value;

pub mod codex;
pub mod existing;
pub mod running;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow, WindowEvent,
};

const BUBBLE: (f64, f64) = (76.0, 76.0);
const PANEL: (f64, f64) = (440.0, 760.0);
const MARGIN: f64 = 24.0;
const DOCK_ROOM: f64 = 90.0;
const EMPTY_CONFIG: &str = "{\n  \"version\": 2,\n  \"claude\": { \"global\": [], \"projects\": {}, \"terminals\": {} },\n  \"codex\": { \"global\": [], \"projects\": {}, \"terminals\": {} }\n}\n";

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

fn data_dir() -> PathBuf {
    home().join(".hookwich")
}

fn read_or(path: &Path, fallback: &str) -> String {
    fs::read_to_string(path).unwrap_or_else(|_| fallback.to_string())
}

#[derive(Serialize)]
struct Snapshot {
    config: String,
    #[serde(rename = "activityClaude")]
    activity_claude: String,
    #[serde(rename = "activityCodex")]
    activity_codex: String,
    places: String,
}

/// The config the user edits, what each agent just did, and the known projects and terminals.
/// Marks each known project folder that is a git project, so the window can tell real projects apart.
fn with_git(places: &str) -> String {
    let mut v: Value = serde_json::from_str(places).unwrap_or(Value::Null);
    if let Some(projects) = v.get_mut("projects").and_then(Value::as_object_mut) {
        for (path, entry) in projects.iter_mut() {
            if let Some(o) = entry.as_object_mut() {
                o.insert("git".into(), Value::Bool(std::path::Path::new(path).join(".git").exists()));
            }
        }
    }
    if v.is_null() {
        places.to_string()
    } else {
        v.to_string()
    }
}

#[tauri::command]
fn read_state() -> Snapshot {
    let dir = data_dir();
    let config = if dir.join("config.json").exists() {
        read_or(&dir.join("config.json"), EMPTY_CONFIG)
    } else {
        EMPTY_CONFIG.to_string()
    };
    Snapshot {
        config: serde_json::to_string(&codex::load_config()).unwrap_or(config),
        activity_claude: read_or(&dir.join("activity-claude.json"), "{}"),
        activity_codex: read_or(&dir.join("activity-codex.json"), "{}"),
        places: with_git(&read_or(&dir.join("places.json"), "{}")),
    }
}

/// Hooks already set up outside hookwich, for one project folder.
#[tauri::command]
async fn existing_hooks(project: String) -> Value {
    existing::existing(&project)
}

/// Switches one existing hook off or back on; returns the fresh list.
#[tauri::command]
async fn set_existing_hook(project: String, id: String, on: bool) -> Result<Value, String> {
    existing::set_on(&project, &id, on)?;
    Ok(existing::existing(&project))
}

/// Claude Code and Codex chats open in terminals right now.
#[tauri::command]
async fn running_chats() -> Value {
    running::running()
}

#[tauri::command]
fn codex_status() -> Value {
    codex::status()
}

#[tauri::command]
fn codex_connect() -> Result<Value, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    codex::connect(&exe)
}

#[tauri::command]
fn codex_disconnect() -> Result<Value, String> {
    codex::disconnect()
}

/// Writes the config whole, through a temp file so the plugin never reads half.
#[tauri::command]
fn write_config(text: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&text).map_err(|e| format!("not JSON: {e}"))?;
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("config.json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("config.json")).map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
struct Skill {
    name: String,
    description: String,
}

/// `name:` and `description:` from a SKILL.md front matter.
fn front_matter(text: &str) -> (Option<String>, String) {
    let mut name = None;
    let mut description = String::new();
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, description);
    }
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if let Some(v) = line.strip_prefix("name:") {
            name = Some(v.trim().trim_matches('"').to_string());
        } else if let Some(v) = line.strip_prefix("description:") {
            description = v.trim().trim_matches('"').to_string();
        }
    }
    (name, description)
}

fn skills_in(dir: &Path, prefix: &str, out: &mut Vec<Skill>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let file = entry.path().join("SKILL.md");
        let Ok(text) = fs::read_to_string(&file) else { continue };
        let folder = entry.file_name().to_string_lossy().to_string();
        let (name, mut description) = front_matter(&text);
        let base = name.unwrap_or(folder);
        let name = if prefix.is_empty() { base } else { format!("{prefix}:{base}") };
        if description.chars().count() > 140 {
            description = description.chars().take(139).collect::<String>() + "…";
        }
        out.push(Skill { name, description });
    }
}

/// Skills installed on this machine: the user's own and every plugin's.
#[tauri::command]
fn list_skills() -> Vec<Skill> {
    let claude = home().join(".claude");
    let mut out = Vec::new();
    skills_in(&claude.join("skills"), "", &mut out);
    // plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>/SKILL.md
    if let Ok(markets) = fs::read_dir(claude.join("plugins").join("cache")) {
        for market in markets.flatten() {
            let Ok(plugins) = fs::read_dir(market.path()) else { continue };
            for plugin in plugins.flatten() {
                let name = plugin.file_name().to_string_lossy().to_string();
                let Ok(versions) = fs::read_dir(plugin.path()) else { continue };
                let newest = versions
                    .flatten()
                    .filter(|v| v.path().join("skills").is_dir())
                    .max_by_key(|v| {
                        v.metadata()
                            .and_then(|m| m.modified())
                            .unwrap_or(SystemTime::UNIX_EPOCH)
                    });
                if let Some(v) = newest {
                    skills_in(&v.path().join("skills"), &name, &mut out);
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out.dedup_by(|a, b| a.name == b.name);
    out
}

/// Grows into the editor or shrinks to the bubble, keeping the bottom-right corner put.
#[tauri::command]
fn set_expanded(window: WebviewWindow, expanded: bool) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let pos = window
        .outer_position()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let size = window
        .outer_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let (w, h) = if expanded { PANEL } else { BUBBLE };
    let x = (pos.x + size.width - w).max(0.0);
    let y = (pos.y + size.height - h).max(0.0);
    window
        .set_size(LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    if expanded {
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn start_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn toggle(app: &AppHandle, want: Option<bool>) {
    let Some(window) = app.get_webview_window("main") else { return };
    let visible = window.is_visible().unwrap_or(false);
    if want.unwrap_or(!visible) {
        let _ = window.show();
    } else {
        let _ = window.hide();
    }
}

/// Places the bubble at the bottom-right of the primary screen.
fn place_bottom_right(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.primary_monitor() else { return };
    let scale = monitor.scale_factor();
    let screen = monitor.size().to_logical::<f64>(scale);
    let origin = monitor.position().to_logical::<f64>(scale);
    let x = origin.x + screen.width - BUBBLE.0 - MARGIN;
    let y = origin.y + screen.height - BUBBLE.1 - DOCK_ROOM;
    let _ = window.set_position(LogicalPosition::new(x, y));
}

/// Watches control.json, which the plugin's /hookwich command writes.
fn watch_control(app: AppHandle) {
    thread::spawn(move || {
        let path = data_dir().join("control.json");
        let mtime = |p: &Path| fs::metadata(p).and_then(|m| m.modified()).ok();
        let mut seen = mtime(&path);
        loop {
            thread::sleep(Duration::from_millis(300));
            let now = mtime(&path);
            if now.is_none() || now == seen {
                continue;
            }
            seen = now;
            let cmd = fs::read_to_string(&path)
                .ok()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                .and_then(|v| v.get("cmd").and_then(|c| c.as_str()).map(str::to_string))
                .unwrap_or_default();
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || match cmd.as_str() {
                "show" => toggle(&handle, Some(true)),
                "hide" => toggle(&handle, Some(false)),
                _ => toggle(&handle, None),
            });
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            read_state,
            write_config,
            list_skills,
            set_expanded,
            start_drag,
            hide_window,
            quit,
            codex_status,
            codex_connect,
            codex_disconnect,
            running_chats,
            existing_hooks,
            set_existing_hook
        ])
        .setup(|app| {
            // A menu-bar app: no Dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let _ = fs::create_dir_all(data_dir());
            let config = data_dir().join("config.json");
            if !config.exists() {
                let _ = fs::write(&config, EMPTY_CONFIG);
            }

            let show_hide = MenuItemBuilder::with_id("toggle", "Show / Hide").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit Hookwich").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show_hide, &quit_item])
                .build()?;
            TrayIconBuilder::with_id("main")
                .icon(tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/tray.png"
                ))?)
                .icon_as_template(true)
                .tooltip("Hookwich")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle(app, None),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle(tray.app_handle(), None);
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                place_bottom_right(&window);
                let _ = window.show();
                // Closing hides it to the menu bar instead of quitting.
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            watch_control(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running hookwich");
}
