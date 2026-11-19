//! Who put a hook there: the app it runs from (a path inside `Something.app`), or, for a hook that
//! calls an address on this computer (`http://127.0.0.1:23333/…`), the app that serves it — the one
//! listening on that port now, else an installed app whose files name that address. Answers are
//! remembered (in memory and in ~/.hookwich/origins.json), so the apps are searched once per address.

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use crate::codex::{data_dir, home, read_json};

/// `{ name, path }` of the app behind a hook, or None when nothing says.
pub fn origin(hook: &Value) -> Option<Value> {
    let body = ["command", "url"].iter().find_map(|k| hook.get(*k).and_then(Value::as_str))?;
    if let Some(app) = app_in(body) {
        return Some(found(&app));
    }
    let url = body.trim();
    let needle = match local_port(url) {
        Some(port) => {
            if let Some(app) = listening_app(port) {
                remember(url, Some(&app));
                return Some(found(&app));
            }
            url.to_string()
        }
        // A script in a folder named after what installed it (~/.codex/deskpet-hooks/…): an app whose
        // files name that folder put it there.
        None => script_folder(body)?,
    };
    let known = cache().lock().ok()?.get(&needle).cloned();
    let app = match known {
        Some(answer) => answer,
        None => {
            let answer = search_apps(&needle);
            remember(&needle, answer.as_deref());
            answer
        }
    };
    app.map(|a| found(&a))
}

/// `/bin/sh "/Users/me/.codex/deskpet-hooks/codex-hook.js.sh"` → `deskpet-hooks`: the folder of the script
/// a command runs, when its name says something (not `hooks`, `scripts`, `bin`, a plugin's cache).
pub fn script_folder(command: &str) -> Option<String> {
    let home = home().to_string_lossy().to_string();
    command
        .split_whitespace()
        .map(|w| w.trim_matches(|c| c == '"' || c == '\''))
        .map(|w| w.replacen("~/", &format!("{home}/"), 1).replace("$HOME", &home))
        .filter(|w| w.starts_with('/') && !w.contains("/.claude/plugins/") && !w.contains("/skills/"))
        .filter(|w| [".js", ".mjs", ".cjs", ".py", ".sh", ".ts", ".rb"].iter().any(|x| w.ends_with(x)))
        .find_map(|w| {
            let folder = Path::new(&w).parent()?.file_name()?.to_string_lossy().to_string();
            let generic = ["hooks", "scripts", "bin", "src", "dist", "lib", ".claude", ".codex"];
            (folder.len() >= 6 && !generic.contains(&folder.as_str())).then_some(folder)
        })
}

fn found(app: &Path) -> Value {
    let name = app.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let shown = app.to_string_lossy().replace(&home().to_string_lossy().to_string(), "~");
    json!({ "name": name, "path": shown })
}

/// `/Applications/Example.app/Contents/…/hook.js --x` → `/Applications/Example.app`. The path
/// starts at the last `/` before `.app` that begins a word (after a space, `=` or a quote), so a
/// name with spaces ("Desk Pet.app") stays whole.
pub fn app_in(text: &str) -> Option<PathBuf> {
    let end = text.find(".app/").or_else(|| text.ends_with(".app").then(|| text.len() - 4))?;
    let head = &text[..end];
    let begin = head
        .char_indices()
        .filter(|(i, c)| *c == '/' && (*i == 0 || head[..*i].ends_with([' ', '=', '"', '\''])))
        .map(|(i, _)| i)
        .last()?;
    Some(PathBuf::from(format!("{}.app", &head[begin..])))
}

/// `http://127.0.0.1:23333/permission` → 23333; only addresses on this computer.
pub fn local_port(url: &str) -> Option<u16> {
    let rest = url.split("://").nth(1)?;
    let host = rest.split('/').next()?;
    let (name, port) = host.rsplit_once(':')?;
    matches!(name, "127.0.0.1" | "localhost" | "[::1]" | "0.0.0.0").then(|| port.parse().ok())?
}

/// The app whose process is listening on `port` right now.
fn listening_app(port: u16) -> Option<PathBuf> {
    let out = Command::new("/usr/sbin/lsof")
        .args(["-nP", "-t", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])
        .output()
        .ok()?;
    let pid = String::from_utf8_lossy(&out.stdout).lines().next()?.trim().to_string();
    let exe = Command::new("/bin/ps").args(["-o", "comm=", "-p", &pid]).output().ok()?;
    app_in(String::from_utf8_lossy(&exe.stdout).trim())
}

/// An installed app whose own files name `needle`: Electron apps keep theirs in app.asar (and its
/// unpacked folder); others in Resources. Big binaries and frameworks are not read.
fn search_apps(needle: &str) -> Option<PathBuf> {
    let bytes = needle.as_bytes();
    for dir in [PathBuf::from("/Applications"), home().join("Applications")] {
        let Ok(apps) = std::fs::read_dir(&dir) else { continue };
        for app in apps.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "app")) {
            let res = app.join("Contents/Resources");
            if contains(&res.join("app.asar"), bytes, 400 << 20) || walk(&res.join("app.asar.unpacked"), bytes, 5) || walk_top(&res, bytes) {
                return Some(app);
            }
        }
    }
    None
}

fn contains(file: &Path, needle: &[u8], limit: u64) -> bool {
    let Ok(meta) = std::fs::metadata(file) else { return false };
    if !meta.is_file() || meta.len() > limit {
        return false;
    }
    std::fs::read(file).is_ok_and(|data| data.windows(needle.len()).any(|w| w == needle))
}

const TEXT: [&str; 7] = ["js", "mjs", "cjs", "json", "sh", "py", "ts"];

fn is_text(p: &Path) -> bool {
    p.extension().and_then(|x| x.to_str()).is_some_and(|x| TEXT.contains(&x))
}

fn walk(dir: &Path, needle: &[u8], depth: u8) -> bool {
    if depth == 0 {
        return false;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return false };
    entries.flatten().map(|e| e.path()).any(|p| {
        if p.is_dir() {
            p.file_name().is_some_and(|n| n != "node_modules") && walk(&p, needle, depth - 1)
        } else {
            is_text(&p) && contains(&p, needle, 2 << 20)
        }
    })
}

fn walk_top(dir: &Path, needle: &[u8]) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else { return false };
    entries.flatten().map(|e| e.path()).any(|p| p.is_file() && is_text(&p) && contains(&p, needle, 2 << 20))
}

fn cache_file() -> PathBuf {
    data_dir().join("origins.json")
}

fn cache() -> &'static Mutex<HashMap<String, Option<PathBuf>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<PathBuf>>>> = OnceLock::new();
    CACHE.get_or_init(|| {
        let saved = read_json(&cache_file());
        let map = saved
            .as_object()
            .map(|m| {
                m.iter()
                    .map(|(k, v)| (k.clone(), v.as_str().filter(|s| !s.is_empty()).map(PathBuf::from)))
                    .collect()
            })
            .unwrap_or_default();
        Mutex::new(map)
    })
}

fn remember(url: &str, app: Option<&Path>) {
    let Ok(mut map) = cache().lock() else { return };
    map.insert(url.to_string(), app.map(Path::to_path_buf));
    let out: Map<String, Value> = map
        .iter()
        .map(|(k, v)| (k.clone(), json!(v.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_default())))
        .collect();
    let _ = std::fs::write(cache_file(), serde_json::to_string_pretty(&Value::Object(out)).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_app_a_command_runs_from() {
        let cmd = "ELECTRON_RUN_AS_NODE=1 '/Applications/Example.app/Contents/MacOS/Example' '/Applications/Example.app/Contents/Resources/x/hook.js' --guard";
        assert_eq!(app_in(cmd), Some(PathBuf::from("/Applications/Example.app")));
        assert_eq!(
            app_in("node \"/Applications/Desk Pet.app/Contents/Resources/hooks/install.js\""),
            Some(PathBuf::from("/Applications/Desk Pet.app"))
        );
        assert_eq!(app_in("npx some-tool --hook"), None);
    }

    #[test]
    fn names_the_folder_a_script_sits_in() {
        assert_eq!(script_folder("/bin/sh \"/Users/me/.codex/deskpet-hooks/codex-hook.js.sh\"").as_deref(), Some("deskpet-hooks"));
        assert_eq!(script_folder("node /Users/me/.claude/hooks/x.js"), None, "a generic folder says nothing");
        assert_eq!(script_folder("python3 ${CLAUDE_PLUGIN_ROOT}/skills/sync/run.py"), None);
        assert_eq!(script_folder("npx some-tool"), None);
    }

    #[test]
    fn reads_a_local_port() {
        assert_eq!(local_port("http://127.0.0.1:23333/permission"), Some(23333));
        assert_eq!(local_port("http://localhost:8080"), Some(8080));
        assert_eq!(local_port("https://example.com:443/x"), None);
        assert_eq!(local_port("node hook.js"), None);
    }
}

#[cfg(test)]
mod live {
    /// `cargo test live_origins -- --ignored --nocapture`: where this computer's hooks come from.
    #[test]
    #[ignore]
    fn live_origins() {
        let start = std::time::Instant::now();
        let all = crate::existing::existing("");
        for h in all["claude"].as_array().unwrap().iter().chain(all["codex"].as_array().unwrap()) {
            println!("{} | {} | file={} | origin={}", h["event"], h["name"], h["file"], h["origin"]);
        }
        println!("took {:?}", start.elapsed());
    }
}
