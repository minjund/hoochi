//! The window's own "Update" button: finds the newest release, updates the
//! plugin through `claude plugin update`, and swaps in the newer window,
//! checked (SHA-256, signature, version) before it replaces anything.
//!
//! Test overrides: HOOCHI_LATEST_URL (the latest-release JSON),
//! HOOCHI_RELEASE_BASE (where `download/v<ver>/<file>` lives) and
//! HOOCHI_CLAUDE (the `claude` to run).

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde_json::{json, Value};

const LATEST: &str = "https://api.github.com/repos/minjund/hoochi/releases/latest";
const RELEASES: &str = "https://github.com/minjund/hoochi/releases";
const PLUGIN: &str = "hoochi@hoochi";

fn env_or(key: &str, fallback: &str) -> String {
    std::env::var(key).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| fallback.to_string())
}

/// This window's version.
pub fn current() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// "0.1.10" > "0.1.9"
pub fn newer(a: &str, b: &str) -> bool {
    let parts = |v: &str| -> Vec<u64> { v.split('.').map(|n| n.parse().unwrap_or(0)).collect() };
    let (pa, pb) = (parts(a), parts(b));
    for i in 0..pa.len().max(pb.len()) {
        let (x, y) = (pa.get(i).copied().unwrap_or(0), pb.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

/// The version in a latest-release reply: "v0.1.12" → "0.1.12"; none for a draft or a pre-release.
pub fn latest_version(reply: &str) -> Option<String> {
    let v: Value = serde_json::from_str(reply).ok()?;
    if v.get("draft").and_then(Value::as_bool) == Some(true)
        || v.get("prerelease").and_then(Value::as_bool) == Some(true)
    {
        return None;
    }
    let tag = v.get("tag_name")?.as_str()?.trim_start_matches('v').to_string();
    let ok = !tag.is_empty() && tag.split('.').all(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()));
    ok.then_some(tag)
}

/// The .app bundle an executable sits in: …/Hoochi.app/Contents/MacOS/hoochi → …/Hoochi.app
pub fn bundle_of(exe: &Path) -> Option<PathBuf> {
    let bundle = exe.parent()?.parent()?.parent()?;
    (bundle.extension()? == "app").then(|| bundle.to_path_buf())
}

pub(crate) fn run(argv: &[&str]) -> Result<String, String> {
    let out = Command::new(argv[0])
        .args(&argv[1..])
        .output()
        .map_err(|e| format!("{}: {e}", argv[0]))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(format!("{} failed: {}", argv[0], err.trim()))
    }
}

fn data_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".hoochi")
}

/// Whether a newer release is out, and what the last update did (said once, then forgotten).
pub fn check() -> Value {
    let url = env_or("HOOCHI_LATEST_URL", LATEST);
    let latest = run(&["/usr/bin/curl", "-fsSL", "--max-time", "15", "-H", "Accept: application/vnd.github+json", &url])
        .ok()
        .and_then(|reply| latest_version(&reply));
    let note_path = data_dir().join("updated.json");
    let note = fs::read_to_string(&note_path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .filter(|n| n.get("to").and_then(Value::as_str) == Some(current()));
    if note.is_some() {
        let _ = fs::remove_file(&note_path);
    }
    json!({
        "current": current(),
        "latest": latest,
        "available": latest.as_deref().is_some_and(|l| newer(l, current())),
        "updated": note,
    })
}

/// The `claude` command: the usual places first, then whatever a login shell finds.
pub(crate) fn claude() -> Option<String> {
    if let Ok(path) = std::env::var("HOOCHI_CLAUDE") {
        return Some(path);
    }
    let home = std::env::var("HOME").unwrap_or_default();
    for path in [
        format!("{home}/.local/bin/claude"),
        "/opt/homebrew/bin/claude".into(),
        "/usr/local/bin/claude".into(),
        format!("{home}/.claude/local/claude"),
    ] {
        if Path::new(&path).is_file() {
            return Some(path);
        }
    }
    let found = run(&["/bin/zsh", "-lc", "command -v claude"]).ok()?;
    let found = found.trim().to_string();
    (!found.is_empty()).then_some(found)
}

/// Updates the plugin; Ok(false) when it could not (the window still updates).
fn update_plugin() -> Result<bool, String> {
    let Some(claude) = claude() else { return Ok(false) };
    Ok(run(&[&claude, "plugin", "update", PLUGIN]).is_ok())
}

/// Downloads, checks and swaps in `version`, then reopens it. The old window quits after.
pub fn apply(version: &str) -> Result<Value, String> {
    if !newer(version, current()) {
        return Err(format!("{version} is not newer than {}", current()));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let bundle = bundle_of(&exe).ok_or("this window is not running from an .app")?;
    let parent = bundle.parent().ok_or("no folder above the app")?.to_path_buf();
    let name = bundle.file_name().ok_or("no app name")?.to_string_lossy().to_string();

    let plugin = update_plugin().unwrap_or(false);

    let arch = if run(&["/usr/bin/uname", "-m"])?.trim() == "arm64" { "arm64" } else { "x64" };
    let file = format!("Hoochi-macos-{arch}.zip");
    let base = env_or("HOOCHI_RELEASE_BASE", RELEASES);
    let url = format!("{base}/download/v{version}/{file}");
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let zip = dir.join(&file);
    let zip_s = zip.to_string_lossy().to_string();
    run(&["/usr/bin/curl", "-fsSL", "--max-time", "120", "-o", &zip_s, &url])?;
    let sums = run(&["/usr/bin/curl", "-fsSL", "--max-time", "30", &format!("{url}.sha256")])?;
    let want = sums.split_whitespace().next().unwrap_or_default().to_string();
    let have = run(&["/usr/bin/shasum", "-a", "256", &zip_s])?;
    if want.is_empty() || have.split_whitespace().next() != Some(want.as_str()) {
        let _ = fs::remove_file(&zip);
        return Err("the download did not match its checksum".into());
    }

    // Unpack beside, check, then swap: a failed update leaves this window as it was.
    let fresh = dir.join(".update");
    let _ = fs::remove_dir_all(&fresh);
    run(&["/usr/bin/ditto", "-x", "-k", &zip_s, &fresh.to_string_lossy()])?;
    let new_app = fresh.join("Hoochi.app");
    let new_s = new_app.to_string_lossy().to_string();
    run(&["/usr/bin/codesign", "--verify", "--deep", "--strict", &new_s])?;
    let plist = format!("{new_s}/Contents/Info.plist");
    let got = run(&["/usr/bin/plutil", "-extract", "CFBundleShortVersionString", "raw", "-o", "-", &plist])?;
    if got.trim() != version {
        return Err(format!("the download is {} instead of {version}", got.trim()));
    }

    let old = parent.join(format!(".old-{name}"));
    let _ = fs::remove_dir_all(&old);
    fs::rename(&bundle, &old).map_err(|e| format!("could not move the old window aside: {e}"))?;
    if let Err(e) = fs::rename(&new_app, &bundle) {
        let _ = fs::rename(&old, &bundle);
        return Err(format!("could not put the new window in place: {e}"));
    }
    let note = json!({ "from": current(), "to": version, "plugin": plugin });
    let _ = fs::write(dir.join("updated.json"), note.to_string());

    // Reopen once this window has quit (macOS would only bring a running copy forward).
    let q = |p: &Path| format!("'{}'", p.to_string_lossy().replace('\'', "'\\''"));
    let script = format!(
        "sleep 1.2; /usr/bin/open {}; /bin/rm -rf {} {} {}",
        q(&bundle),
        q(&old),
        q(&fresh),
        q(&zip)
    );
    Command::new("/bin/sh").args(["-c", &script]).spawn().map_err(|e| e.to_string())?;
    Ok(json!({ "version": version, "plugin": plugin }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_by_number() {
        assert!(newer("0.1.10", "0.1.9"));
        assert!(newer("0.2.0", "0.1.12"));
        assert!(!newer("0.1.11", "0.1.11"));
        assert!(!newer("0.1.9", "0.1.10"));
    }

    #[test]
    fn reads_the_latest_release() {
        assert_eq!(latest_version(r#"{"tag_name":"v0.1.12","draft":false,"prerelease":false}"#).as_deref(), Some("0.1.12"));
        assert_eq!(latest_version(r#"{"tag_name":"v0.2.0-beta","draft":false}"#), None);
        assert_eq!(latest_version(r#"{"tag_name":"v0.1.13","prerelease":true}"#), None);
        assert_eq!(latest_version("not json"), None);
    }

    #[test]
    fn finds_the_app_bundle() {
        let exe = Path::new("/Users/me/.hoochi/Hoochi.app/Contents/MacOS/hoochi");
        assert_eq!(bundle_of(exe), Some(PathBuf::from("/Users/me/.hoochi/Hoochi.app")));
        assert_eq!(bundle_of(Path::new("/usr/local/bin/hoochi")), None);
    }
}
