// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `hoochi hook codex <Event>`: the Codex hook command, no window.
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 4 && args[1] == "hook" && args[2] == "codex" {
        std::process::exit(hoochi_lib::codex::run_hook(&args[3]));
    }
    hoochi_lib::run();
}
