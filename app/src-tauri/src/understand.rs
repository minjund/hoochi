//! Turns a sentence the person types into a rule, by asking the Claude Code installed on this
//! computer once (`claude -p`). The window builds the instructions and the answer's shape; this
//! only runs it: no tools, no MCP servers, no settings (so no plugins or hooks, hoochi's own
//! included), no saved session. The answer comes back as the JSON the shape describes.

use std::{
    io::Write,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde_json::Value;

use crate::update::claude;

const LIMIT: Duration = Duration::from_secs(90);

/// The arguments for one structured answer. The sentence goes in on stdin, never as an argument.
pub fn args(system: &str, schema: &str, model: &str) -> Vec<String> {
    [
        "-p",
        "--model",
        model,
        "--output-format",
        "json",
        "--json-schema",
        schema,
        "--system-prompt",
        system,
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--no-session-persistence",
        "--disable-slash-commands",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// The structured answer in `claude -p --output-format json`'s reply.
pub fn answer_of(reply: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(reply.trim()).map_err(|_| "claude gave no JSON".to_string())?;
    if v.get("is_error").and_then(Value::as_bool) == Some(true) {
        let why = v.get("result").and_then(Value::as_str).unwrap_or("claude failed");
        return Err(why.to_string());
    }
    v.get("structured_output")
        .cloned()
        .filter(|s| s.is_object())
        .ok_or_else(|| "claude gave no answer in the shape asked".to_string())
}

/// Asks once and waits (at most 90 s). Err("no-claude") when Claude Code is not installed.
pub fn ask(system: &str, schema: &str, text: &str, model: &str) -> Result<Value, String> {
    let exe = claude().ok_or("no-claude")?;
    let mut child = Command::new(exe)
        .args(args(system, schema, model))
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    }
    let started = Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if started.elapsed() > LIMIT {
            let _ = child.kill();
            return Err("timeout".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    answer_of(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sentence_never_becomes_an_argument() {
        let a = args("sys", "{}", "sonnet");
        assert_eq!(a[0], "-p");
        assert!(a.contains(&"--setting-sources".to_string()), "no plugins, so no hooks run in it");
        assert!(a.contains(&"--strict-mcp-config".to_string()));
        assert_eq!(a.iter().filter(|x| x.as_str() == "sys").count(), 1);
    }

    #[test]
    fn reads_the_structured_answer() {
        let ok = r#"{"type":"result","is_error":false,"result":"…","structured_output":{"event":"Stop"}}"#;
        assert_eq!(answer_of(ok).unwrap()["event"], "Stop");
        let failed = r#"{"type":"result","is_error":true,"result":"Not logged in"}"#;
        assert_eq!(answer_of(failed).unwrap_err(), "Not logged in");
        assert!(answer_of("not json").is_err());
        assert!(answer_of(r#"{"is_error":false,"result":"x"}"#).is_err());
    }
}
