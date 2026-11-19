//! Claude Code and Codex chats open right now, found from the process list, so the window can list
//! every terminal even before hookwich has heard from it.

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use crate::codex::{detect_project, terminal_of};


/// Which AI a process is, from its arguments: `claude` or `codex` run in a terminal. A headless
/// `claude -p` run (a script, or another tool working in that terminal) is not a chat you are in.
fn agent_of(args: &[String]) -> Option<&'static str> {
    let exe = args.first()?;
    if args.iter().skip(1).any(|a| a == "-p" || a == "--print") {
        return None;
    }
    match exe.rsplit('/').next()? {
        "claude" => Some("claude"),
        "codex" => Some("codex"),
        _ if args.iter().any(|a| a.contains("@anthropic-ai/claude-code/cli")) => Some("claude"),
        _ => None,
    }
}

/// One process that may be a chat: its arguments and environment.
pub struct Candidate {
    pub pid: u32,
    /// when the process started, in ms since 1970
    pub started: u64,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

/// One chat found: which process, which AI, which terminal, and when it started.
#[derive(Debug, PartialEq)]
pub struct Found {
    pub pid: u32,
    pub agent: &'static str,
    pub terminal: String,
    pub label: String,
    pub started: u64,
}

/// One chat per terminal, newest first.
pub fn choose(candidates: Vec<Candidate>) -> Vec<Found> {
    let mut seen = HashSet::new();
    let mut found: Vec<Found> = candidates
        .into_iter()
        .filter_map(|c| {
            let agent = agent_of(&c.args)?;
            let (terminal, label) = terminal_of(|k| c.env.get(k).cloned())?;
            Some(Found { pid: c.pid, agent, terminal, label, started: c.started })
        })
        .collect();
    // The newest chat in a terminal is the one in front.
    found.sort_by(|a, b| b.started.cmp(&a.started).then(b.pid.cmp(&a.pid)));
    found.retain(|f| seen.insert(f.terminal.clone()));
    found
}

/// Reads the process table straight from the macOS kernel (no `ps`, no `lsof`).
#[cfg(target_os = "macos")]
mod kernel {
    use std::collections::HashMap;
    use std::ffi::{c_void, CStr};

    use super::Candidate;

    fn pids() -> Vec<i32> {
        let n = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
        if n <= 0 {
            return Vec::new();
        }
        let mut buf = vec![0i32; n as usize + 64];
        let bytes = (buf.len() * std::mem::size_of::<i32>()) as i32;
        let got = unsafe { libc::proc_listallpids(buf.as_mut_ptr() as *mut c_void, bytes) };
        buf.truncate(got.max(0) as usize);
        buf
    }

    /// The short command name, whether the process has a terminal, and when it started (ms).
    fn name_and_tty(pid: i32) -> Option<(String, bool, u64)> {
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
        let r = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, &mut info as *mut _ as *mut c_void, size) };
        if r != size {
            return None;
        }
        let name = unsafe { CStr::from_ptr(info.pbi_comm.as_ptr()) }.to_string_lossy().to_string();
        let started = info.pbi_start_tvsec * 1000 + info.pbi_start_tvusec / 1000;
        Some((name, info.e_tdev != u32::MAX && info.e_tdev != 0, started))
    }

    /// `KERN_PROCARGS2`: argc, the executable path, then argv and the environment, NUL-separated.
    pub fn parse_procargs(buf: &[u8]) -> Option<(Vec<String>, HashMap<String, String>)> {
        let argc = i32::from_ne_bytes(buf.get(..4)?.try_into().ok()?).max(0) as usize;
        let mut rest = &buf[4..];
        let skip_word = |r: &mut &[u8]| {
            let end = r.iter().position(|b| *b == 0).unwrap_or(r.len());
            let word = String::from_utf8_lossy(&r[..end]).to_string();
            *r = &r[(end + 1).min(r.len())..];
            word
        };
        skip_word(&mut rest); // the executable path
        while rest.first() == Some(&0) {
            rest = &rest[1..];
        }
        let mut args = Vec::with_capacity(argc);
        for _ in 0..argc {
            if rest.is_empty() {
                break;
            }
            args.push(skip_word(&mut rest));
        }
        let mut env = HashMap::new();
        while !rest.is_empty() && rest[0] != 0 {
            let word = skip_word(&mut rest);
            if let Some((k, v)) = word.split_once('=') {
                env.insert(k.to_string(), v.to_string());
            }
        }
        Some((args, env))
    }

    fn args_and_env(pid: i32) -> Option<(Vec<String>, HashMap<String, String>)> {
        let mut mib = [libc::CTL_KERN, libc::KERN_ARGMAX];
        let mut argmax: libc::c_int = 0;
        let mut size = std::mem::size_of::<libc::c_int>();
        let r = unsafe {
            libc::sysctl(mib.as_mut_ptr(), 2, &mut argmax as *mut _ as *mut c_void, &mut size, std::ptr::null_mut(), 0)
        };
        if r != 0 || argmax <= 0 {
            return None;
        }
        let mut buf = vec![0u8; argmax as usize];
        let mut size = buf.len();
        let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
        let r = unsafe {
            libc::sysctl(mib.as_mut_ptr(), 3, buf.as_mut_ptr() as *mut c_void, &mut size, std::ptr::null_mut(), 0)
        };
        if r != 0 {
            return None;
        }
        parse_procargs(&buf[..size])
    }

    pub fn cwd(pid: u32) -> Option<String> {
        let mut info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_vnodepathinfo>() as i32;
        let r = unsafe {
            libc::proc_pidinfo(pid as i32, libc::PROC_PIDVNODEPATHINFO, 0, &mut info as *mut _ as *mut c_void, size)
        };
        if r != size {
            return None;
        }
        let raw = &info.pvi_cdir.vip_path;
        let bytes: Vec<u8> = raw.iter().flat_map(|row| row.iter()).map(|c| *c as u8).take_while(|b| *b != 0).collect();
        Some(String::from_utf8_lossy(&bytes).to_string()).filter(|p| !p.is_empty())
    }

    /// Processes that have a terminal, with their arguments and environment.
    pub fn candidates() -> Vec<Candidate> {
        pids()
            .into_iter()
            .filter(|pid| *pid > 0)
            .filter_map(|pid| {
                // Only processes with a terminal; the name alone won't do, since Claude Code's
                // process is named after its version ("2.1.327"). The arguments say which AI it is.
                let (_, tty, started) = name_and_tty(pid)?;
                if !tty {
                    return None;
                }
                let (args, env) = args_and_env(pid)?;
                Some(Candidate { pid: pid as u32, started, args, env })
            })
            .collect()
    }
}

/// When hookwich last wrote this terminal's /context record (ms), if ever: a chat running hookwich
/// writes it as it starts and after each turn, so one older than the chat means hookwich is not in it.
fn hookwich_seen(terminal: &str) -> Option<u64> {
    let path = crate::codex::home().join(".hookwich/context").join(crate::context_file(terminal));
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64)
}

/// `[{ agent, pid, terminal, terminalLabel, cwd, project, hasProject, started, hookwich }]`;
/// `hookwich` is false for a Claude Code chat that hookwich is not running in (opened before it was
/// installed, and not reloaded since), null for Codex.
pub fn running() -> Value {
    #[cfg(target_os = "macos")]
    let found = choose(kernel::candidates());
    #[cfg(not(target_os = "macos"))]
    let found: Vec<Found> = Vec::new();
    Value::Array(
        found
            .into_iter()
            .map(|Found { pid, agent, terminal, label, started }| {
                #[cfg(target_os = "macos")]
                let cwd = kernel::cwd(pid).unwrap_or_default();
                #[cfg(not(target_os = "macos"))]
                let cwd = String::new();
                let project = if cwd.is_empty() { String::new() } else { detect_project(&cwd) };
                let has_project = !project.is_empty() && std::path::Path::new(&project).join(".git").exists();
                let hookwich = (agent == "claude").then(|| hookwich_seen(&terminal).is_some_and(|at| at >= started));
                json!({ "agent": agent, "pid": pid, "terminal": terminal, "terminalLabel": label, "cwd": cwd, "project": project, "hasProject": has_project, "started": started, "hookwich": hookwich })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(pid: u32, args: &[&str], env: &[(&str, &str)]) -> Candidate {
        Candidate {
            pid,
            started: u64::from(pid) * 1000,
            args: args.iter().map(|a| a.to_string()).collect(),
            env: env.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        }
    }

    #[test]
    fn one_chat_per_terminal_newest_first() {
        let found = choose(vec![
            cand(100, &["/Users/me/.local/bin/claude", "--mcp-config", "{\"a\": 1}"], &[("WHITEBOX_SURFACE_ID", "terminal:x:aaaa1111")]),
            cand(101, &["/usr/local/lib/node_modules/@openai/codex/bin/codex", "resume"], &[("ITERM_SESSION_ID", "w0t1p0:BEEF")]),
            cand(103, &["node", "/usr/local/bin/codex"], &[("WHITEBOX_SURFACE_ID", "terminal:x:cccc")]),
            cand(104, &["/Users/me/.local/bin/claude", "-p", "hi"], &[("WHITEBOX_SURFACE_ID", "terminal:x:aaaa1111")]),
            cand(105, &["/Users/me/.local/bin/claude"], &[("HOME", "/Users/me")]),
            cand(106, &["node", "/x/node_modules/@anthropic-ai/claude-code/cli.js"], &[("TMUX_PANE", "%3")]),
        ]);
        let short: Vec<(u32, &str, &str, &str)> =
            found.iter().map(|f| (f.pid, f.agent, f.terminal.as_str(), f.label.as_str())).collect();
        assert_eq!(
            short,
            vec![
                (106, "claude", "tmux:%3", "tmux %3"),
                (101, "codex", "iterm:w0t1p0:BEEF", "iTerm BEEF"),
                (100, "claude", "whitebox:terminal:x:aaaa1111", "Whitebox aaaa1111"),
            ],
            "one chat per terminal, newest first; a `claude -p` run is not the chat there (104); \
             no terminal id, or node running something else → left out"
        );
        assert_eq!(found[2].started, 100_000);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reads_kern_procargs2() {
        let mut buf = 3i32.to_ne_bytes().to_vec();
        buf.extend_from_slice(b"/usr/local/bin/claude\0\0\0\0claude\0--resume\0a b\0HOME=/Users/me\0WHITEBOX_SURFACE_ID=terminal:x:1\0\0junk");
        let (args, env) = kernel::parse_procargs(&buf).unwrap();
        assert_eq!(args, vec!["claude", "--resume", "a b"]);
        assert_eq!(env.get("WHITEBOX_SURFACE_ID").map(String::as_str), Some("terminal:x:1"));
        assert_eq!(env.len(), 2);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finds_this_test_process_in_the_kernel_table() {
        // The test runner has no tty under cargo, so check the parts directly on our own pid.
        let pid = std::process::id();
        assert!(kernel::cwd(pid).is_some_and(|c| c.starts_with('/')));
    }
}

#[cfg(test)]
mod live {
    /// `cargo test live_scan -- --ignored --nocapture`: what this computer has open right now.
    #[test]
    #[ignore]
    fn live_scan() {
        let runs = 10;
        let start = std::time::Instant::now();
        for _ in 0..runs {
            super::running();
        }
        println!("scan: {:.1} ms on average over {runs} runs", start.elapsed().as_secs_f64() * 1000.0 / runs as f64);
        for c in super::running().as_array().unwrap() {
            println!("{} {} {} hookwich={}", c["agent"], c["terminal"], c["project"], c["hookwich"]);
        }
    }
}
