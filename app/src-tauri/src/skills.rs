//! Switching skills off and back on, the ways Claude Code supports:
//! one skill of your own (or a built-in one) with `skillOverrides` in ~/.claude/settings.json
//! (`"off"` hides it from Claude and the `/` menu), and a plugin's skills only with the whole plugin
//! (`enabledPlugins`). Skills synced from claude.ai are switched on claude.ai.

use serde_json::{json, Map, Value};
use std::path::PathBuf;

use crate::codex::{home, read_json};
use crate::existing::edit_json;

fn settings() -> PathBuf {
    home().join(".claude/settings.json")
}

/// Skills switched off by `skillOverrides`, and every plugin with whether it is on.
pub fn state() -> Value {
    let s = read_json(&settings());
    let off: Vec<Value> = s
        .get("skillOverrides")
        .and_then(Value::as_object)
        .map(|m| m.iter().filter(|(_, v)| v.as_str() == Some("off")).map(|(k, _)| json!(k)).collect())
        .unwrap_or_default();
    let plugins: Vec<Value> = s
        .get("enabledPlugins")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .map(|(key, on)| {
                    let name = key.split('@').next().unwrap_or(key);
                    json!({ "name": name, "key": key, "on": on.as_bool() == Some(true) })
                })
                .collect()
        })
        .unwrap_or_default();
    json!({ "off": off, "plugins": plugins })
}

/// Turns one skill off (`"off"` in skillOverrides) or back on (its entry removed).
pub fn set_skill(name: &str, on: bool) -> Result<(), String> {
    if name.is_empty() || name.contains(':') {
        return Err("a plugin's skill is switched with its whole plugin".into());
    }
    let file = settings();
    if !file.exists() {
        std::fs::create_dir_all(file.parent().ok_or("no folder")?).map_err(|e| e.to_string())?;
        std::fs::write(&file, "{}\n").map_err(|e| e.to_string())?;
    }
    edit_json(&file, |v| {
        let o = v.as_object_mut().ok_or("settings is not an object")?;
        let map = o.entry("skillOverrides").or_insert_with(|| Value::Object(Map::new()));
        let m = map.as_object_mut().ok_or("skillOverrides is not an object")?;
        if on {
            m.remove(name);
        } else {
            m.insert(name.to_string(), json!("off"));
        }
        if m.is_empty() {
            o.remove("skillOverrides");
        }
        Ok(())
    })
}

/// Turns a whole plugin off or back on (`enabledPlugins`), for its skills.
pub fn set_plugin(key: &str, on: bool) -> Result<(), String> {
    let file = settings();
    edit_json(&file, |v| {
        let listed = v.get("enabledPlugins").and_then(Value::as_object).is_some_and(|m| m.contains_key(key));
        if !listed {
            return Err(format!("{key} is not an installed plugin"));
        }
        v["enabledPlugins"][key] = json!(on);
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "writes HOME; run with --ignored"]
    fn switches_skills_and_plugins_in_user_settings() {
        let dir = std::env::temp_dir().join(format!("hw-skills-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        std::fs::write(
            dir.join(".claude/settings.json"),
            r#"{ "model": "x", "enabledPlugins": { "tools@m": true } }"#,
        )
        .unwrap();
        std::env::set_var("HOME", &dir);

        set_skill("notes", false).unwrap();
        assert_eq!(state()["off"], json!(["notes"]));
        assert_eq!(read_json(&settings())["model"], "x");
        set_skill("notes", true).unwrap();
        assert!(read_json(&settings()).get("skillOverrides").is_none());
        assert!(set_skill("tools:review", false).is_err());

        set_plugin("tools@m", false).unwrap();
        assert_eq!(state()["plugins"], json!([{ "name": "tools", "key": "tools@m", "on": false }]));
        assert!(set_plugin("other@m", false).is_err());
        assert!(std::fs::read_dir(dir.join(".hoochi/backups")).unwrap().count() >= 3);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
