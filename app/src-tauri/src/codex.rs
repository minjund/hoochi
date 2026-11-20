//! Codex side of hookwich.
//!
//! Codex has no plugin hooks, so the window app's own binary doubles as the
//! hook command: `hookwich hook codex <Event>`. Codex runs it with the event's
//! JSON on stdin; it picks the items for this moment (this terminal, else this
//! project, else everywhere), runs commands, and prints the answer in Codex's
//! hook format (https://learn.chatgpt.com/docs/hooks).
//!
//! `connect` / `disconnect` add or remove those commands in ~/.codex/hooks.json,
//! only ever appending to the end of each list so the hooks already there keep
//! their trust.

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Map, Value};

/// Every Codex hook event, in lifecycle order.
pub const EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreModelRequest",
    "PostModelRequest",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "SubagentStart",
    "SubagentStop",
    "Stop",
    "PreCompact",
    "PostCompact",
    "Interrupt",
    "SessionEnd",
];

/// Events whose answer can carry words for the model.
const CONTEXT: &[&str] = &["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStart"];
/// Events where putting something in means "keep going once".
const CONTINUES: &[&str] = &["Stop", "SubagentStop"];
const TOOL_EVENTS: &[&str] = &["PreToolUse", "PostToolUse", "PermissionRequest"];
const MAX_OUTPUT: usize = 4000;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
/// What every hookwich command in hooks.json contains, after the quoted app path.
const MARK: &str = " hook codex ";

pub fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

pub fn data_dir() -> PathBuf {
    home().join(".hookwich")
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn read_json(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(Value::Null)
}

/// Writes through a temp file so a reader never sees half a file.
pub fn write_json(path: &Path, value: &Value) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(value).unwrap_or_default() + "\n")?;
    fs::rename(tmp, path)
}

/// The config as version 2; a version 1 file is Claude's "everywhere" list.
pub fn load_config() -> Value {
    let raw = read_json(&data_dir().join("config.json"));
    if raw.get("version").and_then(Value::as_u64) == Some(2) {
        return raw;
    }
    let empty = json!({ "global": [], "projects": {}, "terminals": {} });
    let items = raw.get("items").cloned().unwrap_or_else(|| json!([]));
    json!({ "version": 2, "claude": { "global": items, "projects": {}, "terminals": {} }, "codex": empty })
}

/// The terminal by the id its app gives it; unknown terminals fall back to the chat.
pub fn detect_terminal(session_id: &str) -> (String, String) {
    terminal_of(|name| std::env::var(name).ok())
        .unwrap_or_else(|| (format!("session:{session_id}"), format!("chat {}", short_id(session_id))))
}

fn short_id(v: &str) -> String {
    let tail = v.rsplit(|c| c == ':' || c == '/').next().unwrap_or(v);
    tail.chars().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect::<String>()
}

/// The terminal window or tab, from its environment: the same ids and labels the Claude plugin uses.
pub fn terminal_of(get: impl Fn(&str) -> Option<String>) -> Option<(String, String)> {
    const PROBES: &[(&str, &str, &str)] = &[
        ("WHITEBOX_SURFACE_ID", "whitebox", "Whitebox"),
        ("ITERM_SESSION_ID", "iterm", "iTerm"),
        ("TERM_SESSION_ID", "terminal", "Terminal"),
        ("TMUX_PANE", "tmux", "tmux"),
        ("WEZTERM_PANE", "wezterm", "WezTerm"),
        ("KITTY_WINDOW_ID", "kitty", "kitty"),
    ];
    PROBES.iter().find_map(|(var, prefix, label)| {
        get(var)
            .filter(|v| !v.is_empty())
            .map(|v| (format!("{prefix}:{v}"), format!("{label} {}", short_id(&v))))
    })
}

/// The git top-level above `cwd`, else `cwd` itself.
pub fn detect_project(cwd: &str) -> String {
    // Real path, as `git rev-parse --show-toplevel` gives the Claude side.
    let real = fs::canonicalize(cwd).unwrap_or_else(|_| PathBuf::from(cwd));
    let cwd = real.to_string_lossy().to_string();
    let mut dir = Path::new(&cwd);
    loop {
        if dir.join(".git").exists() {
            return dir.to_string_lossy().to_string();
        }
        match dir.parent() {
            Some(p) => dir = p,
            None => return cwd.clone(),
        }
    }
}

/// The narrowest scope with any item for this event wins.
pub fn pick<'a>(agent: &'a Value, event: &str, project: &str, terminal: &str) -> Option<(&'static str, String, Vec<&'a Value>)> {
    let scopes: [(&'static str, String, Option<&Value>); 3] = [
        ("terminal", terminal.to_string(), agent.get("terminals").and_then(|t| t.get(terminal))),
        ("project", project.to_string(), agent.get("projects").and_then(|p| p.get(project))),
        ("global", String::new(), agent.get("global")),
    ];
    for (scope, key, list) in scopes {
        let here: Vec<&Value> = list
            .and_then(Value::as_array)
            .map(|l| l.iter().filter(|i| i.get("event").and_then(Value::as_str) == Some(event)).collect())
            .unwrap_or_default();
        if !here.is_empty() {
            return Some((scope, key, here));
        }
    }
    None
}

pub fn tool_matches(filter: &str, tool: &str) -> bool {
    let names: Vec<&str> = filter.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
    names.is_empty() || names.contains(&tool)
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn clip(text: &str) -> String {
    let t = text.trim();
    if t.chars().count() > MAX_OUTPUT {
        t.chars().take(MAX_OUTPUT).collect::<String>() + "\n… (cut)"
    } else {
        t.to_string()
    }
}

/// Runs a shell command with a time limit; None when its output should not go in.
fn run_command(command: &str, only_on_fail: bool, cwd: &str) -> Option<String> {
    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c").arg(command).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if !cwd.is_empty() {
        cmd.current_dir(cwd);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Some(format!("$ {command} (did not start: {e})")),
    };
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if started.elapsed() > COMMAND_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => break None,
        }
    };
    let mut out = String::new();
    if let Some(mut s) = child.stdout.take() {
        let _ = s.read_to_string(&mut out);
    }
    let mut err = String::new();
    if let Some(mut s) = child.stderr.take() {
        let _ = s.read_to_string(&mut err);
    }
    let Some(status) = status else {
        return Some(format!("$ {command} (did not finish in 30 seconds)"));
    };
    let code = status.code().unwrap_or(-1);
    if only_on_fail && code == 0 {
        return None;
    }
    let text = clip(&[out, err].into_iter().filter(|s| !s.trim().is_empty()).collect::<Vec<_>>().join("\n"));
    Some(if text.is_empty() { format!("$ {command} (exit {code})") } else { format!("$ {command} (exit {code})\n{text}") })
}

/// The rows of a "rules" item that say both when and which skill, spaces folded.
fn full_rules(item: &Value) -> Vec<(String, String)> {
    let fold = |v: &Value, key: &str| str_of(v, key).split_whitespace().collect::<Vec<_>>().join(" ");
    item.get("rules")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().map(|r| (fold(r, "when"), fold(r, "skill"))).filter(|(w, s)| !w.is_empty() && !s.is_empty()).collect())
        .unwrap_or_default()
}

/// What Codex reads for a "rules" item; None when no row is filled in.
fn rules_text(item: &Value) -> Option<String> {
    let rows = full_rules(item);
    if rows.is_empty() {
        return None;
    }
    let mut lines = vec!["When the task matches one of these, use that skill before you go on:".to_string()];
    lines.extend(rows.iter().map(|(when, skill)| format!("- {when} → \"{skill}\"")));
    Some(lines.join("\n"))
}

fn label_of(item: &Value) -> String {
    let raw = match str_of(item, "kind") {
        "command" => format!("$ {}", str_of(item, "command")),
        "skill" => format!("/{}", str_of(item, "skill")),
        "rules" => full_rules(item).iter().map(|(_, s)| format!("/{s}")).collect::<Vec<_>>().join(" "),
        _ => str_of(item, "text").to_string(),
    };
    let one = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() > 60 {
        one.chars().take(59).collect::<String>() + "…"
    } else {
        one
    }
}

fn note_place(project: &str, terminal: &str, label: &str) {
    let path = data_dir().join("places.json");
    let mut known = read_json(&path);
    if !known.is_object() {
        known = json!({});
    }
    let now = now_ms();
    let obj = known.as_object_mut().expect("object");
    let projects = obj.entry("projects").or_insert_with(|| json!({}));
    if let Some(p) = projects.as_object_mut() {
        p.insert(project.to_string(), json!({ "lastSeen": now }));
    }
    let terminals = obj.entry("terminals").or_insert_with(|| json!({}));
    if let Some(t) = terminals.as_object_mut() {
        t.insert(terminal.to_string(), json!({ "label": label, "cwd": project, "agent": "codex", "lastSeen": now }));
    }
    let _ = write_json(&path, &known);
}

fn is_once(item: &Value) -> bool {
    item.get("once").and_then(Value::as_bool) == Some(true)
}

/// A chat untouched this long is forgotten, so the file stays small.
const ONCE_KEEP_MS: u64 = 30 * 24 * 60 * 60 * 1000;

/// The "once" items a chat (by its session id) already ran.
fn once_done(log: &Value, session: &str) -> Vec<String> {
    log.get(session)
        .and_then(|s| s.get("ids"))
        .and_then(Value::as_array)
        .map(|ids| ids.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default()
}

/// The log with `ids` run in `session` now, and chats gone quiet for a month dropped.
fn note_once(log: Value, session: &str, ids: &[String], now: u64) -> Value {
    let mut done = once_done(&log, session);
    for id in ids {
        if !done.contains(id) {
            done.push(id.clone());
        }
    }
    let mut out = serde_json::Map::new();
    if let Value::Object(chats) = log {
        for (s, v) in chats {
            let at = v.get("at").and_then(Value::as_u64).unwrap_or(0);
            if s != session && now.saturating_sub(at) < ONCE_KEEP_MS {
                out.insert(s, v);
            }
        }
    }
    out.insert(session.to_string(), json!({ "at": now, "ids": done }));
    Value::Object(out)
}

/// The answer for Codex, or None when there is nothing to say.
pub fn answer(event: &str, parts: &[String]) -> Option<Value> {
    if parts.is_empty() {
        return None;
    }
    let body = parts.join("\n\n");
    if CONTINUES.contains(&event) {
        return Some(json!({ "decision": "block", "reason": body }));
    }
    if CONTEXT.contains(&event) {
        return Some(json!({ "hookSpecificOutput": { "hookEventName": event, "additionalContext": body } }));
    }
    None
}

/// `hookwich hook codex <Event>`: never fails the hook; prints nothing when there is nothing to add.
pub fn run_hook(event: &str) -> i32 {
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let e: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
    let cwd = str_of(&e, "cwd").to_string();
    let session_id = str_of(&e, "session_id").to_string();
    let project = detect_project(if cwd.is_empty() { "." } else { &cwd });
    let (terminal, terminal_label) = detect_terminal(&session_id);
    let here = event == "SessionStart" || event == "UserPromptSubmit";
    if here {
        note_place(&project, &terminal, &terminal_label);
    }

    let config = load_config();
    let tool = str_of(&e, "tool_name").to_string();
    let second_pass = CONTINUES.contains(&event) && e.get("stop_hook_active").and_then(Value::as_bool) == Some(true);
    let can_speak = CONTEXT.contains(&event) || CONTINUES.contains(&event);

    let empty = json!({});
    let codex = config.get("codex").unwrap_or(&empty);
    let chosen = pick(codex, event, &project, &terminal);
    let scope = chosen.as_ref().map(|(s, _, _)| *s).unwrap_or("global");
    // A "once" item this chat already ran stays out until the next chat.
    let once_path = data_dir().join("once-codex.json");
    let done = once_done(&read_json(&once_path), &session_id);
    let items: Vec<Value> = chosen
        .map(|(_, _, list)| list.into_iter().cloned().collect::<Vec<Value>>())
        .unwrap_or_default()
        .into_iter()
        .filter(|i| i.get("enabled").and_then(Value::as_bool) != Some(false))
        .filter(|i| !TOOL_EVENTS.contains(&event) || tool_matches(str_of(i, "tools"), &tool))
        .filter(|i| !(is_once(i) && done.contains(&str_of(i, "id").to_string())))
        .collect();

    let at = now_ms();
    let mut parts = Vec::new();
    let mut fired = Vec::new();
    let mut ran = Vec::new();
    if !second_pass {
        for item in &items {
            match str_of(item, "kind") {
                "command" => {
                    let out = run_command(str_of(item, "command"), str_of(item, "mode") == "onFail", &cwd);
                    if let (Some(text), true) = (out, can_speak) {
                        parts.push(text);
                    }
                }
                "skill" if can_speak => parts.push(format!(
                    "Use the \"{}\" skill for this before you go on.",
                    str_of(item, "skill")
                )),
                "rules" if can_speak => match rules_text(item) {
                    Some(text) => parts.push(text),
                    None => continue,
                },
                "text" if can_speak && !str_of(item, "text").trim().is_empty() => {
                    parts.push(str_of(item, "text").to_string())
                }
                _ => continue,
            }
            fired.push(json!({ "event": event, "at": at, "kind": str_of(item, "kind"), "label": label_of(item), "tool": tool, "scope": scope, "id": str_of(item, "id") }));
            ran.push(str_of(item, "id").to_string());
        }
    }

    // "Once" items are noted for this chat; they stay on for the next one.
    let once: Vec<String> = items
        .iter()
        .filter(|i| is_once(i) && ran.contains(&str_of(i, "id").to_string()))
        .map(|i| str_of(i, "id").to_string())
        .collect();
    if !once.is_empty() {
        // Read again just before writing: other chats note theirs in the same file.
        let log = note_once(read_json(&once_path), &session_id, &once, at);
        let _ = write_json(&once_path, &log);
    }

    // What just happened, for the window to light up.
    let path = data_dir().join("activity-codex.json");
    let mut seen = read_json(&path);
    if !seen.is_object() {
        seen = json!({ "counts": {}, "recent": [] });
    }
    seen["lastEvent"] = json!(event);
    seen["lastAt"] = json!(at);
    seen["place"] = json!({ "project": project, "terminal": terminal, "terminalLabel": terminal_label });
    if here {
        // You are here: the window follows the last chat you opened or typed in.
        seen["lastChat"] = json!({ "at": at, "place": seen["place"].clone() });
    }
    let count = seen.pointer(&format!("/counts/{event}")).and_then(Value::as_u64).unwrap_or(0) + 1;
    if !seen["counts"].is_object() {
        seen["counts"] = json!({});
    }
    seen["counts"][event] = json!(count);
    let mut recent = seen["recent"].as_array().cloned().unwrap_or_default();
    recent.extend(fired);
    let skip = recent.len().saturating_sub(40);
    seen["recent"] = Value::Array(recent.into_iter().skip(skip).collect());
    let _ = write_json(&path, &seen);

    if let Some(out) = answer(event, &parts) {
        println!("{out}");
    }
    0
}

fn codex_hooks_path() -> PathBuf {
    let base = std::env::var("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|_| home().join(".codex"));
    base.join("hooks.json")
}

pub fn is_ours(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .map(|hooks| {
            !hooks.is_empty()
                && hooks.iter().all(|h| {
                    let c = str_of(h, "command");
                    c.contains("hookwich") && c.contains(MARK)
                })
        })
        .unwrap_or(false)
}

/// Whether Codex is installed here and whether hookwich is in its hooks.
pub fn status() -> Value {
    let path = codex_hooks_path();
    let installed = path.parent().map(|p| p.exists()).unwrap_or(false);
    let hooks = read_json(&path);
    let connected = EVENTS.iter().all(|ev| {
        hooks
            .pointer(&format!("/hooks/{ev}"))
            .and_then(Value::as_array)
            .map(|groups| groups.iter().any(is_ours))
            .unwrap_or(false)
    });
    json!({ "installed": installed, "connected": connected, "path": path.to_string_lossy() })
}

/// Appends hookwich to the end of every event's list, after backing the file up.
pub fn connect(exe: &Path) -> Result<Value, String> {
    let path = codex_hooks_path();
    let mut hooks = read_json(&path);
    if path.exists() {
        let backup = path.with_file_name(format!("hooks.json.hookwich-backup-{}", now_ms() / 1000));
        fs::copy(&path, &backup).map_err(|e| format!("could not back up {}: {e}", path.display()))?;
    }
    if !hooks.is_object() {
        hooks = json!({});
    }
    let root = hooks.as_object_mut().expect("object");
    let table = root.entry("hooks").or_insert_with(|| Value::Object(Map::new()));
    let table = table.as_object_mut().ok_or("hooks.json has a \"hooks\" that is not an object")?;
    let exe = exe.to_string_lossy().replace('\'', "'\\''");
    for ev in EVENTS {
        let list = table.entry(ev.to_string()).or_insert_with(|| json!([]));
        let Some(groups) = list.as_array_mut() else { continue };
        if groups.iter().any(is_ours) {
            continue;
        }
        let timeout = if *ev == "SessionEnd" || *ev == "Interrupt" { 3 } else { 60 };
        groups.push(json!({
            "hooks": [{
                "type": "command",
                "command": format!("'{exe}' hook codex {ev}"),
                "timeout": timeout,
                "statusMessage": "hookwich"
            }]
        }));
    }
    write_json(&path, &hooks).map_err(|e| e.to_string())?;
    Ok(status())
}

/// Removes every hookwich entry, leaving the rest of the file as it was.
pub fn disconnect() -> Result<Value, String> {
    let path = codex_hooks_path();
    let mut hooks = read_json(&path);
    let Some(table) = hooks.get_mut("hooks").and_then(Value::as_object_mut) else { return Ok(status()) };
    for list in table.values_mut() {
        if let Some(groups) = list.as_array_mut() {
            groups.retain(|g| !is_ours(g));
        }
    }
    table.retain(|_, list| list.as_array().map(|g| !g.is_empty()).unwrap_or(true));
    write_json(&path, &hooks).map_err(|e| e.to_string())?;
    Ok(status())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, event: &str, text: &str, enabled: bool) -> Value {
        json!({ "id": id, "event": event, "kind": "text", "text": text, "enabled": enabled })
    }

    #[test]
    fn narrowest_scope_wins() {
        let agent = json!({
            "global": [item("g", "Stop", "global", true)],
            "projects": { "/p": [item("p", "Stop", "project", true)] },
            "terminals": { "whitebox:t1": [item("t", "Stop", "terminal", true)] }
        });
        assert_eq!(pick(&agent, "Stop", "/p", "whitebox:t1").unwrap().0, "terminal");
        assert_eq!(pick(&agent, "Stop", "/p", "whitebox:t2").unwrap().0, "project");
        assert_eq!(pick(&agent, "Stop", "/q", "whitebox:t2").unwrap().0, "global");
        assert!(pick(&agent, "PreToolUse", "/p", "whitebox:t1").is_none());
    }

    #[test]
    fn answers_in_codex_format() {
        let stop = answer("Stop", &["run the tests".into()]).unwrap();
        assert_eq!(stop["decision"], "block");
        assert_eq!(stop["reason"], "run the tests");
        let ctx = answer("UserPromptSubmit", &["in English".into()]).unwrap();
        assert_eq!(ctx["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit");
        assert_eq!(ctx["hookSpecificOutput"]["additionalContext"], "in English");
        assert!(answer("PreCompact", &["x".into()]).is_none());
        assert!(answer("Stop", &[]).is_none());
    }

    #[test]
    fn rules_list_each_skill_with_when() {
        let rules = json!({ "kind": "rules", "rules": [
            { "when": "기능 추가할 때", "skill": "tdd" },
            { "when": " 리뷰할\n때 ", "skill": "code-review" },
            { "when": "no skill yet", "skill": "" }
        ] });
        assert_eq!(
            rules_text(&rules).unwrap(),
            "When the task matches one of these, use that skill before you go on:\n- 기능 추가할 때 → \"tdd\"\n- 리뷰할 때 → \"code-review\""
        );
        assert_eq!(label_of(&rules), "/tdd /code-review");
        assert!(rules_text(&json!({ "kind": "rules", "rules": [{ "when": "", "skill": "tdd" }] })).is_none());
        assert!(rules_text(&json!({ "kind": "rules" })).is_none());
    }

    #[test]
    fn once_is_per_chat() {
        let day = 24 * 60 * 60 * 1000;
        let log = json!({ "old": { "at": 0, "ids": ["x"] }, "a": { "at": 40 * day, "ids": ["i1"] } });
        let log = note_once(log, "a", &["i2".into(), "i1".into()], 45 * day);
        assert_eq!(once_done(&log, "a"), vec!["i1", "i2"]);
        assert!(once_done(&log, "b").is_empty());
        assert!(log.get("old").is_none());
    }

    #[test]
    fn tool_filter() {
        assert!(tool_matches("", "Bash"));
        assert!(tool_matches("Bash, Edit", "Edit"));
        assert!(!tool_matches("Bash", "Read"));
    }

    #[test]
    fn only_on_fail_skips_success() {
        assert!(run_command("true", true, "").is_none());
        let out = run_command("echo boom; exit 3", true, "").unwrap();
        assert!(out.contains("(exit 3)") && out.contains("boom"));
    }

    #[test]
    fn connect_appends_and_disconnect_removes_only_ours() {
        let dir = std::env::temp_dir().join(format!("hookwich-test-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        std::env::set_var("CODEX_HOME", &dir);
        let mine = json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "my-stop" }] }] } });
        write_json(&dir.join("hooks.json"), &mine).unwrap();

        let st = connect(Path::new("/Apps/Hookwich.app/Contents/MacOS/hookwich")).unwrap();
        assert_eq!(st["connected"], true);
        let after = read_json(&dir.join("hooks.json"));
        let stop = after["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop[0]["hooks"][0]["command"], "my-stop", "existing hook keeps its place");
        assert!(stop[1]["hooks"][0]["command"].as_str().unwrap().ends_with("hook codex Stop"));
        assert!(fs::read_dir(&dir).unwrap().any(|f| f.unwrap().file_name().to_string_lossy().contains("backup")));

        connect(Path::new("/Apps/Hookwich.app/Contents/MacOS/hookwich")).unwrap();
        assert_eq!(read_json(&dir.join("hooks.json"))["hooks"]["Stop"].as_array().unwrap().len(), 2, "no duplicates");

        let st = disconnect().unwrap();
        assert_eq!(st["connected"], false);
        assert_eq!(read_json(&dir.join("hooks.json")), mine);
        let _ = fs::remove_dir_all(&dir);
    }
}
