//! Codex side of hoochi.
//!
//! Codex has no plugin hooks, so the window app's own binary doubles as the
//! hook command: `hoochi hook codex <Event>`. Codex runs it with the event's
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
/// How much of a failed command's output the window keeps, to say why it failed.
const RUN_OUTPUT: usize = 600;
/// Items whose runs are kept; the ones run longest ago go first.
const RUNS_KEPT: usize = 200;
/// Tools kept per moment, newest first, to tell why a tool filter never matched.
const TOOLS_KEPT: usize = 6;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
/// What every hoochi command in hooks.json contains, after the quoted app path.
const MARK: &str = " hook codex ";
/// hoochi was called hookwich before 0.1.28; its entries still count as ours, to repoint or remove.
const OLD_NAME: &str = "hookwich";

pub fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

pub fn data_dir() -> PathBuf {
    home().join(".hoochi")
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

/// What a command run gives: the words for Codex (None when its output should not go in) and how it ended.
pub struct Ran {
    pub text: Option<String>,
    pub run: Value,
}

/// The first of what a failed command printed: its errors first.
fn fail_output(out: &str, err: &str) -> String {
    let t = [err.trim(), out.trim()].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n");
    if t.chars().count() > RUN_OUTPUT {
        t.chars().take(RUN_OUTPUT).collect::<String>() + "…"
    } else {
        t
    }
}

/// Runs a shell command with a time limit.
fn run_command(command: &str, only_on_fail: bool, cwd: &str) -> Ran {
    let at = now_ms();
    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c").arg(command).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if !cwd.is_empty() {
        cmd.current_dir(cwd);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return Ran {
                text: Some(format!("$ {command} (did not start: {e})")),
                run: json!({ "at": at, "ms": 0, "error": format!("did not start: {e}") }),
            }
        }
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
    let ms = started.elapsed().as_millis() as u64;
    let Some(status) = status else {
        return Ran {
            text: Some(format!("$ {command} (did not finish in 30 seconds)")),
            run: json!({ "at": at, "ms": ms, "error": "did not finish in 30 seconds", "out": fail_output(&out, &err) }),
        };
    };
    let code = status.code().unwrap_or(-1);
    let run = if code == 0 {
        json!({ "at": at, "exit": code, "ms": ms })
    } else {
        json!({ "at": at, "exit": code, "ms": ms, "out": fail_output(&out, &err) })
    };
    if only_on_fail && code == 0 {
        return Ran { text: None, run };
    }
    let text = clip(&[out, err].into_iter().filter(|s| !s.trim().is_empty()).collect::<Vec<_>>().join("\n"));
    let text = if text.is_empty() { format!("$ {command} (exit {code})") } else { format!("$ {command} (exit {code})\n{text}") };
    Ran { text: Some(text), run }
}

/// Whether a run went wrong: a command that did not end with 0, or did not finish.
fn run_failed(run: &Value) -> bool {
    run.get("error").is_some() || run.get("exit").and_then(Value::as_i64).is_some_and(|c| c != 0)
}

/// The runs with these added, keeping the items run most lately (as the plugin's `noteRuns`).
pub fn note_runs(runs: &Value, done: &[(String, Value)]) -> Value {
    let mut out = runs.as_object().cloned().unwrap_or_default();
    for (id, run) in done {
        let had = out.get(id).cloned().unwrap_or(Value::Null);
        let bad = run_failed(run);
        let mut entry = json!({
            "runs": had.get("runs").and_then(Value::as_u64).unwrap_or(0) + 1,
            "fails": had.get("fails").and_then(Value::as_u64).unwrap_or(0) + u64::from(bad),
            "last": run,
        });
        if bad {
            entry["fail"] = run.clone();
        } else if let Some(f) = had.get("fail") {
            entry["fail"] = f.clone();
        }
        out.insert(id.clone(), entry);
    }
    if out.len() > RUNS_KEPT {
        let at = |v: &Value| v.pointer("/last/at").and_then(Value::as_u64).unwrap_or(0);
        let mut ids: Vec<(String, u64)> = out.iter().map(|(k, v)| (k.clone(), at(v))).collect();
        ids.sort_by(|a, b| b.1.cmp(&a.1));
        for (id, _) in ids.into_iter().skip(RUNS_KEPT) {
            out.remove(&id);
        }
    }
    Value::Object(out)
}

/// The moments seen with this one added: when it came, and its tool first among the latest.
pub fn note_seen(seen: &Value, event: &str, tool: &str, at: u64) -> Value {
    let mut out = seen.as_object().cloned().unwrap_or_default();
    let had: Vec<String> = out
        .get(event)
        .and_then(|s| s.get("tools"))
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    let tools: Vec<String> = if tool.is_empty() {
        had
    } else {
        std::iter::once(tool.to_string()).chain(had.into_iter().filter(|t| t != tool)).take(TOOLS_KEPT).collect()
    };
    out.insert(event.to_string(), json!({ "at": at, "tools": tools }));
    Value::Object(out)
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

fn note_place(project: &str, terminal: &str, label: &str, session: &str) {
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
        t.insert(
            terminal.to_string(),
            json!({ "label": label, "cwd": project, "agent": "codex", "lastSeen": now, "session": session }),
        );
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

/// `hoochi hook codex <Event>`: never fails the hook; prints nothing when there is nothing to add.
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
        note_place(&project, &terminal, &terminal_label, &session_id);
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
    let mut runs: Vec<(String, Value)> = Vec::new();
    if !second_pass {
        for item in &items {
            match str_of(item, "kind") {
                "command" => {
                    let done = run_command(str_of(item, "command"), str_of(item, "mode") == "onFail", &cwd);
                    if let (Some(text), true) = (done.text, can_speak) {
                        parts.push(text);
                    }
                    runs.push((str_of(item, "id").to_string(), done.run));
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
            if str_of(item, "kind") != "command" {
                runs.push((str_of(item, "id").to_string(), json!({ "at": at })));
            }
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
    if !runs.is_empty() {
        seen["runs"] = note_runs(&seen["runs"], &runs);
    }
    seen["seen"] = note_seen(&seen["seen"], event, &tool, at);
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
                    (c.contains("hoochi") || c.contains(OLD_NAME)) && c.contains(MARK)
                })
        })
        .unwrap_or(false)
}

/// Whether Codex is installed here and whether hoochi is in its hooks.
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

/// Appends hoochi to the end of every event's list, after backing the file up.
pub fn connect(exe: &Path) -> Result<Value, String> {
    let path = codex_hooks_path();
    let mut hooks = read_json(&path);
    if path.exists() {
        let backup = path.with_file_name(format!("hooks.json.hoochi-backup-{}", now_ms() / 1000));
        fs::copy(&path, &backup).map_err(|e| format!("could not back up {}: {e}", path.display()))?;
    }
    if !hooks.is_object() {
        hooks = json!({});
    }
    let root = hooks.as_object_mut().expect("object");
    let table = root.entry("hooks").or_insert_with(|| Value::Object(Map::new()));
    let table = table.as_object_mut().ok_or("hooks.json has a \"hooks\" that is not an object")?;
    let head = command_head(exe);
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
                "command": format!("{head}{ev}"),
                "timeout": timeout,
                "statusMessage": "hoochi"
            }]
        }));
    }
    write_json(&path, &hooks).map_err(|e| e.to_string())?;
    Ok(status())
}

/// The command hooks.json runs for this window, up to the event name.
fn command_head(exe: &Path) -> String {
    format!("'{}'{MARK}", exe.to_string_lossy().replace('\'', "'\\''"))
}

/// Whether some of our entries run another copy of the window (an older name or place).
fn stale(hooks: &Value, exe: &Path) -> bool {
    let head = command_head(exe);
    let Some(table) = hooks.get("hooks").and_then(Value::as_object) else { return false };
    table
        .values()
        .filter_map(Value::as_array)
        .flatten()
        .filter(|g| is_ours(g))
        .flat_map(|g| g.get("hooks").and_then(Value::as_array).into_iter().flatten())
        .any(|h| !str_of(h, "command").starts_with(&head))
}

/// Points our entries at this window when they run another copy (renamed, or moved): Codex
/// would otherwise run a program that is gone. True when it changed the file.
pub fn repoint(exe: &Path) -> Result<bool, String> {
    if !stale(&read_json(&codex_hooks_path()), exe) {
        return Ok(false);
    }
    disconnect()?;
    connect(exe)?;
    Ok(true)
}

/// Removes every hoochi entry, leaving the rest of the file as it was.
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

    /// The tests that set CODEX_HOME take turns: the variable is the whole process's.
    static CODEX_ENV: std::sync::Mutex<()> = std::sync::Mutex::new(());

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
    fn runs_keep_the_last_failure_and_moments_their_tools() {
        let runs = note_runs(&Value::Null, &[("a".into(), json!({ "at": 1, "exit": 1, "out": "boom" }))]);
        let runs = note_runs(&runs, &[("a".into(), json!({ "at": 2, "exit": 0 }))]);
        assert_eq!(runs["a"], json!({ "runs": 2, "fails": 1, "last": { "at": 2, "exit": 0 }, "fail": { "at": 1, "exit": 1, "out": "boom" } }));
        let runs = note_runs(&runs, &[("a".into(), json!({ "at": 3, "error": "did not finish in 30 seconds" }))]);
        assert_eq!(runs["a"]["fails"], 2);

        let seen = note_seen(&Value::Null, "PreToolUse", "shell", 5);
        let seen = note_seen(&seen, "PreToolUse", "apply_patch", 6);
        let seen = note_seen(&seen, "PreToolUse", "shell", 7);
        assert_eq!(seen["PreToolUse"], json!({ "at": 7, "tools": ["shell", "apply_patch"] }));
        assert_eq!(note_seen(&Value::Null, "Stop", "", 1)["Stop"]["tools"], json!([]));
    }

    #[test]
    fn tool_filter() {
        assert!(tool_matches("", "Bash"));
        assert!(tool_matches("Bash, Edit", "Edit"));
        assert!(!tool_matches("Bash", "Read"));
    }

    #[test]
    fn only_on_fail_skips_success() {
        let done = run_command("echo boom; exit 3", true, "");
        let out = done.text.unwrap();
        assert!(out.contains("(exit 3)") && out.contains("boom"));
        assert_eq!(done.run["exit"], 3);
        assert_eq!(done.run["out"], "boom");
        assert!(run_command("true", true, "").text.is_none());
    }

    #[test]
    fn connect_appends_and_disconnect_removes_only_ours() {
        let _env = CODEX_ENV.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("hoochi-test-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        std::env::set_var("CODEX_HOME", &dir);
        let mine = json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "my-stop" }] }] } });
        write_json(&dir.join("hooks.json"), &mine).unwrap();

        let st = connect(Path::new("/Apps/Hoochi.app/Contents/MacOS/hoochi")).unwrap();
        assert_eq!(st["connected"], true);
        let after = read_json(&dir.join("hooks.json"));
        let stop = after["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop[0]["hooks"][0]["command"], "my-stop", "existing hook keeps its place");
        assert!(stop[1]["hooks"][0]["command"].as_str().unwrap().ends_with("hook codex Stop"));
        assert!(fs::read_dir(&dir).unwrap().any(|f| f.unwrap().file_name().to_string_lossy().contains("backup")));

        connect(Path::new("/Apps/Hoochi.app/Contents/MacOS/hoochi")).unwrap();
        assert_eq!(read_json(&dir.join("hooks.json"))["hooks"]["Stop"].as_array().unwrap().len(), 2, "no duplicates");

        let st = disconnect().unwrap();
        assert_eq!(st["connected"], false);
        assert_eq!(read_json(&dir.join("hooks.json")), mine);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hooks_set_up_under_the_old_name_are_pointed_at_this_window() {
        let _env = CODEX_ENV.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("hoochi-repoint-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        std::env::set_var("CODEX_HOME", &dir);
        let old = Path::new("/Users/me/.hookwich/Hookwich.app/Contents/MacOS/hookwich");
        let new = Path::new("/Users/me/.hoochi/Hoochi.app/Contents/MacOS/hoochi");
        write_json(&dir.join("hooks.json"), &json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "my-stop" }] }] } })).unwrap();
        connect(old).unwrap();
        assert!(!repoint(old).unwrap(), "nothing to change for the copy they run");

        assert!(repoint(new).unwrap());
        let after = read_json(&dir.join("hooks.json"));
        let stop = after["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2, "the old entry is replaced, not kept beside");
        assert_eq!(stop[0]["hooks"][0]["command"], "my-stop");
        assert_eq!(stop[1]["hooks"][0]["command"], "'/Users/me/.hoochi/Hoochi.app/Contents/MacOS/hoochi' hook codex Stop");
        assert_eq!(status()["connected"], true);
        assert!(!repoint(new).unwrap());
    }
}
