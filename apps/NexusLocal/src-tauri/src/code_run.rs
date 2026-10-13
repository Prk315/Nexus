//! Compile-and-run for the Learn code-practice C exercises (desktop only —
//! the web build grades C by reading, Python runs in Pyodide everywhere).
//!
//! Scope deliberately narrow: ONE translation unit, `cc -std=c11 -lm`, 5 s
//! wall-clock cap, output truncated. The code is the user's own, typed into
//! their own machine's app — the cap is against accidental infinite loops,
//! not an adversary.

use serde::Serialize;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Serialize)]
pub struct CodeRunOut {
    pub compiled: bool,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

const RUN_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_OUT: usize = 64 * 1024;

fn truncate(mut s: String) -> String {
    if s.len() > MAX_OUT {
        s.truncate(MAX_OUT);
        s.push_str("\n… (truncated)");
    }
    s
}

#[tauri::command]
pub fn run_c_exercise(code: String) -> Result<CodeRunOut, String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let src = dir.path().join("x.c");
    let exe = dir.path().join("x");
    std::fs::write(&src, code).map_err(|e| e.to_string())?;

    let cc = Command::new("cc")
        .args(["-std=c11", "-O1", "-o"])
        .arg(&exe)
        .arg(&src)
        .arg("-lm")
        .output()
        .map_err(|e| format!("cc not available: {e}"))?;
    if !cc.status.success() {
        return Ok(CodeRunOut {
            compiled: false,
            stdout: String::new(),
            stderr: truncate(String::from_utf8_lossy(&cc.stderr).into_owned()),
            timed_out: false,
        });
    }

    let mut child = Command::new(&exe)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let start = Instant::now();
    let mut timed_out = false;
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(_) => break,
            None if start.elapsed() > RUN_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                timed_out = true;
                break;
            }
            None => std::thread::sleep(Duration::from_millis(30)),
        }
    }

    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut o) = child.stdout.take() {
        let _ = o.read_to_string(&mut stdout);
    }
    if let Some(mut e) = child.stderr.take() {
        let _ = e.read_to_string(&mut stderr);
    }
    Ok(CodeRunOut {
        compiled: true,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        timed_out,
    })
}
