//! Hooks that are already set up outside hookwich: in Claude Code's settings, in installed plugins
//! (often a skill run by a hook) and in Codex's hooks.json. The window shows them read-only, so you
//! can see everything that runs at a moment before adding to it.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::codex::{data_dir, home, is_ours, read_json};

/// A short name for who runs a hook: an app, a skill, a script or a local server.
pub fn who(command: &str) -> String {
    let c = command.replace('"', "").replace('\'', "");
    if let Some(rest) = c.split("://").nth(1) {
        // http://127.0.0.1:53575/termapp/… → "termapp", http://127.0.0.1:23333/permission → "127.0.0.1:23333"
        let mut parts = rest.split('/');
        let host = parts.next().unwrap_or_default();
        return match parts.next() {
            Some(first) if !first.is_empty() && parts.next().is_some() => first.to_string(),
            _ => host.to_string(),
        };
    }
    if let Some(i) = c.find(".app/") {
        let name = c[..i].rsplit('/').next().unwrap_or_default();
        if !name.is_empty() {
            return name.to_string();
        }
    }
    if let Some(i) = c.find("/skills/") {
        let skill = c[i + 8..].split('/').next().unwrap_or_default();
        if !skill.is_empty() {
            return format!("skill: {skill}");
        }
    }
    if let Some(i) = c.find("Application Support/") {
        let name = c[i + 20..].split('/').next().unwrap_or_default();
        if !name.is_empty() {
            return name.to_string();
        }
    }
    // The script it runs, else the program.
    let words: Vec<&str> = c.split_whitespace().filter(|w| !w.contains('=')).collect();
    let script = words
        .iter()
        .find(|w| [".js", ".mjs", ".cjs", ".py", ".sh", ".ts", ".rb"].iter().any(|ext| w.ends_with(ext)));
    let pick = script.or(words.first()).copied().unwrap_or_default();
    let file = pick.rsplit('/').next().unwrap_or(pick);
    // ~/.codex/pet-hooks/codex-hook.js.sh → "pet-hooks"; a generic file name says less than its folder.
    let parent = pick.rsplit('/').nth(1).unwrap_or_default();
    if (file.starts_with("hook") || file.contains("-hook") || file.starts_with("cli") || file.starts_with("index"))
        && !parent.is_empty()
        && !parent.starts_with('$')
        && parent != "hooks"
        && parent != "scripts"
    {
        return parent.to_string();
    }
    file.to_string()
}

fn short(text: &str) -> String {
    let home = home().to_string_lossy().to_string();
    let one = text.replace(&home, "~").split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() > 90 {
        one.chars().take(89).collect::<String>() + "…"
    } else {
        one
    }
}

/// Where an existing hook lives, so it can be switched off and back on.
#[derive(Clone)]
enum Place {
    /// In a Claude Code settings file: switched off by moving it to ~/.hookwich/parked.json.
    Settings { file: PathBuf, event: String, group: usize, hook: usize },
    /// In a Claude Code plugin: only the whole plugin can be switched (enabledPlugins).
    Plugin { key: String },
    /// In a Codex hooks.json: switched in place with `enabled` in ~/.codex/config.toml, as /hooks does.
    Codex { state_key: String },
}

struct Found {
    info: Value,
    place: Place,
}

fn id_of(parts: &[&str]) -> String {
    // FNV-1a: a stable short id for one hook at one place
    let mut h: u64 = 0xcbf29ce484222325;
    for b in parts.join("\u{1f}").bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// `PreToolUse` → `pre_tool_use`, the way Codex names events in its hook state keys.
pub fn snake(event: &str) -> String {
    let mut out = String::new();
    for (i, c) in event.chars().enumerate() {
        if c.is_ascii_uppercase() {
            if i > 0 {
                out.push('_');
            }
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

fn describe(hook: &Value, event: &str, matcher: &str, source: &str) -> (String, String, String) {
    let kind = hook.get("type").and_then(Value::as_str).unwrap_or("command").to_string();
    let body = ["command", "url", "prompt", "tool", "server"]
        .iter()
        .find_map(|k| hook.get(*k).and_then(Value::as_str))
        .unwrap_or_default();
    let name = match kind.as_str() {
        "prompt" | "agent" => kind.clone(),
        _ if !source.is_empty() && !body.contains("/skills/") => source.to_string(),
        _ => who(body),
    };
    let _ = (event, matcher);
    (kind, name, short(body))
}

/// Every hook in one `{ Event: [{ matcher?, hooks: [...] }] }` block, with where each one lives.
fn collect(
    hooks: &Value,
    source: &str,
    from: &str,
    scope: &str,
    place: &dyn Fn(&str, usize, usize) -> Option<Place>,
    off: &dyn Fn(&Place) -> bool,
    skip_ours: bool,
    out: &mut Vec<Found>,
) {
    let Some(events) = hooks.as_object() else { return };
    for (event, groups) in events {
        for (g, group) in groups.as_array().into_iter().flatten().enumerate() {
            if skip_ours && is_ours(group) {
                continue;
            }
            let matcher = group.get("matcher").and_then(Value::as_str).unwrap_or_default();
            for (h, hook) in group.get("hooks").and_then(Value::as_array).into_iter().flatten().enumerate() {
                let Some(at) = place(event, g, h) else { continue };
                let (kind, name, detail) = describe(hook, event, matcher, source);
                let key = match &at {
                    Place::Settings { file, .. } => file.to_string_lossy().to_string(),
                    Place::Plugin { key } => key.clone(),
                    Place::Codex { state_key } => state_key.clone(),
                };
                let id = id_of(&[from, &key, event, matcher, &hook.to_string()]);
                let toggle = match &at {
                    Place::Settings { .. } => "park",
                    Place::Plugin { .. } => "plugin",
                    Place::Codex { .. } => "codex",
                };
                let plugin = match &at {
                    Place::Plugin { key } => key.clone(),
                    _ => String::new(),
                };
                out.push(Found {
                    info: json!({
                        "id": id, "event": event, "matcher": matcher, "kind": kind, "name": name,
                        "detail": detail, "from": from, "scope": scope, "off": off(&at),
                        "toggle": toggle, "plugin": plugin,
                    }),
                    place: at,
                });
            }
        }
    }
}

fn settings_hooks(path: &Path, from: &str, scope: &str, out: &mut Vec<Found>) {
    let v = read_json(path);
    if let Some(h) = v.get("hooks") {
        let file = path.to_path_buf();
        let place = move |event: &str, group: usize, hook: usize| {
            Some(Place::Settings { file: file.clone(), event: event.to_string(), group, hook })
        };
        collect(h, "", from, scope, &place, &|_| false, false, out);
    }
}

/// Plugins in Claude Code's user settings (on or off), with their hooks.
fn plugin_hooks(out: &mut Vec<Found>) {
    let claude = home().join(".claude");
    let settings = read_json(&claude.join("settings.json"));
    let installed = read_json(&claude.join("plugins/installed_plugins.json"));
    let Some(listed) = settings.get("enabledPlugins").and_then(Value::as_object) else { return };
    for (key, on) in listed {
        let name = key.split('@').next().unwrap_or(key);
        if name == "hookwich" {
            continue;
        }
        let on = on.as_bool() == Some(true);
        let entry = installed.pointer(&format!("/plugins/{}", key.replace('~', "~0").replace('/', "~1")));
        let entry = entry.and_then(|e| e.as_array().and_then(|a| a.first()).or(Some(e)));
        let Some(root) = entry.and_then(|e| e.get("installPath")).and_then(Value::as_str) else { continue };
        let root = PathBuf::from(root);
        let manifest = read_json(&root.join(".claude-plugin/plugin.json"));
        let blocks = match manifest.get("hooks") {
            Some(Value::String(rel)) => vec![read_json(&root.join(rel))],
            Some(Value::Object(_)) => vec![json!({ "hooks": manifest["hooks"].clone() })],
            Some(Value::Array(list)) => {
                list.iter().filter_map(Value::as_str).map(|rel| read_json(&root.join(rel))).collect()
            }
            _ => vec![read_json(&root.join("hooks/hooks.json"))],
        };
        let key = key.clone();
        for block in blocks {
            if let Some(h) = block.get("hooks") {
                let k = key.clone();
                let place = move |_: &str, _: usize, _: usize| Some(Place::Plugin { key: k.clone() });
                collect(h, name, &format!("plugin:{name}"), "global", &place, &|_| !on, false, out);
            }
        }
    }
}

fn codex_config() -> PathBuf {
    home().join(".codex/config.toml")
}

/// Which Codex hooks are switched off, by state key.
fn codex_off() -> std::collections::HashSet<String> {
    let mut off = std::collections::HashSet::new();
    let text = std::fs::read_to_string(codex_config()).unwrap_or_default();
    if let Ok(doc) = text.parse::<toml_edit::DocumentMut>() {
        if let Some(state) = doc.get("hooks").and_then(|h| h.get("state")).and_then(|s| s.as_table_like()) {
            for (key, item) in state.iter() {
                if item.get("enabled").and_then(|e| e.as_bool()) == Some(false) {
                    off.insert(key.to_string());
                }
            }
        }
    }
    off
}

fn codex_hooks(path: &Path, from: &str, scope: &str, off: &std::collections::HashSet<String>, out: &mut Vec<Found>) {
    if let Some(h) = read_json(path).get("hooks") {
        let file = path.to_string_lossy().to_string();
        let place = move |event: &str, group: usize, hook: usize| {
            Some(Place::Codex { state_key: format!("{file}:{}:{group}:{hook}", snake(event)) })
        };
        let is_off = |p: &Place| matches!(p, Place::Codex { state_key } if off.contains(state_key));
        collect(h, "", from, scope, &place, &is_off, true, out);
    }
}

fn is_project(project: &str) -> bool {
    !project.is_empty() && Path::new(project).join(".git").exists() && Path::new(project) != home()
}

fn scan(project: &str) -> (Vec<Found>, Vec<Found>) {
    let mut claude = Vec::new();
    let user = home().join(".claude");
    settings_hooks(&user.join("settings.json"), "settings", "global", &mut claude);
    settings_hooks(&user.join("settings.local.json"), "settings", "global", &mut claude);
    settings_hooks(
        Path::new("/Library/Application Support/ClaudeCode/managed-settings.json"),
        "managed",
        "global",
        &mut claude,
    );
    plugin_hooks(&mut claude);

    let off = codex_off();
    let mut codex = Vec::new();
    codex_hooks(&home().join(".codex/hooks.json"), "settings", "global", &off, &mut codex);

    if is_project(project) {
        let p = Path::new(project);
        settings_hooks(&p.join(".claude/settings.json"), "project", "project", &mut claude);
        settings_hooks(&p.join(".claude/settings.local.json"), "project", "project", &mut claude);
        codex_hooks(&p.join(".codex/hooks.json"), "project", "project", &off, &mut codex);
    }
    (claude, codex)
}

fn parked_path() -> PathBuf {
    data_dir().join("parked.json")
}

fn parked() -> Vec<Value> {
    read_json(&parked_path()).as_array().cloned().unwrap_or_default()
}

/// `{ claude: [...], codex: [...] }` for a project folder ("" for none): on and switched-off hooks.
pub fn existing(project: &str) -> Value {
    let (claude, codex) = scan(project);
    let mut claude: Vec<Value> = claude.into_iter().map(|f| f.info).collect();
    let user = home().join(".claude").to_string_lossy().to_string();
    for p in parked() {
        let file = p.get("file").and_then(Value::as_str).unwrap_or_default();
        let here = file.starts_with(&user) || (is_project(project) && file.starts_with(&format!("{project}/.claude/")));
        if here {
            let mut info = p.get("info").cloned().unwrap_or(Value::Null);
            info["off"] = json!(true);
            claude.push(info);
        }
    }
    json!({ "claude": claude, "codex": codex.into_iter().map(|f| f.info).collect::<Vec<_>>() })
}

/// Copies a file into ~/.hookwich/backups/ before hookwich changes it.
fn backup(file: &Path) -> Result<(), String> {
    if !file.exists() {
        return Ok(());
    }
    let dir = data_dir().join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let name = file.to_string_lossy().trim_start_matches('/').replace('/', "_");
    std::fs::copy(file, dir.join(format!("{name}.{secs}"))).map(|_| ()).map_err(|e| e.to_string())
}

fn write_text(file: &Path, text: &str) -> Result<(), String> {
    let tmp = file.with_extension("hookwich-tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())
}

fn edit_json(file: &Path, change: impl FnOnce(&mut Value) -> Result<(), String>) -> Result<(), String> {
    let mut v = read_json(file);
    if !v.is_object() {
        return Err(format!("{} is not a settings file hookwich can read", file.display()));
    }
    change(&mut v)?;
    backup(file)?;
    write_text(file, &(serde_json::to_string_pretty(&v).map_err(|e| e.to_string())? + "\n"))
}

/// Switches one existing hook off (`on = false`) or back on.
pub fn set_on(project: &str, id: &str, on: bool) -> Result<(), String> {
    // Switching back on a hook hookwich moved out of a Claude settings file.
    if on {
        let mut list = parked();
        if let Some(i) = list.iter().position(|p| p["info"]["id"] == id) {
            let p = list.remove(i);
            let file = PathBuf::from(p["file"].as_str().unwrap_or_default());
            let event = p["info"]["event"].as_str().unwrap_or_default().to_string();
            let matcher = p["info"]["matcher"].as_str().unwrap_or_default().to_string();
            let hook = p["hook"].clone();
            edit_json(&file, |v| {
                if !v["hooks"].is_object() {
                    v["hooks"] = json!({});
                }
                if !v["hooks"][&event].is_array() {
                    v["hooks"][&event] = json!([]);
                }
                let groups = v["hooks"][&event].as_array_mut().expect("array");
                let same = groups
                    .iter_mut()
                    .find(|g| g.get("matcher").and_then(Value::as_str).unwrap_or_default() == matcher);
                match same {
                    Some(g) => {
                        if !g["hooks"].is_array() {
                            g["hooks"] = json!([]);
                        }
                        g["hooks"].as_array_mut().expect("array").push(hook);
                    }
                    None => {
                        let mut g = json!({ "hooks": [hook] });
                        if !matcher.is_empty() {
                            g["matcher"] = json!(matcher);
                        }
                        groups.push(g);
                    }
                }
                Ok(())
            })?;
            return crate::codex::write_json(&parked_path(), &Value::Array(list)).map_err(|e| e.to_string());
        }
    }

    let (claude, codex) = scan(project);
    let found = claude.into_iter().chain(codex).find(|f| f.info["id"] == id).ok_or("That hook is no longer there.")?;
    match found.place {
        Place::Settings { file, event, group, hook } => {
            if on {
                return Ok(());
            }
            let mut taken = Value::Null;
            edit_json(&file, |v| {
                let groups = v["hooks"][&event].as_array_mut().ok_or("hook moved")?;
                let hooks = groups.get_mut(group).and_then(|g| g["hooks"].as_array_mut()).ok_or("hook moved")?;
                if hook >= hooks.len() {
                    return Err("hook moved".into());
                }
                taken = hooks.remove(hook);
                if hooks.is_empty() {
                    groups.remove(group);
                }
                if groups.is_empty() {
                    v["hooks"].as_object_mut().map(|o| o.remove(&event));
                }
                Ok(())
            })?;
            let mut list = parked();
            list.push(json!({ "file": file.to_string_lossy(), "hook": taken, "info": found.info }));
            crate::codex::write_json(&parked_path(), &Value::Array(list)).map_err(|e| e.to_string())
        }
        Place::Plugin { key } => {
            let file = home().join(".claude/settings.json");
            edit_json(&file, |v| {
                v["enabledPlugins"][&key] = json!(on);
                Ok(())
            })
        }
        Place::Codex { state_key } => {
            let file = codex_config();
            let text = std::fs::read_to_string(&file).unwrap_or_default();
            let mut doc = text.parse::<toml_edit::DocumentMut>().map_err(|e| e.to_string())?;
            if on {
                if let Some(t) = doc
                    .get_mut("hooks")
                    .and_then(|h| h.get_mut("state"))
                    .and_then(|s| s.get_mut(&state_key))
                    .and_then(|t| t.as_table_like_mut())
                {
                    t.remove("enabled");
                }
            } else {
                // Standard tables, as Codex writes them: [hooks.state."<key>"] enabled = false
                let table = |implicit: bool| {
                    let mut t = toml_edit::Table::new();
                    t.set_implicit(implicit);
                    toml_edit::Item::Table(t)
                };
                let root = doc.as_table_mut();
                if !root.contains_key("hooks") {
                    root.insert("hooks", table(true));
                }
                let hooks = root["hooks"].as_table_mut().ok_or("hooks in config.toml is not a table")?;
                if !hooks.contains_key("state") {
                    hooks.insert("state", table(true));
                }
                let state = hooks["state"].as_table_mut().ok_or("hooks.state in config.toml is not a table")?;
                if !state.contains_key(&state_key) {
                    state.insert(&state_key, table(false));
                }
                state[state_key.as_str()]["enabled"] = toml_edit::value(false);
            }
            backup(&file)?;
            write_text(&file, &doc.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_who_runs_a_hook() {
        assert_eq!(who("http://127.0.0.1:53575/termapp/attention/v1/abc"), "termapp");
        assert_eq!(who("http://127.0.0.1:23333/permission"), "127.0.0.1:23333");
        assert_eq!(
            who("\"/usr/local/bin/node\" \"/Applications/Desk Pet.app/Contents/Resources/hooks/pet-hook.js\""),
            "Desk Pet"
        );
        assert_eq!(who("python3 -I \"${CLAUDE_PLUGIN_ROOT}/skills/helper/scripts/helper.py\" auto"), "skill: helper");
        assert_eq!(who("\"/bin/sh\" \"/Users/me/.codex/pet-hooks/codex-hook.js.sh\""), "pet-hooks");
        assert_eq!(
            who("\"/usr/local/bin/node\" \"/Users/me/Library/Application Support/ChatBridge/runtime/cli.mjs\" hook"),
            "ChatBridge"
        );
        assert_eq!(who("npm test"), "npm");
    }

    #[test]
    fn plugin_hooks_carry_the_plugin_or_skill_name() {
        let mut out = Vec::new();
        let hooks = json!({
            "Stop": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs\" hook claude" }] }],
            "SessionStart": [{ "matcher": "startup", "hooks": [{ "type": "command", "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/skills/sync/scripts/auto.py\" ensure" }] }]
        });
        let place = |_: &str, _: usize, _: usize| Some(Place::Plugin { key: "memory@market".into() });
        collect(&hooks, "memory", "plugin:memory", "global", &place, &|_| false, false, &mut out);
        let names: Vec<(&str, &str)> =
            out.iter().map(|h| (h.info["event"].as_str().unwrap(), h.info["name"].as_str().unwrap())).collect();
        assert!(names.contains(&("Stop", "memory")));
        assert!(names.contains(&("SessionStart", "skill: sync")));
        let start = out.iter().find(|h| h.info["event"] == "SessionStart").unwrap();
        assert_eq!(start.info["matcher"], "startup");
        assert_eq!(start.info["toggle"], "plugin");
    }

    #[test]
    fn codex_state_keys_follow_codex() {
        assert_eq!(snake("PreToolUse"), "pre_tool_use");
        assert_eq!(snake("Stop"), "stop");
        let mut out = Vec::new();
        let off: std::collections::HashSet<String> = ["/h.json:stop:1:0".to_string()].into();
        let hooks = json!({ "Stop": [
            { "hooks": [{ "type": "command", "command": "a" }] },
            { "hooks": [{ "type": "command", "command": "b" }] },
            { "hooks": [{ "type": "command", "command": "'/x/hookwich' hook codex Stop" }] }
        ]});
        let place = |e: &str, g: usize, h: usize| Some(Place::Codex { state_key: format!("/h.json:{}:{g}:{h}", snake(e)) });
        let is_off = |p: &Place| matches!(p, Place::Codex { state_key } if off.contains(state_key));
        collect(&hooks, "", "settings", "global", &place, &is_off, true, &mut out);
        let seen: Vec<(String, bool)> = out
            .iter()
            .map(|f| match &f.place { Place::Codex { state_key } => (state_key.clone(), f.info["off"].as_bool().unwrap()), _ => unreachable!() })
            .collect();
        assert_eq!(seen, vec![("/h.json:stop:0:0".into(), false), ("/h.json:stop:1:0".into(), true)], "hookwich's own group is left out");
    }
}

#[cfg(test)]
mod live {
    /// `cargo test live_existing -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_existing() {
        let all = super::existing(&std::env::var("PROJECT").unwrap_or_default());
        for agent in ["claude", "codex"] {
            for h in all[agent].as_array().unwrap() {
                println!("{agent} {} [{}] {} ← {}", h["event"], h["scope"], h["name"], h["from"]);
            }
        }
    }
}

#[cfg(test)]
mod round_trip {
    use super::*;

    /// Off and back on for each kind, in a temporary HOME:
    /// `cargo test round_trip -- --ignored --test-threads=1`
    #[test]
    #[ignore]
    fn off_and_back_on_in_a_temp_home() {
        let home = std::env::temp_dir().join(format!("hookwich-rt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(home.join(".claude/plugins/cache/p")).unwrap();
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::create_dir_all(home.join(".hookwich")).unwrap();
        std::env::set_var("HOME", &home);
        let settings = json!({
            "model": "x",
            "hooks": { "Stop": [
                { "hooks": [{ "type": "command", "command": "/opt/keep.sh" }, { "type": "command", "command": "/opt/park-me.sh" }] }
            ]},
            "enabledPlugins": { "memo@m": true }
        });
        std::fs::write(home.join(".claude/settings.json"), serde_json::to_string_pretty(&settings).unwrap()).unwrap();
        std::fs::write(
            home.join(".claude/plugins/installed_plugins.json"),
            json!({ "version": 2, "plugins": { "memo@m": [{ "installPath": home.join(".claude/plugins/cache/p").to_string_lossy() }] } }).to_string(),
        )
        .unwrap();
        std::fs::create_dir_all(home.join(".claude/plugins/cache/p/hooks")).unwrap();
        std::fs::write(
            home.join(".claude/plugins/cache/p/hooks/hooks.json"),
            json!({ "hooks": { "SessionStart": [{ "hooks": [{ "type": "command", "command": "memo start" }] }] } }).to_string(),
        )
        .unwrap();
        std::fs::write(
            home.join(".codex/hooks.json"),
            json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "/opt/codex-stop.sh" }] }] } }).to_string(),
        )
        .unwrap();
        let key = format!("{}:stop:0:0", home.join(".codex/hooks.json").to_string_lossy());
        let toml = format!(
            "# my codex settings\nmodel = \"gpt\"\n\n[features]\nhooks = true\n\n[hooks.state]\n\n[hooks.state.\"{key}\"]\ntrusted_hash = \"sha256:abc\"\n\n[other]\nx = 1\n"
        );
        std::fs::write(home.join(".codex/config.toml"), toml).unwrap();

        let list = existing("");
        let find = |list: &Value, agent: &str, needle: &str| -> Value {
            list[agent].as_array().unwrap().iter().find(|h| h["detail"].as_str().unwrap().contains(needle)).cloned().unwrap()
        };
        // Claude settings: out to parked.json and back, the other hook untouched.
        let park = find(&list, "claude", "park-me");
        set_on("", park["id"].as_str().unwrap(), false).unwrap();
        let s: Value = read_json(&home.join(".claude/settings.json"));
        assert_eq!(s["hooks"]["Stop"][0]["hooks"].as_array().unwrap().len(), 1);
        assert_eq!(s["model"], "x");
        assert_eq!(find(&existing(""), "claude", "park-me")["off"], true);
        set_on("", park["id"].as_str().unwrap(), true).unwrap();
        let s: Value = read_json(&home.join(".claude/settings.json"));
        assert_eq!(s["hooks"]["Stop"][0]["hooks"][1]["command"], "/opt/park-me.sh");
        assert_eq!(find(&existing(""), "claude", "park-me")["off"], false);

        // Plugin: the whole plugin, through enabledPlugins.
        let memo = find(&list, "claude", "memo start");
        set_on("", memo["id"].as_str().unwrap(), false).unwrap();
        assert_eq!(read_json(&home.join(".claude/settings.json"))["enabledPlugins"]["memo@m"], false);
        assert_eq!(find(&existing(""), "claude", "memo start")["off"], true);
        set_on("", memo["id"].as_str().unwrap(), true).unwrap();
        assert_eq!(read_json(&home.join(".claude/settings.json"))["enabledPlugins"]["memo@m"], true);

        // Codex: in place, `enabled = false` in config.toml, comments kept.
        let stop = find(&list, "codex", "codex-stop");
        set_on("", stop["id"].as_str().unwrap(), false).unwrap();
        let text = std::fs::read_to_string(home.join(".codex/config.toml")).unwrap();
        println!("--- config.toml after off ---\n{text}");
        assert!(text.starts_with("# my codex settings"));
        assert!(text.contains(&format!("[hooks.state.\"{key}\"]\ntrusted_hash = \"sha256:abc\"\nenabled = false")));
        assert!(text.contains("[other]\nx = 1"));
        assert_eq!(find(&existing(""), "codex", "codex-stop")["off"], true);
        set_on("", stop["id"].as_str().unwrap(), true).unwrap();
        let back = std::fs::read_to_string(home.join(".codex/config.toml")).unwrap();
        assert!(!back.contains("enabled = false") && back.contains("trusted_hash = \"sha256:abc\""), "trust is kept");
        assert_eq!(read_json(&home.join(".codex/hooks.json"))["hooks"]["Stop"][0]["hooks"][0]["command"], "/opt/codex-stop.sh");
        assert!(std::fs::read_dir(home.join(".hookwich/backups")).unwrap().count() >= 4, "a backup before each change");
        let _ = std::fs::remove_dir_all(&home);
    }
}
