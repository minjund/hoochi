//! Hooks that are already set up outside hookwich: in Claude Code's settings, in installed plugins
//! (often a skill run by a hook) and in Codex's hooks.json. The window shows them read-only, so you
//! can see everything that runs at a moment before adding to it.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::codex::{home, is_ours, read_json};

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

/// Every hook in one `{ "hooks": { Event: [{ matcher?, hooks: [...] }] } }` block.
fn collect(hooks: &Value, source: &str, from: &str, scope: &str, skip_ours: bool, out: &mut Vec<Value>) {
    let Some(events) = hooks.as_object() else { return };
    for (event, groups) in events {
        for group in groups.as_array().into_iter().flatten() {
            if skip_ours && is_ours(group) {
                continue;
            }
            let matcher = group.get("matcher").and_then(Value::as_str).unwrap_or_default();
            for hook in group.get("hooks").and_then(Value::as_array).into_iter().flatten() {
                let kind = hook.get("type").and_then(Value::as_str).unwrap_or("command");
                let body = ["command", "url", "prompt", "tool", "server"]
                    .iter()
                    .find_map(|k| hook.get(*k).and_then(Value::as_str))
                    .unwrap_or_default();
                let name = match kind {
                    "prompt" | "agent" => kind.to_string(),
                    _ if !source.is_empty() && !body.contains("/skills/") => source.to_string(),
                    _ => who(body),
                };
                out.push(json!({
                    "event": event,
                    "matcher": matcher,
                    "kind": kind,
                    "name": name,
                    "detail": short(body),
                    "from": from,
                    "scope": scope,
                }));
            }
        }
    }
}

fn settings_hooks(path: &Path, from: &str, scope: &str, out: &mut Vec<Value>) {
    let v = read_json(path);
    if let Some(h) = v.get("hooks") {
        collect(h, "", from, scope, false, out);
    }
}

/// Plugins switched on in Claude Code's user settings, with their hooks.
fn plugin_hooks(out: &mut Vec<Value>) {
    let claude = home().join(".claude");
    let settings = read_json(&claude.join("settings.json"));
    let installed = read_json(&claude.join("plugins/installed_plugins.json"));
    let Some(enabled) = settings.get("enabledPlugins").and_then(Value::as_object) else { return };
    for (key, on) in enabled {
        if on.as_bool() != Some(true) {
            continue;
        }
        let name = key.split('@').next().unwrap_or(key);
        if name == "hookwich" {
            continue;
        }
        let entry = installed.pointer(&format!("/plugins/{}", key.replace('~', "~0").replace('/', "~1")));
        let entry = entry.and_then(|e| e.as_array().and_then(|a| a.first()).or(Some(e)));
        let Some(root) = entry.and_then(|e| e.get("installPath")).and_then(Value::as_str) else { continue };
        let root = PathBuf::from(root);
        let manifest = read_json(&root.join(".claude-plugin/plugin.json"));
        let blocks = match manifest.get("hooks") {
            Some(Value::String(rel)) => vec![read_json(&root.join(rel))],
            Some(Value::Object(_)) => vec![json!({ "hooks": manifest["hooks"].clone() })],
            Some(Value::Array(list)) => list
                .iter()
                .filter_map(Value::as_str)
                .map(|rel| read_json(&root.join(rel)))
                .collect(),
            _ => vec![read_json(&root.join("hooks/hooks.json"))],
        };
        for block in blocks {
            if let Some(h) = block.get("hooks") {
                collect(h, name, &format!("plugin:{name}"), "global", false, out);
            }
        }
    }
}

/// `{ claude: [...], codex: [...] }` for a project folder ("" for none).
pub fn existing(project: &str) -> Value {
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

    let mut codex = Vec::new();
    if let Some(h) = read_json(&home().join(".codex/hooks.json")).get("hooks") {
        collect(h, "", "settings", "global", true, &mut codex);
    }

    if !project.is_empty() && Path::new(project).join(".git").exists() && Path::new(project) != home() {
        let p = Path::new(project);
        settings_hooks(&p.join(".claude/settings.json"), "project", "project", &mut claude);
        settings_hooks(&p.join(".claude/settings.local.json"), "project", "project", &mut claude);
        if let Some(h) = read_json(&p.join(".codex/hooks.json")).get("hooks") {
            collect(h, "", "project", "project", true, &mut codex);
        }
    }
    json!({ "claude": claude, "codex": codex })
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
        collect(&hooks, "memory", "plugin:memory", "global", false, &mut out);
        let names: Vec<(&str, &str)> =
            out.iter().map(|h| (h["event"].as_str().unwrap(), h["name"].as_str().unwrap())).collect();
        assert!(names.contains(&("Stop", "memory")));
        assert!(names.contains(&("SessionStart", "skill: sync")));
        assert_eq!(out.iter().find(|h| h["event"] == "SessionStart").unwrap()["matcher"], "startup");
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
