//! hoochi was called hookwich before 0.1.28. An old Hookwich window's Update button downloads
//! `Hookwich-macos-<arch>.zip` and puts it at ~/.hookwich/Hookwich.app, so each release also
//! ships the window under that name. Opened from there, the window moves ~/.hookwich to
//! ~/.hoochi and itself to Hoochi.app, swaps the hookwich plugin for hoochi, and opens again.
//!
//! Chats opened before the update keep running the old plugin until they reload, and it reads and
//! writes ~/.hookwich. So the old names stay as links: ~/.hookwich → ~/.hoochi (what you put in
//! still reaches those chats) and ~/.hoochi/Hookwich.app → Hoochi.app (the old plugin finds a
//! window as new as its own and opens this one rather than download its own).

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::Value;

use crate::update::{bundle_of, claude, current, run};

const OLD_DIR: &str = ".hookwich";
const NEW_DIR: &str = ".hoochi";
const OLD_APP: &str = "Hookwich.app";
const NEW_APP: &str = "Hoochi.app";
const OLD_PLUGIN: &str = "hookwich@hookwich";
const OLD_MARKET: &str = "hookwich";
const NEW_PLUGIN: &str = "hoochi@hoochi";
const NEW_MARKET: &str = "minjund/hoochi";

/// Moves the old folder and this window to their new names. Returns where the window is now
/// when it moved (it should open again from there), or none when it is already in place.
pub fn move_in(home: &Path, exe: &Path) -> Result<Option<PathBuf>, String> {
    let Some(bundle) = bundle_of(exe) else { return Ok(None) };
    let (old, new) = (home.join(OLD_DIR), home.join(NEW_DIR));
    // Opened through the links left below: it is already in place.
    if is_link(&old) || is_link(&bundle) {
        return Ok(None);
    }
    let ours = bundle.file_name().is_some_and(|n| n == OLD_APP) && bundle.parent() == Some(old.as_path());
    if !ours {
        return Ok(None);
    }
    let bundle = if new.exists() {
        bundle
    } else {
        fs::rename(&old, &new).map_err(|e| format!("could not move {}: {e}", old.display()))?;
        new.join(OLD_APP)
    };
    let target = new.join(NEW_APP);
    let _ = fs::remove_dir_all(&target);
    fs::rename(&bundle, &target).map_err(|e| format!("could not rename the window: {e}"))?;
    Ok(Some(target))
}

fn is_link(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink())
}

/// Leaves the old names as links to the new ones (see the top of this file). A ~/.hookwich that an
/// old chat wrote again after the move (records only: no config.json, no window) is replaced.
pub fn link_old(home: &Path) -> Result<(), String> {
    let (old, new) = (home.join(OLD_DIR), home.join(NEW_DIR));
    if !new.join(NEW_APP).is_dir() {
        return Ok(());
    }
    let leftover = old.is_dir() && !is_link(&old) && !old.join("config.json").exists() && !old.join(OLD_APP).exists();
    if leftover {
        fs::remove_dir_all(&old).map_err(|e| e.to_string())?;
    }
    if fs::symlink_metadata(&old).is_err() {
        std::os::unix::fs::symlink(&new, &old).map_err(|e| e.to_string())?;
    }
    let app_link = new.join(OLD_APP);
    if fs::symlink_metadata(&app_link).is_err() {
        std::os::unix::fs::symlink(NEW_APP, &app_link).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn installed(home: &Path) -> Value {
    let path = home.join(".claude/plugins/installed_plugins.json");
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("plugins").cloned())
        .unwrap_or(Value::Null)
}

/// Installs the hoochi plugin and removes the hookwich one (and its marketplace) when the
/// hookwich plugin is still installed. True when hoochi is installed afterwards.
pub fn switch_plugin(home: &Path) -> bool {
    let plugins = installed(home);
    let has_new = plugins.get(NEW_PLUGIN).is_some();
    if plugins.get(OLD_PLUGIN).is_none() {
        return has_new;
    }
    let Some(claude) = claude() else { return has_new };
    let ok = has_new || run(&[&claude, "plugin", "install", "hoochi", "--marketplace", NEW_MARKET]).is_ok();
    if ok {
        let _ = run(&[&claude, "plugin", "uninstall", OLD_PLUGIN]);
        let _ = run(&[&claude, "plugin", "marketplace", "remove", OLD_MARKET]);
    }
    ok
}

/// The note the old window left about this update now says the plugin changed name, so the
/// window tells you to reload the chats already open (they run the old plugin, which cannot).
pub fn note_renamed(dir: &Path, plugin: bool) {
    let path = dir.join("updated.json");
    let Some(mut note) = fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
        return;
    };
    if note.get("to").and_then(Value::as_str) != Some(current()) {
        return;
    }
    note["plugin"] = Value::Bool(plugin);
    note["renamed"] = Value::Bool(true);
    let _ = fs::write(&path, note.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hoochi-rename-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn app_at(dir: &Path, app: &str) -> PathBuf {
        let macos = dir.join(app).join("Contents/MacOS");
        fs::create_dir_all(&macos).unwrap();
        let exe = macos.join("hoochi");
        fs::write(&exe, "").unwrap();
        exe
    }

    #[test]
    fn a_window_updated_by_an_old_one_moves_the_folder_and_itself() {
        let h = home("move");
        let exe = app_at(&h.join(OLD_DIR), OLD_APP);
        fs::write(h.join(OLD_DIR).join("config.json"), "{}").unwrap();
        let moved = move_in(&h, &exe).unwrap();
        assert_eq!(moved, Some(h.join(NEW_DIR).join(NEW_APP)));
        assert!(!h.join(OLD_DIR).exists());
        assert!(h.join(NEW_DIR).join("config.json").exists());
        assert!(h.join(NEW_DIR).join(NEW_APP).join("Contents/MacOS/hoochi").exists());
        assert!(!h.join(NEW_DIR).join(OLD_APP).exists());
        // Opened again from there, nothing moves.
        let exe = h.join(NEW_DIR).join(NEW_APP).join("Contents/MacOS/hoochi");
        assert_eq!(move_in(&h, &exe).unwrap(), None);
    }

    #[test]
    fn with_both_folders_only_the_window_moves() {
        let h = home("both");
        let exe = app_at(&h.join(OLD_DIR), OLD_APP);
        app_at(&h.join(NEW_DIR), NEW_APP);
        assert_eq!(move_in(&h, &exe).unwrap(), Some(h.join(NEW_DIR).join(NEW_APP)));
        assert!(h.join(OLD_DIR).exists());
        assert!(!h.join(OLD_DIR).join(OLD_APP).exists());
    }

    #[test]
    fn other_windows_stay_where_they_are() {
        let h = home("other");
        let exe = app_at(&h.join("Applications"), OLD_APP);
        fs::create_dir_all(h.join(OLD_DIR)).unwrap();
        assert_eq!(move_in(&h, &exe).unwrap(), None);
        assert!(h.join(OLD_DIR).exists());
        assert_eq!(move_in(&h, Path::new("/tmp/target/debug/hoochi")).unwrap(), None);
    }

    #[test]
    fn the_old_names_are_left_as_links() {
        let h = home("links");
        let exe = app_at(&h.join(OLD_DIR), OLD_APP);
        fs::write(h.join(OLD_DIR).join("config.json"), "{}").unwrap();
        move_in(&h, &exe).unwrap();
        link_old(&h).unwrap();
        assert!(is_link(&h.join(OLD_DIR)));
        assert!(h.join(OLD_DIR).join("config.json").exists(), "old chats still read what you put in");
        assert!(h.join(NEW_DIR).join(OLD_APP).join("Contents/MacOS/hoochi").exists());
        // Opened through either link, nothing moves or is removed.
        let through = h.join(OLD_DIR).join(OLD_APP).join("Contents/MacOS/hoochi");
        assert_eq!(move_in(&h, &through).unwrap(), None);
        assert!(h.join(NEW_DIR).join(NEW_APP).is_dir());
        link_old(&h).unwrap();
        assert!(is_link(&h.join(OLD_DIR)));
    }

    #[test]
    fn records_an_old_chat_wrote_after_the_move_give_way_to_the_link() {
        let h = home("leftover");
        app_at(&h.join(NEW_DIR), NEW_APP);
        fs::create_dir_all(h.join(OLD_DIR).join("context")).unwrap();
        fs::write(h.join(OLD_DIR).join("activity-claude.json"), "{}").unwrap();
        link_old(&h).unwrap();
        assert!(is_link(&h.join(OLD_DIR)));
        // One still holding what you put in is never replaced.
        let h = home("kept");
        app_at(&h.join(NEW_DIR), NEW_APP);
        fs::create_dir_all(h.join(OLD_DIR)).unwrap();
        fs::write(h.join(OLD_DIR).join("config.json"), "{}").unwrap();
        link_old(&h).unwrap();
        assert!(!is_link(&h.join(OLD_DIR)));
    }

    #[test]
    fn the_note_says_the_plugin_was_renamed() {
        let h = home("note");
        let note = format!(r#"{{"from":"0.1.27","to":"{}","plugin":false}}"#, current());
        fs::write(h.join("updated.json"), note).unwrap();
        note_renamed(&h, true);
        let got: Value = serde_json::from_str(&fs::read_to_string(h.join("updated.json")).unwrap()).unwrap();
        assert_eq!(got["plugin"], true);
        assert_eq!(got["renamed"], true);
        assert_eq!(got["from"], "0.1.27");
    }
}
