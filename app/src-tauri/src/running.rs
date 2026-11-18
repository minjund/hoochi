//! Claude Code and Codex chats open right now, found from the process list, so the window can list
//! every terminal even before hookwich has heard from it.

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::process::Command;

use crate::codex::{detect_project, terminal_of};

/// Which AI a process is, from its command line: `claude` or `codex` run in a terminal.
fn agent_of(args: &str) -> Option<&'static str> {
    let exe = args.split_whitespace().next()?;
    let name = exe.rsplit('/').next()?;
    match name {
        "claude" => Some("claude"),
        "codex" => Some("codex"),
        _ if args.contains("@anthropic-ai/claude-code/cli") => Some("claude"),
        _ => None,
    }
}

/// One line of `ps eww -axo pid=,tty=,command=`: the command with its environment after it.
fn parse_line(line: &str) -> Option<(u32, &'static str, HashMap<String, String>)> {
    let mut parts = line.trim_start().splitn(3, char::is_whitespace);
    let pid = parts.next()?.parse().ok()?;
    let tty = parts.next()?.trim();
    let rest = parts.next()?.trim_start();
    // Only chats in a terminal; helpers and background servers have no tty.
    if tty.is_empty() || tty.starts_with('?') {
        return None;
    }
    let agent = agent_of(rest)?;
    let env = rest
        .split_whitespace()
        .filter_map(|w| w.split_once('='))
        .filter(|(k, _)| !k.is_empty() && k.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    Some((pid, agent, env))
}

/// The working folder of each pid, from one `lsof` call.
fn cwds(pids: &[u32]) -> HashMap<u32, String> {
    let mut out = HashMap::new();
    if pids.is_empty() {
        return out;
    }
    let list = pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    let Ok(res) = Command::new("/usr/sbin/lsof").args(["-a", "-d", "cwd", "-Fpn", "-p", &list]).output() else {
        return out;
    };
    let mut pid = 0;
    for line in String::from_utf8_lossy(&res.stdout).lines() {
        if let Some(p) = line.strip_prefix('p') {
            pid = p.parse().unwrap_or(0);
        } else if let Some(n) = line.strip_prefix('n') {
            out.insert(pid, n.to_string());
        }
    }
    out
}

pub fn parse(ps: &str) -> Vec<(u32, &'static str, String, String)> {
    let mut seen = HashSet::new();
    let mut found: Vec<(u32, &'static str, String, String)> = ps
        .lines()
        .filter_map(parse_line)
        .filter_map(|(pid, agent, env)| {
            let (terminal, label) = terminal_of(|k| env.get(k).cloned())?;
            Some((pid, agent, terminal, label))
        })
        .collect();
    // The newest chat in a terminal is the one in front.
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.retain(|(_, _, terminal, _)| seen.insert(terminal.clone()));
    found
}

/// `[{ agent, pid, terminal, terminalLabel, cwd, project }]`
pub fn running() -> Value {
    let Ok(res) = Command::new("/bin/ps").args(["eww", "-axo", "pid=,tty=,command="]).output() else {
        return json!([]);
    };
    let found = parse(&String::from_utf8_lossy(&res.stdout));
    let dirs = cwds(&found.iter().map(|f| f.0).collect::<Vec<_>>());
    Value::Array(
        found
            .into_iter()
            .map(|(pid, agent, terminal, label)| {
                let cwd = dirs.get(&pid).cloned().unwrap_or_default();
                let project = if cwd.is_empty() { String::new() } else { detect_project(&cwd) };
                json!({ "agent": agent, "pid": pid, "terminal": terminal, "terminalLabel": label, "cwd": cwd, "project": project })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_chats_in_terminals_only() {
        let ps = "\
  100 ttys001  /Users/me/.local/bin/claude --mcp-config {\"a\": 1} TERM_PROGRAM=Whitebox WHITEBOX_SURFACE_ID=terminal:x:aaaa1111 HOME=/Users/me
  101 ttys002  /usr/local/lib/node_modules/@openai/codex/bin/codex resume ITERM_SESSION_ID=w0t1p0:BEEF HOME=/Users/me
  102 ??       /Applications/ChatGPT.app/Contents/MacOS/codex app-server HOME=/Users/me
  103 ttys003  node /usr/local/bin/codex WHITEBOX_SURFACE_ID=terminal:x:cccc
  104 ttys001  /Users/me/.local/bin/claude -p hi WHITEBOX_SURFACE_ID=terminal:x:aaaa1111
  105 ttys004  /Users/me/.local/bin/claude HOME=/Users/me
  106 ttys005  /bin/zsh -l WHITEBOX_SURFACE_ID=terminal:x:dddd";
        let found = parse(ps);
        let short: Vec<(u32, &str, &str)> = found.iter().map(|f| (f.0, f.1, f.2.as_str())).collect();
        assert_eq!(
            short,
            vec![(104, "claude", "whitebox:terminal:x:aaaa1111"), (101, "codex", "iterm:w0t1p0:BEEF")],
            "one chat per terminal, newest first; no tty, no terminal id or not an AI → left out"
        );
        assert_eq!(found[1].3, "iTerm BEEF");
    }
}

#[cfg(test)]
mod live {
    /// `cargo test live_scan -- --ignored --nocapture`: what this computer has open right now.
    #[test]
    #[ignore]
    fn live_scan() {
        for c in super::running().as_array().unwrap() {
            println!("{} {} {} {}", c["agent"], c["terminalLabel"], c["project"], c["pid"]);
        }
    }
}
