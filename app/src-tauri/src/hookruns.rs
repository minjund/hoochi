//! What Claude Code recorded of the hooks it ran: each chat's transcript
//! (`~/.claude/projects/<folder>/<session>.jsonl`) holds a `hook_*` attachment for every
//! settings or plugin hook that ran, with its command, exit code, time and output. The window
//! reads them to say whether a hook set up outside hoochi ran and how it ended.
//!
//! Only the newest transcripts are read, from their end, and each one only as far as it grew
//! since the last read.

use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};

use crate::codex::home;

/// Transcripts written to in this long are read.
const RECENT: Duration = Duration::from_secs(3 * 24 * 60 * 60);
/// At most this many of them, the newest first.
const FILES: usize = 40;
/// The first read of a transcript starts this far from its end.
const TAIL: u64 = 3 * 1024 * 1024;
/// Runs kept per transcript.
const PER_FILE: usize = 400;
/// How much of a failed hook's output is kept.
const OUTPUT: usize = 400;

struct Seen {
    /// read up to here: the end of the last whole line
    offset: u64,
    runs: Vec<Value>,
}

static CACHE: Mutex<Option<HashMap<PathBuf, Seen>>> = Mutex::new(None);

/// `2026-11-24T08:47:38.201Z` → ms since 1970; None for anything else.
pub fn parse_time(t: &str) -> Option<u64> {
    let b = t.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let num = |from: usize, to: usize| t.get(from..to)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, s) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    let ms = if b.get(19) == Some(&b'.') {
        let digits: String = t[20..].chars().take_while(char::is_ascii_digit).take(3).collect();
        format!("{digits:0<3}").parse::<i64>().ok()?
    } else {
        0
    };
    // Days from 1970-01-01 to y-mo-d (Howard Hinnant's days_from_civil).
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(((days * 24 + h) * 60 + mi) * 60_000 + s * 1000 + ms).ok()
}

fn head(text: &str) -> String {
    let t = text.trim();
    if t.chars().count() > OUTPUT {
        t.chars().take(OUTPUT).collect::<String>() + "…"
    } else {
        t.to_string()
    }
}

/// The Stop hooks that ran at the end of a turn, from its summary: Claude Code records no run of
/// their own for those that went well. Each is a run that went well, unless a run of its own says
/// otherwise (`runs_of_lines` keeps that one).
fn stop_summary(o: &Value) -> Vec<Value> {
    let s = |k: &str| o.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let at = parse_time(&s("timestamp")).unwrap_or(0);
    o.get("hookInfos")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|h| h.get("command").and_then(Value::as_str))
        .map(|command| {
            json!({
                "at": at, "session": s("sessionId"), "cwd": s("cwd"), "event": "Stop", "on": "",
                "command": command, "result": "ok", "use": s("toolUseID"),
            })
        })
        .collect()
}

/// The hook runs in some lines of a transcript. A hook listed in a turn's Stop summary and also
/// recorded on its own (a failure) counts once, as recorded.
pub fn runs_of_lines<'a>(lines: impl Iterator<Item = &'a str>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for line in lines {
        if line.contains("\"stop_hook_summary\"") {
            if let Ok(o) = serde_json::from_str::<Value>(line) {
                for run in stop_summary(&o) {
                    let twin = out.iter().any(|r| r["event"] == run["event"] && r["use"] == run["use"] && r["command"] == run["command"]);
                    if !twin {
                        out.push(run);
                    }
                }
            }
        } else if let Some(run) = run_of(line) {
            // A failure recorded on its own after the summary listed it: the failure stands.
            out.retain(|r| {
                !(r["result"] == "ok" && r["event"] == run["event"] && r["use"] == run["use"] && r["command"] == run["command"] && r["use"] != "")
            });
            out.push(run);
        }
    }
    out
}

/// One line of a transcript as a hook run, when it is one.
pub fn run_of(line: &str) -> Option<Value> {
    if !line.contains("\"hook_") {
        return None;
    }
    let o: Value = serde_json::from_str(line).ok()?;
    let a = o.get("attachment")?;
    let kind = a.get("type")?.as_str()?;
    let command = a.get("command")?.as_str()?;
    let s = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let exit = a.get("exitCode").and_then(Value::as_i64);
    let result = match kind {
        "hook_cancelled" if a.get("timedOut").and_then(Value::as_bool) == Some(true) => "timeout",
        "hook_cancelled" => "cancelled",
        "hook_blocking_error" => "blocked",
        "hook_success" if exit.unwrap_or(0) == 0 => "ok",
        k if k.starts_with("hook_") && k.contains("error") => "error",
        "hook_success" => "error",
        _ => return None,
    };
    let name = s(a, "hookName");
    // "PreToolUse:Bash": the tool it ran for; "SessionStart:clear": how the chat started.
    let on = name.split_once(':').map(|(_, t)| t.to_string()).unwrap_or_default();
    let mut run = json!({
        "at": parse_time(&s(&o, "timestamp")).unwrap_or(0),
        "session": s(&o, "sessionId"),
        "cwd": s(&o, "cwd"),
        "event": s(a, "hookEvent"),
        "on": on,
        "command": command,
        "result": result,
        "use": s(a, "toolUseID"),
    });
    if let Some(code) = exit {
        run["exit"] = json!(code);
    }
    if let Some(ms) = a.get("durationMs").and_then(Value::as_u64) {
        run["ms"] = json!(ms);
    }
    if let Some(limit) = a.get("timeoutMs").and_then(Value::as_u64) {
        run["limitMs"] = json!(limit);
    }
    if result != "ok" {
        let out = [s(a, "stderr"), s(a, "stdout")].into_iter().find(|t| !t.trim().is_empty()).unwrap_or_default();
        if !out.is_empty() {
            run["out"] = json!(head(&out));
        }
    }
    Some(run)
}

/// The newest transcripts: `<projects>/<folder>/<session>.jsonl`, written to lately.
fn transcripts(projects: &Path) -> Vec<PathBuf> {
    let now = SystemTime::now();
    let mut found: Vec<(SystemTime, PathBuf)> = Vec::new();
    for dir in std::fs::read_dir(projects).into_iter().flatten().flatten() {
        for f in std::fs::read_dir(dir.path()).into_iter().flatten().flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(at) = f.metadata().and_then(|m| m.modified()) else { continue };
            if now.duration_since(at).map(|d| d < RECENT).unwrap_or(true) {
                found.push((at, p));
            }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().take(FILES).map(|(_, p)| p).collect()
}

/// Reads what a transcript gained since `seen`: whole lines only.
fn read_more(path: &Path, seen: &mut Seen) {
    let Ok(mut f) = File::open(path) else { return };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len < seen.offset {
        // It was written over: read it again.
        *seen = Seen { offset: 0, runs: Vec::new() };
    }
    let first = seen.offset == 0 && seen.runs.is_empty();
    let from = if first { len.saturating_sub(TAIL) } else { seen.offset };
    if from >= len || f.seek(SeekFrom::Start(from)).is_err() {
        return;
    }
    let mut buf = Vec::new();
    if f.take(len - from).read_to_end(&mut buf).is_err() {
        return;
    }
    // Starting mid-file, the first line is cut: skip it.
    let start = if first && from > 0 { buf.iter().position(|&c| c == b'\n').map_or(buf.len(), |i| i + 1) } else { 0 };
    let Some(end) = buf.iter().rposition(|&c| c == b'\n').map(|i| i + 1) else { return };
    if end <= start {
        seen.offset = from + end as u64;
        return;
    }
    seen.runs.extend(runs_of_lines(String::from_utf8_lossy(&buf[start..end]).lines()));
    let skip = seen.runs.len().saturating_sub(PER_FILE);
    seen.runs.drain(..skip);
    seen.offset = from + end as u64;
}

/// Every hook run recorded in the newest transcripts, newest first.
pub fn hook_runs_in(projects: &Path) -> Value {
    let files = transcripts(projects);
    let mut guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let cache = guard.get_or_insert_with(HashMap::new);
    cache.retain(|p, _| files.contains(p));
    let mut all: Vec<Value> = Vec::new();
    for p in &files {
        let seen = cache.entry(p.clone()).or_insert(Seen { offset: 0, runs: Vec::new() });
        read_more(p, seen);
        all.extend(seen.runs.iter().cloned());
    }
    let since = SystemTime::now()
        .checked_sub(RECENT)
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    all.retain(|r| r.get("at").and_then(Value::as_u64).unwrap_or(0) >= since);
    all.sort_by(|a, b| b["at"].as_u64().cmp(&a["at"].as_u64()));
    Value::Array(all)
}

pub fn hook_runs() -> Value {
    hook_runs_in(&home().join(".claude/projects"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_time_claude_code_writes() {
        assert_eq!(parse_time("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_time("2026-11-24T08:47:38.201Z"), Some(1_795_510_058_201));
        assert_eq!(parse_time("2000-02-29T12:00:00Z"), Some(951_825_600_000));
        assert_eq!(parse_time("yesterday"), None);
    }

    #[test]
    fn each_kind_of_hook_record_becomes_a_run() {
        let line = |a: Value| json!({ "type": "attachment", "timestamp": "1970-01-01T00:00:01.000Z", "sessionId": "s1", "cwd": "/p", "attachment": a }).to_string();
        let ok = run_of(&line(json!({ "type": "hook_success", "hookName": "PreToolUse:Bash", "hookEvent": "PreToolUse", "command": "lint", "exitCode": 0, "durationMs": 12, "stdout": "fine", "stderr": "" }))).unwrap();
        assert_eq!(ok, json!({ "at": 1000, "session": "s1", "cwd": "/p", "event": "PreToolUse", "on": "Bash", "command": "lint", "result": "ok", "use": "", "exit": 0, "ms": 12 }));

        let bad = run_of(&line(json!({ "type": "hook_non_blocking_error", "hookName": "Stop", "hookEvent": "Stop", "command": "sync", "exitCode": 1, "durationMs": 9, "stderr": "no server", "stdout": "" }))).unwrap();
        assert_eq!((bad["result"].as_str(), bad["out"].as_str(), bad["on"].as_str()), (Some("error"), Some("no server"), Some("")));

        let slow = run_of(&line(json!({ "type": "hook_cancelled", "hookName": "SessionStart:clear", "hookEvent": "SessionStart", "command": "slow", "durationMs": 20123, "timedOut": true, "timeoutMs": 20000 }))).unwrap();
        assert_eq!((slow["result"].as_str(), slow["limitMs"].as_u64()), (Some("timeout"), Some(20000)));

        let blocked = run_of(&line(json!({ "type": "hook_blocking_error", "hookName": "PreToolUse:Bash", "hookEvent": "PreToolUse", "command": "guard", "exitCode": 2, "stderr": "no rm -rf" }))).unwrap();
        assert_eq!(blocked["result"], "blocked");

        // What a hook put in, with no command, is not a run.
        assert!(run_of(&line(json!({ "type": "hook_additional_context", "hookName": "tool.call", "content": ["x"] }))).is_none());
        assert!(run_of("{\"type\":\"user\"}").is_none());
    }

    #[test]
    fn the_stop_hooks_of_a_turn_come_from_its_summary_and_a_failure_recorded_on_its_own_stands() {
        let summary = json!({ "type": "system", "subtype": "stop_hook_summary", "timestamp": "1970-01-01T00:00:02.000Z", "sessionId": "s1", "toolUseID": "u1",
            "hookInfos": [{ "command": "say done" }, { "command": "Syncing" }], "hookErrors": ["Failed"] }).to_string();
        let failed = json!({ "type": "attachment", "timestamp": "1970-01-01T00:00:02.000Z", "sessionId": "s1",
            "attachment": { "type": "hook_non_blocking_error", "hookEvent": "Stop", "hookName": "Stop", "toolUseID": "u1", "command": "Syncing", "exitCode": 1, "stderr": "no server" } }).to_string();
        for order in [[&failed, &summary], [&summary, &failed]] {
            let runs = runs_of_lines(order.iter().map(|s| s.as_str()));
            let by = |c: &str| runs.iter().filter(|r| r["command"] == c).map(|r| r["result"].as_str().unwrap().to_string()).collect::<Vec<_>>();
            assert_eq!(by("say done"), ["ok"]);
            assert_eq!(by("Syncing"), ["error"]);
        }
    }

    #[test]
    fn reads_new_lines_only_and_skips_a_line_still_being_written() {
        let dir = std::env::temp_dir().join(format!("hoochi-runs-{}", std::process::id()));
        let folder = dir.join("-p");
        std::fs::create_dir_all(&folder).unwrap();
        let file = folder.join("s1.jsonl");
        let rec = |cmd: &str| {
            json!({ "timestamp": "2099-01-01T00:00:00.000Z", "sessionId": "s1", "attachment": { "type": "hook_success", "hookEvent": "Stop", "hookName": "Stop", "command": cmd, "exitCode": 0 } }).to_string()
        };
        std::fs::write(&file, format!("{}\n{}", rec("a"), &rec("b")[..20])).unwrap();
        let first = hook_runs_in(&dir);
        assert_eq!(first.as_array().unwrap().len(), 1);
        std::fs::write(&file, format!("{}\n{}\n{}\n", rec("a"), rec("b"), rec("c"))).unwrap();
        let commands: Vec<String> = hook_runs_in(&dir).as_array().unwrap().iter().map(|r| r["command"].as_str().unwrap().to_string()).collect();
        let mut sorted = commands.clone();
        sorted.sort();
        assert_eq!(sorted, ["a", "b", "c"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[cfg(test)]
mod live {
    /// `cargo test live_runs -- --ignored --nocapture`: what this computer's transcripts hold.
    #[test]
    #[ignore]
    fn live_runs() {
        let t = std::time::Instant::now();
        let runs = super::hook_runs();
        let list = runs.as_array().unwrap();
        let mut by: std::collections::BTreeMap<String, usize> = Default::default();
        for r in list {
            *by.entry(format!("{} {}", r["result"], r["event"])).or_default() += 1;
        }
        println!("{} runs in {:?}: {by:?}", list.len(), t.elapsed());
        let t = std::time::Instant::now();
        let again = super::hook_runs();
        println!("again {} in {:?}", again.as_array().unwrap().len(), t.elapsed());
        for r in list.iter().filter(|r| r["result"] != "ok").take(5) {
            println!("{}", r);
        }
    }
}

#[cfg(test)]
mod live_match {
    /// `cargo test live_match -- --ignored --nocapture`: which hooks set up here have runs on record.
    #[test]
    #[ignore]
    fn live_match() {
        let runs = super::hook_runs();
        let runs = runs.as_array().unwrap();
        let hooks = crate::existing::existing("");
        for h in hooks["claude"].as_array().unwrap() {
            let keys: Vec<&str> = [h["command"].as_str().unwrap_or(""), h["status"].as_str().unwrap_or("")].into_iter().filter(|k| !k.is_empty()).collect();
            let mine: Vec<&serde_json::Value> = runs.iter().filter(|r| r["event"] == h["event"] && keys.contains(&r["command"].as_str().unwrap_or("-"))).collect();
            let bad = mine.iter().filter(|r| r["result"] != "ok").count();
            println!("{:<16} {:<22} runs {:>4}  not ok {:>2}  last {}", h["event"].as_str().unwrap(), h["name"].as_str().unwrap().chars().take(22).collect::<String>(), mine.len(), bad, mine.first().map(|r| r["result"].to_string()).unwrap_or_default());
        }
    }
}
