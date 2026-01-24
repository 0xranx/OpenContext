use crate::terminal_session::TerminalSession;
use crate::utils::{map_err, CmdResult};
use crate::AppState;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

static TERMINAL_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalSpawnOptions {
    id: Option<String>,
    command: String,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalWriteOptions {
    id: String,
    data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalResizeOptions {
    id: String,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalKillOptions {
    id: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct TerminalOutputPayload {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct TerminalExitPayload {
    id: String,
    code: Option<i32>,
}

#[tauri::command]
pub(crate) fn terminal_spawn(
    app: tauri::AppHandle,
    state: State<AppState>,
    options: TerminalSpawnOptions,
) -> CmdResult<serde_json::Value> {
    let pty_system = native_pty_system();
    let size = PtySize {
        cols: options.cols.unwrap_or(80),
        rows: options.rows.unwrap_or(24),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system.openpty(size).map_err(map_err)?;

    let mut cmd = CommandBuilder::new(options.command);
    if let Some(args) = options.args {
        cmd.args(args);
    }
    if let Some(cwd) = options.cwd {
        cmd.cwd(cwd);
    }
    if let Some(env) = options.env {
        for (key, value) in env {
            cmd.env(key, value);
        }
    }

    let child = pair.slave.spawn_command(cmd).map_err(map_err)?;
    let mut reader = pair.master.try_clone_reader().map_err(map_err)?;
    let writer = pair.master.take_writer().map_err(map_err)?;
    let master = pair.master;

    let id = options.id.unwrap_or_else(|| {
        format!(
            "term-{}",
            TERMINAL_COUNTER.fetch_add(1, Ordering::Relaxed)
        )
    });
    let output_id = id.clone();
    let output_app = app.clone();
    let child_handle = Arc::new(Mutex::new(child));
    let child_for_thread = child_handle.clone();

    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let payload = TerminalOutputPayload {
                        id: output_id.clone(),
                        data: String::from_utf8_lossy(&buffer[..size]).to_string(),
                    };
                    let _ = output_app.emit("terminal-output", payload);
                }
                Err(_) => break,
            }
        }

        let exit_code = child_for_thread
            .lock()
            .ok()
            .and_then(|mut child| child.wait().ok())
            .map(|status| status.exit_code() as i32);

        let _ = output_app.emit(
            "terminal-exit",
            TerminalExitPayload {
                id: output_id.clone(),
                code: exit_code,
            },
        );
    });

    let session = TerminalSession {
        master,
        writer: Mutex::new(writer),
        child: child_handle,
    };
    state
        .terminal_sessions
        .lock()
        .map_err(map_err)?
        .insert(id.clone(), session);

    Ok(serde_json::json!({ "id": id }))
}

#[tauri::command]
pub(crate) fn terminal_write(state: State<AppState>, options: TerminalWriteOptions) -> CmdResult<()> {
    let sessions = state.terminal_sessions.lock().map_err(map_err)?;
    let session = sessions
        .get(&options.id)
        .ok_or_else(|| "Terminal session not found".to_string())?;
    let mut writer = session.writer.lock().map_err(map_err)?;
    writer.write_all(options.data.as_bytes()).map_err(map_err)?;
    writer.flush().ok();
    Ok(())
}

#[tauri::command]
pub(crate) fn terminal_resize(state: State<AppState>, options: TerminalResizeOptions) -> CmdResult<()> {
    let sessions = state.terminal_sessions.lock().map_err(map_err)?;
    let session = sessions
        .get(&options.id)
        .ok_or_else(|| "Terminal session not found".to_string())?;
    session
        .master
        .resize(PtySize {
            cols: options.cols,
            rows: options.rows,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(map_err)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn terminal_kill(state: State<AppState>, options: TerminalKillOptions) -> CmdResult<()> {
    let mut sessions = state.terminal_sessions.lock().map_err(map_err)?;
    if let Some(session) = sessions.remove(&options.id) {
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
        }
    }
    Ok(())
}
