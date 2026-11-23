//! The hoochi window: a little always-on-top bubble that opens into the
//! editor, hides to the menu bar, and reads/writes ~/.hoochi.
//!
//! The Claude Code side (the plugin) reads config.json on every hook event,
//! writes activity.json, and writes control.json to show or hide this window.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, SystemTime},
};

use serde::Serialize;
use serde_json::Value;

pub mod codex;
pub mod existing;
pub mod origin;
pub mod rename;
pub mod running;
pub mod skills;
pub mod update;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow, WindowEvent,
};

const BUBBLE: (f64, f64) = (76.0, 76.0);
/// Wide enough that the lifecycle picture (520 wide) is drawn near its own size, so its text stays sharp.
const PANEL: (f64, f64) = (500.0, 760.0);
const MARGIN: f64 = 24.0;
const EMPTY_CONFIG: &str = "{\n  \"version\": 2,\n  \"claude\": { \"global\": [], \"projects\": {}, \"terminals\": {} },\n  \"codex\": { \"global\": [], \"projects\": {}, \"terminals\": {} }\n}\n";

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

fn data_dir() -> PathBuf {
    home().join(".hoochi")
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
    /// whether Claude Code's classic hooks reach the plugin here, as it last found
    #[serde(rename = "classicClaude")]
    classic_claude: String,
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
        classic_claude: read_or(&dir.join("classic-claude.json"), "{}"),
    }
}

/// Hooks already set up outside hoochi, for one project folder.
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

/// The file the plugin keeps a terminal's /context figures in (the plugin names it the same way).
pub(crate) fn context_file(terminal: &str) -> String {
    let safe: String = terminal
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '_' })
        .collect();
    format!("{safe}.json")
}

/// What /context shows for one terminal's Claude Code chat, as the plugin last wrote it; null if never.
#[tauri::command]
fn context_usage(terminal: String) -> Value {
    if terminal.is_empty() {
        return Value::Null;
    }
    let path = data_dir().join("context").join(context_file(&terminal));
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(Value::Null)
}

/// Skills switched off with skillOverrides, and every plugin with whether it is on.
#[tauri::command]
fn skill_state() -> Value {
    skills::state()
}

/// Switches one skill of your own (or a built-in one) off or back on; returns the fresh state.
#[tauri::command]
fn set_skill(name: String, on: bool) -> Result<Value, String> {
    skills::set_skill(&name, on)?;
    Ok(skills::state())
}

/// Switches a whole plugin off or back on, for its skills; returns the fresh state.
#[tauri::command]
fn set_plugin(key: String, on: bool) -> Result<Value, String> {
    skills::set_plugin(&key, on)?;
    Ok(skills::state())
}

/// Whether a newer hoochi is out, and what the last update did.
#[tauri::command]
async fn check_update() -> Value {
    update::check()
}

/// Updates the plugin and the window to `version`, then quits so the new window opens.
#[tauri::command]
async fn apply_update(app: AppHandle, version: String) -> Result<Value, String> {
    let done = update::apply(&version)?;
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(700));
        app.exit(0);
    });
    Ok(done)
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

/// Where the bubble sat when it opened into the panel, so folding puts it back right there.
static BUBBLE_AT: Mutex<Option<(f64, f64)>> = Mutex::new(None);

/// Where the bubble goes when the panel folds: back where it was before it opened (pulled onto a
/// display if that one is gone), else at the panel's bottom-right corner, as when it never opened.
pub fn fold_to(areas: &[Area], was: Option<(f64, f64)>, panel: Rect) -> (f64, f64) {
    let (w, h) = BUBBLE;
    match was {
        Some((x, y)) => keep_on_screen(areas, (x, y, w, h), x, y, w, h),
        None => {
            let (px, py, pw, ph) = panel;
            keep_on_screen(areas, panel, px + pw - w, py + ph - h, w, h)
        }
    }
}

/// Grows into the editor (its bottom-right corner on the bubble's) or shrinks back to the bubble,
/// which returns to exactly where it was before it opened, wherever the panel was moved or pushed.
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
    let now = (pos.x, pos.y, size.width, size.height);
    let is_bubble = (size.width - BUBBLE.0).abs() < 1.0 && (size.height - BUBBLE.1).abs() < 1.0;
    let mut at = BUBBLE_AT.lock().unwrap_or_else(|e| e.into_inner());
    let (x, y) = if expanded {
        // Only the bubble's own spot is remembered: opening again while open keeps the first one.
        if is_bubble {
            *at = Some((pos.x, pos.y));
        }
        // The panel's bottom-right corner on the bubble's, but never off the display.
        keep_on_screen(&areas(&window), now, pos.x + size.width - w, pos.y + size.height - h, w, h)
    } else if is_bubble {
        (pos.x, pos.y)
    } else {
        fold_to(&areas(&window), at.take(), now)
    };
    drop(at);
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

/// The bubble's right-click menu: hide to the menu bar, or quit. Labels come in the window's language.
#[tauri::command]
fn bubble_menu(window: WebviewWindow, hide: String, quit: String) -> Result<(), String> {
    let app = window.app_handle();
    let hide = MenuItemBuilder::with_id("bubble-hide", hide).build(app).map_err(|e| e.to_string())?;
    let quit = MenuItemBuilder::with_id("bubble-quit", quit).build(app).map_err(|e| e.to_string())?;
    let menu = MenuBuilder::new(app).items(&[&hide, &quit]).build().map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn toggle(app: &AppHandle, want: Option<bool>) {
    let Some(window) = app.get_webview_window("main") else { return };
    let visible = window.is_visible().unwrap_or(false);
    if want.unwrap_or(!visible) {
        bring_on_screen(&window);
        let _ = window.show();
    } else {
        let _ = window.hide();
    }
}

/// A display's usable area (without the menu bar and the Dock), in logical points.
type Area = (f64, f64, f64, f64);

fn areas(window: &WebviewWindow) -> Vec<Area> {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let s = m.scale_factor();
            let wa = m.work_area();
            (
                f64::from(wa.position.x) / s,
                f64::from(wa.position.y) / s,
                f64::from(wa.size.width) / s,
                f64::from(wa.size.height) / s,
            )
        })
        .collect()
}

/// A rectangle in logical points: x, y, width, height.
type Rect = (f64, f64, f64, f64);

/// Where a w×h window at (x, y) should go so all of it shows. The display is the one `from` (where
/// the window is now) overlaps most, or the nearest to it; the window is pushed inside its usable area.
pub fn keep_on_screen(areas: &[Area], from: Rect, x: f64, y: f64, w: f64, h: f64) -> (f64, f64) {
    let (fx, fy, fw, fh) = from;
    let overlap = |&(ax, ay, aw, ah): &Area| {
        let ox = ((fx + fw).min(ax + aw) - fx.max(ax)).max(0.0);
        let oy = ((fy + fh).min(ay + ah) - fy.max(ay)).max(0.0);
        ox * oy
    };
    let (cx, cy) = (fx + fw / 2.0, fy + fh / 2.0);
    let gap = |&(ax, ay, aw, ah): &Area| {
        let dx = (ax - cx).max(0.0).max(cx - (ax + aw));
        let dy = (ay - cy).max(0.0).max(cy - (ay + ah));
        dx * dx + dy * dy
    };
    let best = areas
        .iter()
        .filter(|a| overlap(a) > 0.0)
        .max_by(|a, b| overlap(a).total_cmp(&overlap(b)))
        .or_else(|| areas.iter().min_by(|a, b| gap(a).total_cmp(&gap(b))));
    let Some(&(ax, ay, aw, ah)) = best else { return (x, y) };
    let fit = |v: f64, lo: f64, size: f64, room: f64| if size >= room { lo } else { v.clamp(lo, lo + room - size) };
    (fit(x, ax, w, aw), fit(y, ay, h, ah))
}

/// Places the bubble at the bottom-right of the primary display, above the Dock.
fn place_bottom_right(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.primary_monitor() else { return };
    let s = monitor.scale_factor();
    let wa = monitor.work_area();
    let x = f64::from(wa.position.x) / s + f64::from(wa.size.width) / s - BUBBLE.0 - MARGIN;
    let y = f64::from(wa.position.y) / s + f64::from(wa.size.height) / s - BUBBLE.1 - MARGIN;
    let _ = window.set_position(LogicalPosition::new(x, y));
}

/// Pulls the window back inside a display if any of it is off screen.
fn bring_on_screen(window: &WebviewWindow) {
    let Ok(scale) = window.scale_factor() else { return };
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else { return };
    let (pos, size) = (pos.to_logical::<f64>(scale), size.to_logical::<f64>(scale));
    let now = (pos.x, pos.y, size.width, size.height);
    let (x, y) = keep_on_screen(&areas(window), now, pos.x, pos.y, size.width, size.height);
    if (x - pos.x).abs() > 0.5 || (y - pos.y).abs() > 0.5 {
        let _ = window.set_position(LogicalPosition::new(x, y));
    }
}

/// Watches control.json, which the plugin's /hoochi command writes.
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
            bubble_menu,
            quit,
            codex_status,
            codex_connect,
            codex_disconnect,
            running_chats,
            existing_hooks,
            set_existing_hook,
            context_usage,
            check_update,
            apply_update,
            skill_state,
            set_skill,
            set_plugin
        ])
        .setup(|app| {
            // A menu-bar app: no Dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Updated by an old Hookwich window: take the folder and the plugin over, then open
            // again as ~/.hoochi/Hoochi.app.
            if let Ok(exe) = std::env::current_exe() {
                if let Ok(Some(moved)) = rename::move_in(&home(), &exe) {
                    let plugin = rename::switch_plugin(&home());
                    rename::note_renamed(&data_dir(), plugin);
                    let q = format!("'{}'", moved.to_string_lossy().replace('\'', "'\\''"));
                    let _ = std::process::Command::new("/bin/sh")
                        .args(["-c", &format!("sleep 1; /usr/bin/open {q}")])
                        .spawn();
                    std::process::exit(0);
                }
            }
            let _ = fs::create_dir_all(data_dir());
            // Codex hooks set up by an older copy (hookwich, or another place) run this one now;
            // only from an installed .app, so a dev build does not take them over.
            if let Ok(exe) = std::env::current_exe() {
                if update::bundle_of(&exe).is_some() {
                    let _ = codex::repoint(&exe);
                }
            }
            let config = data_dir().join("config.json");
            if !config.exists() {
                let _ = fs::write(&config, EMPTY_CONFIG);
            }

            let show_hide = MenuItemBuilder::with_id("toggle", "Show / Hide").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit Hoochi").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show_hide, &quit_item])
                .build()?;
            TrayIconBuilder::with_id("main")
                .icon(tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/tray.png"
                ))?)
                .icon_as_template(true)
                .tooltip("Hoochi")
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

            // The bubble's menu (any menu's events come here; the tray menu has its own ids).
            app.on_menu_event(|app, event| match event.id().as_ref() {
                "bubble-hide" => toggle(app, Some(false)),
                "bubble-quit" => app.exit(0),
                _ => {}
            });

            watch_control(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running hoochi");
}

#[cfg(test)]
mod tests {
    use super::{context_file, fold_to, keep_on_screen};

    // A 2560×1440 display with a 25-point menu bar and a Dock, and a portrait one to its right.
    const MAIN: (f64, f64, f64, f64) = (0.0, 25.0, 2560.0, 1335.0);
    const SIDE: (f64, f64, f64, f64) = (2560.0, 0.0, 1440.0, 2560.0);

    #[test]
    fn folding_a_panel_dragged_below_the_edge_keeps_the_bubble_on_screen() {
        // the case seen: the panel hung below the bottom edge, so its corner was off screen
        let panel = (2096.0, 1124.0, 440.0, 760.0);
        assert_eq!(keep_on_screen(&[MAIN, SIDE], panel, 2460.0, 1808.0, 76.0, 76.0), (2460.0, 1284.0));
    }

    #[test]
    fn a_window_inside_stays_put() {
        let panel = (2096.0, 590.0, 440.0, 760.0);
        assert_eq!(keep_on_screen(&[MAIN, SIDE], panel, 2096.0, 590.0, 440.0, 760.0), (2096.0, 590.0));
        let bubble = (3000.0, 2000.0, 76.0, 76.0);
        assert_eq!(keep_on_screen(&[MAIN, SIDE], bubble, 3000.0, 2000.0, 76.0, 76.0), (3000.0, 2000.0));
    }

    #[test]
    fn a_panel_opening_past_an_edge_is_pushed_inside() {
        let bubble = (2400.0, 1250.0, 76.0, 76.0);
        assert_eq!(keep_on_screen(&[MAIN], bubble, 2036.0, 566.0, 440.0, 760.0), (2036.0, 566.0));
        assert_eq!(keep_on_screen(&[MAIN], bubble, 2400.0, 1000.0, 440.0, 760.0), (2120.0, 600.0));
        assert_eq!(keep_on_screen(&[MAIN], (10.0, 30.0, 76.0, 76.0), -100.0, 10.0, 440.0, 760.0), (0.0, 25.0));
    }

    #[test]
    fn folding_puts_the_bubble_back_where_it_was() {
        // opened near the top-left: the panel was pushed down and right, yet the bubble returns
        assert_eq!(fold_to(&[MAIN], Some((40.0, 60.0)), (0.0, 25.0, 500.0, 760.0)), (40.0, 60.0));
        // the panel dragged across to the other display: the bubble still returns
        assert_eq!(fold_to(&[MAIN, SIDE], Some((2400.0, 1200.0)), (2800.0, 300.0, 500.0, 760.0)), (2400.0, 1200.0));
        // its display unplugged since: onto the nearest one
        assert_eq!(fold_to(&[MAIN], Some((3000.0, 400.0)), (2000.0, 300.0, 500.0, 760.0)), (2484.0, 400.0));
        // nothing remembered: the panel's bottom-right corner, as before
        assert_eq!(fold_to(&[MAIN], None, (2000.0, 300.0, 500.0, 760.0)), (2424.0, 984.0));
    }

    #[test]
    fn a_window_on_an_unplugged_display_moves_to_the_nearest() {
        let lost = (-900.0, 400.0, 76.0, 76.0);
        assert_eq!(keep_on_screen(&[MAIN], lost, -900.0, 400.0, 76.0, 76.0), (0.0, 400.0));
        assert_eq!(keep_on_screen(&[], lost, 5.0, 6.0, 76.0, 76.0), (5.0, 6.0));
    }

    #[test]
    fn context_file_matches_the_plugin() {
        // plugin: terminal.replace(/[^A-Za-z0-9._-]/g, '_') + '.json'
        assert_eq!(context_file("whitebox:terminal:t1"), "whitebox_terminal_t1.json");
        assert_eq!(context_file("iterm:w0t1p0:AB-12.x"), "iterm_w0t1p0_AB-12.x.json");
        assert_eq!(context_file("session:한/1"), "session___1.json");
    }
}
