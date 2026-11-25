//! What Claude Code recorded of the hooks it ran: each chat's transcript
//! (`~/.claude/projects/<folder>/<session>.jsonl`) holds a `hook_*` attachment for every
//! settings or plugin hook that ran, with its command, exit code, time and output. The window
//! reads them to say whether a hook set up outside hoochi ran and how it ended.
//!
//! The transcripts written to in the last week are read once in full (only the lines about
//! hooks are parsed), then each one only as far as it grew since. Besides the runs of the last
//! days, each hook gets its week in numbers (`stats_of`): how often it failed or timed out, in how
//! many chats, on which days, and how long its recorded runs took.
//!
//! Claude Code does not record every run: a failure always, a run that went well only at some
//! moments (before and after a tool, at the start of a chat, the Stop hooks of a turn) and never at
//! UserPromptSubmit; an async hook leaves no record at all. So failures are counted exactly, and
//! "how many runs" and "how long" only where runs that went well are recorded.

use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};

use crate::codex::home;

const DAY_MS: u64 = 24 * 60 * 60 * 1000;
/// The numbers cover this many days; transcripts written to in that time are read.
const DAYS: u64 = 7;
const WEEK: Duration = Duration::from_secs(DAYS * 24 * 60 * 60);
/// At most this many transcripts, the newest first.
const FILES: usize = 1000;
/// The runs themselves are sent for this many days, at most `SENT` of them, the newest first.
const RUN_DAYS: u64 = 3;
const SENT: usize = 3000;
/// Read this much at a time.
const CHUNK: usize = 8 * 1024 * 1024;
/// How much of a failed hook's output is kept.
const OUTPUT: usize = 400;

struct Seen {
    /// read up to here: the end of the last whole line
    offset: u64,
    runs: Vec<Value>,
}

/// The events where Claude Code records a run that went well (seen in its transcripts): elsewhere
/// only failures are on record, so the last recorded run is not the last run.
pub const RECORDS_OK: [&str; 6] = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "SessionStart", "Stop"];

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
    let key = |r: &Value| format!("{}\u{0}{}\u{0}{}", r["event"], r["use"], r["command"]);
    let mut out: Vec<Option<Value>> = Vec::new();
    // Where each (event, turn, command) is, and which of them came from a summary.
    let mut at: HashMap<String, usize> = HashMap::new();
    let mut from_summary: HashSet<String> = HashSet::new();
    for line in lines {
        if line.contains("\"stop_hook_summary\"") {
            if let Ok(o) = serde_json::from_str::<Value>(line) {
                for run in stop_summary(&o) {
                    let k = key(&run);
                    if !at.contains_key(&k) {
                        at.insert(k.clone(), out.len());
                        from_summary.insert(k);
                        out.push(Some(run));
                    }
                }
            }
        } else if let Some(run) = run_of(line) {
            // A failure recorded on its own after the summary listed it: the failure stands.
            let k = key(&run);
            if run["use"] != "" && from_summary.remove(&k) {
                if let Some(i) = at.get(&k) {
                    out[*i] = None;
                }
            }
            at.insert(k, out.len());
            out.push(Some(run));
        }
    }
    out.into_iter().flatten().collect()
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
        "version": s(&o, "version"),
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
    const RECENT: Duration = WEEK;
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

/// Reads what a transcript gained since `seen`: whole lines only, a chunk at a time, parsing only
/// the lines about hooks.
fn read_more(path: &Path, seen: &mut Seen) {
    let Ok(mut f) = File::open(path) else { return };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len < seen.offset {
        // It was written over: read it again.
        *seen = Seen { offset: 0, runs: Vec::new() };
    }
    if seen.offset >= len || f.seek(SeekFrom::Start(seen.offset)).is_err() {
        return;
    }
    let mut carry: Vec<u8> = Vec::new();
    let mut buf = vec![0u8; CHUNK];
    let mut read_to = seen.offset;
    loop {
        let n = match f.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        read_to += n as u64;
        carry.extend_from_slice(&buf[..n]);
        let Some(end) = carry.iter().rposition(|&c| c == b'\n').map(|i| i + 1) else { continue };
        let text = String::from_utf8_lossy(&carry[..end]);
        seen.runs.extend(runs_of_lines(text.lines().filter(|l| l.contains("\"hook_") || l.contains("stop_hook_summary"))));
        carry.drain(..end);
        if read_to >= len {
            break;
        }
    }
    // A line still being written stays for the next read.
    seen.offset = read_to - carry.len() as u64;
    let since = now_ms().saturating_sub(DAYS * DAY_MS);
    seen.runs.retain(|r| r["at"].as_u64().unwrap_or(0) >= since);
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn percentile(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let i = ((sorted.len() - 1) as f64 * p).round() as usize;
    sorted[i.min(sorted.len() - 1)]
}

/// Each hook's week in numbers, by (event, command): failures (an exit other than 0 or 2, or a
/// timeout), timeouts, in how many chats, the failures of each of the last 7 days (oldest first),
/// and how long its recorded runs took (timeouts and cancels left out: they took the limit).
pub fn stats_of(runs: &[Value], now: u64) -> Vec<Value> {
    let mut by: HashMap<(String, String), Vec<&Value>> = HashMap::new();
    for r in runs {
        let k = (r["event"].as_str().unwrap_or_default().to_string(), r["command"].as_str().unwrap_or_default().to_string());
        by.entry(k).or_default().push(r);
    }
    let mut out: Vec<Value> = by
        .into_iter()
        .map(|((event, command), rs)| {
            let result = |r: &Value| r["result"].as_str().unwrap_or_default().to_string();
            let failed = |r: &Value| matches!(result(r).as_str(), "error" | "timeout");
            let count = |k: &str| rs.iter().filter(|r| result(r) == k).count();
            let fails: Vec<&&Value> = rs.iter().filter(|r| failed(r)).collect();
            let at = |r: &Value| r["at"].as_u64().unwrap_or(0);
            let mut days = [0u64; DAYS as usize];
            for r in &fails {
                let ago = now.saturating_sub(at(r)) / DAY_MS;
                if ago < DAYS {
                    days[(DAYS - 1 - ago) as usize] += 1;
                }
            }
            let chats: HashSet<&str> = fails.iter().filter_map(|r| r["session"].as_str()).collect();
            let all_chats: HashSet<&str> = rs.iter().filter_map(|r| r["session"].as_str()).collect();
            let mut ms: Vec<u64> = rs
                .iter()
                .filter(|r| !matches!(result(r).as_str(), "timeout" | "cancelled"))
                .filter_map(|r| r["ms"].as_u64())
                .collect();
            ms.sort_unstable();
            let limit = rs.iter().filter_map(|r| r["limitMs"].as_u64()).max();
            let last_fail = fails.iter().max_by_key(|r| at(r));
            json!({
                "event": event, "command": command,
                "runs": rs.len(), "ok": count("ok") + count("blocked"),
                "fails": fails.len(), "timeouts": count("timeout"), "cancelled": count("cancelled"),
                "fails24": fails.iter().filter(|r| now.saturating_sub(at(r)) < DAY_MS).count(),
                "chats": chats.len(), "allChats": all_chats.len(),
                "days": days,
                "timed": ms.len(), "p50": percentile(&ms, 0.5), "p90": percentile(&ms, 0.9), "max": ms.last().copied().unwrap_or(0),
                "limitMs": limit,
                "lastAt": rs.iter().map(|r| at(r)).max().unwrap_or(0),
                "lastFailAt": last_fail.map(|r| at(r)),
                "version": last_fail.and_then(|r| r["version"].as_str()).unwrap_or_default(),
                "recordsOk": RECORDS_OK.contains(&event.as_str()),
            })
        })
        .collect();
    out.sort_by(|a, b| b["fails"].as_u64().cmp(&a["fails"].as_u64()));
    out
}

/// What the transcripts of the last week hold: `runs`, those of the last days, newest first, and
/// `stats`, each hook's week in numbers.
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
    drop(guard);
    let now = now_ms();
    all.retain(|r| r.get("at").and_then(Value::as_u64).unwrap_or(0) >= now.saturating_sub(DAYS * DAY_MS));
    let stats = stats_of(&all, now);
    all.retain(|r| r.get("at").and_then(Value::as_u64).unwrap_or(0) >= now.saturating_sub(RUN_DAYS * DAY_MS));
    all.sort_by(|a, b| b["at"].as_u64().cmp(&a["at"].as_u64()));
    all.truncate(SENT);
    json!({ "runs": all, "stats": stats })
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
        assert_eq!(ok, json!({ "at": 1000, "session": "s1", "version": "", "cwd": "/p", "event": "PreToolUse", "on": "Bash", "command": "lint", "result": "ok", "use": "", "exit": 0, "ms": 12 }));

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
    fn a_week_in_numbers_counts_failures_by_day_and_times_only_runs_that_ended() {
        let now = 10 * DAY_MS;
        let run = |ago_h: u64, result: &str, session: &str, ms: Option<u64>| {
            let mut r = json!({ "at": now - ago_h * 3_600_000, "session": session, "event": "UserPromptSubmit", "command": "sync", "result": result, "version": "2.1.326" });
            if let Some(ms) = ms {
                r["ms"] = json!(ms);
            }
            if result == "timeout" {
                r["limitMs"] = json!(20000);
            }
            r
        };
        let runs = vec![
            run(1, "timeout", "a", Some(20031)),
            run(2, "timeout", "b", Some(20044)),
            run(30, "error", "a", Some(300)),
            run(50, "ok", "c", Some(100)),
            run(60, "ok", "c", Some(500)),
        ];
        let s = &stats_of(&runs, now)[0];
        assert_eq!((s["fails"].as_u64(), s["timeouts"].as_u64(), s["fails24"].as_u64(), s["chats"].as_u64()), (Some(3), Some(2), Some(2), Some(2)));
        assert_eq!(s["days"], json!([0, 0, 0, 0, 0, 1, 2]));
        // Timeouts took the limit, not their own time: left out of how long it takes.
        assert_eq!((s["timed"].as_u64(), s["max"].as_u64(), s["limitMs"].as_u64()), (Some(3), Some(500), Some(20000)));
        assert_eq!((s["recordsOk"].as_bool(), s["version"].as_str()), (Some(false), Some("2.1.326")));
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
        assert_eq!(first["runs"].as_array().unwrap().len(), 1);
        std::fs::write(&file, format!("{}\n{}\n{}\n", rec("a"), rec("b"), rec("c"))).unwrap();
        let commands: Vec<String> = hook_runs_in(&dir)["runs"].as_array().unwrap().iter().map(|r| r["command"].as_str().unwrap().to_string()).collect();
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
        let list = runs["runs"].as_array().unwrap();
        let mut by: std::collections::BTreeMap<String, usize> = Default::default();
        for r in list {
            *by.entry(format!("{} {}", r["result"], r["event"])).or_default() += 1;
        }
        println!("{} runs in {:?}: {by:?}", list.len(), t.elapsed());
        let t = std::time::Instant::now();
        let again = super::hook_runs();
        println!("again {} in {:?}", again["runs"].as_array().unwrap().len(), t.elapsed());
        for st in runs["stats"].as_array().unwrap().iter().take(5) {
            println!("{st}");
        }
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
        let runs = runs["runs"].as_array().unwrap();
        let hooks = crate::existing::existing("");
        for h in hooks["claude"].as_array().unwrap() {
            let keys: Vec<&str> = [h["command"].as_str().unwrap_or(""), h["status"].as_str().unwrap_or("")].into_iter().filter(|k| !k.is_empty()).collect();
            let mine: Vec<&serde_json::Value> = runs.iter().filter(|r| r["event"] == h["event"] && keys.contains(&r["command"].as_str().unwrap_or("-"))).collect();
            let bad = mine.iter().filter(|r| r["result"] != "ok").count();
            println!("{:<16} {:<22} runs {:>4}  not ok {:>2}  last {}", h["event"].as_str().unwrap(), h["name"].as_str().unwrap().chars().take(22).collect::<String>(), mine.len(), bad, mine.first().map(|r| r["result"].to_string()).unwrap_or_default());
        }
    }
}
