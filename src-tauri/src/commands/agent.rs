use crate::agent_rpc::{AgentRpcKind, AgentRpcSession, AgentRpcState};
use crate::chat::build_cli_prompt;
use crate::utils::{map_err, CmdResult};
use crate::AppState;
use opencontext_core::search::SearchConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, State};

static AGENT_COUNTER: AtomicU64 = AtomicU64::new(1);
const AGENT_SESSIONS_FILE: &str = "agent-sessions.json";
const DEFAULT_CODEX_MODELS: [&str; 4] = [
    "gpt-5.2-codex",
    "gpt-5.1-codex-max",
    "gpt-5.1-codex-mini",
    "gpt-5.2",
];
const DEFAULT_AGENTS_MD: &str = r#"# OpenContext Agent

You are the OpenContext dedicated coding agent.

Guidelines:
- Prefer using `oc` CLI commands to create/search/iterate OpenContext content.
- Avoid editing user files directly unless explicitly requested.
- When reading or writing files, ask for permission if required.
- Be concise, actionable, and follow OpenContext workflows.
"#;

#[derive(Serialize, Clone, Default)]
pub(crate) struct AgentStreamEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    done: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    permission: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    models: Option<serde_json::Value>,
}

fn agent_sessions_path(app: &tauri::AppHandle) -> CmdResult<PathBuf> {
    let base_dir = app.path().app_data_dir().map_err(map_err)?;
    Ok(base_dir.join(AGENT_SESSIONS_FILE))
}

fn emit_agent_event(app: &tauri::AppHandle, request_id: &str, payload: AgentStreamEvent) {
    let event_name = format!("agent-stream-{}", request_id);
    let _ = app.emit(&event_name, payload);
}

fn emit_agent_error(app: &tauri::AppHandle, request_id: &str, message: String) {
    emit_agent_event(
        app,
        request_id,
        AgentStreamEvent {
            content: None,
            done: Some(true),
            error: Some(message),
            ..Default::default()
        },
    );
}

fn emit_agent_status(app: &tauri::AppHandle, request_id: &str, status: &str) {
    emit_agent_event(
        app,
        request_id,
        AgentStreamEvent {
            status: Some(status.to_string()),
            ..Default::default()
        },
    );
}

fn detect_codex_mcp_args() -> Vec<String> {
    let output = Command::new("codex")
        .arg("--version")
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .unwrap_or_default();

    parse_codex_mcp_args(&output)
}

pub(crate) fn parse_codex_mcp_args(output: &str) -> Vec<String> {
    let mut major = 0;
    let mut minor = 0;

    for token in output.split_whitespace() {
        let trimmed = token.trim_start_matches('v');
        let mut parts = trimmed.split('.').filter_map(|p| p.parse::<u32>().ok());
        if let (Some(mj), Some(mn)) = (parts.next(), parts.next()) {
            major = mj;
            minor = mn;
            break;
        }
    }

    if major > 0 || minor >= 40 {
        return vec!["mcp-server".to_string()];
    }
    if major == 0 && minor == 0 {
        return vec!["mcp-server".to_string()];
    }
    vec!["mcp".to_string(), "serve".to_string()]
}

fn strip_ansi(input: &str) -> String {
    let mut out = String::new();
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if matches!(chars.peek(), Some('[')) {
                chars.next();
                while let Some(next) = chars.next() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
                continue;
            }
        }
        out.push(ch);
    }
    out
}

fn extract_error_detail(message: &str) -> String {
    let cleaned = strip_ansi(message);
    let lower = cleaned.to_lowercase();
    if let Some(pos) = lower.find("error=") {
        return cleaned[pos + 6..].trim().to_string();
    }
    if let Some(pos) = lower.find("error:") {
        return cleaned[pos + 6..].trim().to_string();
    }
    cleaned.trim().to_string()
}

fn classify_http_error(message: &str, label: &str) -> Option<String> {
    let lower = message.to_lowercase();
    if lower.contains("error=http")
        || lower.contains("http 4")
        || lower.contains("http 5")
        || lower.contains("too many requests")
        || lower.contains("rate limit")
        || lower.contains("usage_not_included")
        || lower.contains("quota")
    {
        let detail = extract_error_detail(message);
        return Some(format!("{} request failed: {}", label, detail));
    }
    None
}

fn classify_codex_error(message: &str) -> Option<String> {
    let cleaned = strip_ansi(message);
    let lower = cleaned.to_lowercase();
    if lower.contains("command not found") || lower.contains("not recognized") {
        return Some(
            "Codex CLI not found. Please ensure 'codex' is installed and in PATH.".to_string(),
        );
    }
    if lower.contains("permission denied") {
        return Some(format!("Permission denied when starting Codex: {}", cleaned));
    }
    if lower.contains("authentication") || lower.contains("login") {
        return Some("Codex authentication required. Please run 'codex auth' first.".to_string());
    }
    if lower.contains("unknown flag")
        || lower.contains("invalid option")
        || lower.contains("unrecognized")
    {
        return Some(format!("Invalid Codex CLI arguments: {}", cleaned));
    }
    if lower.contains("timed out") || lower.contains("timeout") {
        return Some("Codex initialization timed out. Please check Codex auth status and network.".to_string());
    }
    if let Some(error) = classify_http_error(&cleaned, "Codex") {
        return Some(error);
    }
    None
}

fn classify_acp_error(message: &str, kind: AgentRpcKind) -> Option<String> {
    let label = match kind {
        AgentRpcKind::ClaudeAcp => "Claude",
        AgentRpcKind::OpenCodeAcp => "OpenCode",
        _ => "ACP",
    };
    let cleaned = strip_ansi(message);
    let lower = cleaned.to_lowercase();
    if lower.contains("command not found") || lower.contains("not recognized") {
        return Some(format!(
            "{} CLI not found. Please ensure the CLI is installed and in PATH.",
            label
        ));
    }
    if lower.contains("permission denied") {
        return Some(format!("Permission denied when starting {}.", label));
    }
    if lower.contains("authentication") || lower.contains("unauthorized") || lower.contains("login") {
        let hint = match kind {
            AgentRpcKind::ClaudeAcp => "Please run `claude /login`.",
        AgentRpcKind::OpenCodeAcp => "Please run `opencode auth login`.",
            _ => "",
        };
        let suffix = if hint.is_empty() { "".to_string() } else { format!(" {}", hint) };
        return Some(format!("{} authentication required.{}", label, suffix));
    }
    if lower.contains("timed out") || lower.contains("timeout") {
        return Some(format!("{} request timed out. Please check network and auth.", label));
    }
    if let Some(error) = classify_http_error(&cleaned, label) {
        return Some(error);
    }
    None
}

fn codex_preflight(app: &tauri::AppHandle, session: &AgentRpcSession, request_id: &str) -> CmdResult<()> {
    emit_agent_status(app, request_id, "connecting");
    if let Some(err) = session
        .state
        .lock()
        .ok()
        .and_then(|state| state.startup_error.clone())
    {
        emit_agent_status(app, request_id, "error");
        return Err(err);
    }

    wait_for_codex_ready(session, 10, 250);

    let already_initialized = session
        .state
        .lock()
        .map(|state| state.initialized)
        .unwrap_or(false);
    if already_initialized {
        emit_agent_status(app, request_id, "session_active");
        return Ok(());
    }

    emit_agent_status(app, request_id, "authenticating");
    let client_name = app.package_info().name.clone();
    let client_version = app.package_info().version.to_string();
    let init_params = serde_json::json!({
        "protocolVersion": "1.0.0",
        "capabilities": {},
        "clientInfo": {
            "name": client_name,
            "version": client_version,
        }
    });

    let init_result = send_rpc_request(session, "initialize", init_params, None, true, 15);
    let init_ok = init_result.is_ok();
    if !init_ok {
        let tools_result = send_rpc_request(session, "tools/list", serde_json::json!({}), None, true, 10);
        if let Err(err) = tools_result {
            let message = classify_codex_error(&err).unwrap_or(err);
            emit_agent_status(app, request_id, "error");
            return Err(message);
        }
    }

    if let Ok(mut state) = session.state.lock() {
        state.initialized = true;
    }
    emit_agent_status(app, request_id, "authenticated");
    emit_agent_status(app, request_id, "session_active");
    Ok(())
}

fn run_cli_login(command: &str, args: &[&str]) -> CmdResult<()> {
    let mut child = Command::new(command)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(map_err)?;
    let start = Instant::now();
    let timeout = Duration::from_secs(70);
    loop {
        if let Some(status) = child.try_wait().map_err(map_err)? {
            if status.success() {
                return Ok(());
            }
            return Err(format!("Login command failed with status: {}", status));
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            return Err("Login command timed out".to_string());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn attempt_acp_login(kind: AgentRpcKind) -> CmdResult<()> {
    match kind {
        AgentRpcKind::ClaudeAcp => {
            if run_cli_login("claude", &["/login"]).is_ok() {
                return Ok(());
            }
            run_cli_login("npx", &["@anthropic-ai/claude-code", "/login"])?;
        }
        AgentRpcKind::OpenCodeAcp => {
            run_cli_login("opencode", &["auth", "login"])?;
        }
        _ => {}
    }
    Ok(())
}

fn probe_acp_auth(session: &AgentRpcSession, session_id: &str, kind: AgentRpcKind) -> CmdResult<()> {
    let params = serde_json::json!({
        "sessionId": session_id,
        "prompt": [{ "type": "text", "text": "ping" }]
    });
    let result = send_rpc_request(session, "session/prompt", params, None, true, 8);
    match result {
        Ok(_) => Ok(()),
        Err(err) => {
            let lower = err.to_lowercase();
            if lower.contains("timed out") || lower.contains("timeout") {
                return Ok(());
            }
            Err(classify_acp_error(&err, kind).unwrap_or(err))
        }
    }
}

fn acp_preflight(
    app: &tauri::AppHandle,
    session: &AgentRpcSession,
    request_id: &str,
    kind: AgentRpcKind,
    cwd: Option<String>,
) -> CmdResult<String> {
    emit_agent_status(app, request_id, "connecting");
    if let Some(err) = session
        .state
        .lock()
        .ok()
        .and_then(|state| state.startup_error.clone())
    {
        emit_agent_status(app, request_id, "error");
        return Err(err);
    }

    let existing_session_id = session
        .state
        .lock()
        .ok()
        .and_then(|state| state.session_id.clone());
    if let Some(session_id) = existing_session_id {
        if let Some(resolved) = resolve_agent_cwd(cwd) {
            if let Ok(mut state) = session.state.lock() {
                state.cwd = Some(resolved);
            }
        }
        emit_agent_status(app, request_id, "session_active");
        return Ok(session_id);
    }

    let init_params = serde_json::json!({
        "protocolVersion": 1,
        "clientCapabilities": {
            "fs": {
                "readTextFile": true,
                "writeTextFile": true,
            }
        }
    });

    let init_result = send_rpc_request(session, "initialize", init_params, None, true, 60);
    let init_value = match init_result {
        Ok(value) => value,
        Err(err) => {
            let message = classify_acp_error(&err, kind).unwrap_or(err);
            emit_agent_status(app, request_id, "error");
            return Err(message);
        }
    };
    emit_agent_status(app, request_id, "connected");

    let has_auth_methods = init_value
        .as_ref()
        .and_then(|val| val.get("authMethods"))
        .and_then(|val| val.as_array())
        .map(|methods| !methods.is_empty())
        .unwrap_or(false);

    if has_auth_methods {
        let auth_method_id = init_value
            .as_ref()
            .and_then(|val| val.get("authMethods"))
            .and_then(|val| val.as_array())
            .and_then(|methods| {
                methods.iter().find_map(|method| {
                    method
                        .get("methodId")
                        .or_else(|| method.get("id"))
                        .or_else(|| method.get("type"))
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                })
            });
        let auth_params = auth_method_id
            .map(|method_id| serde_json::json!({ "methodId": method_id }))
            .unwrap_or_else(|| serde_json::json!({}));
        let auth_result = send_rpc_request(session, "authenticate", auth_params.clone(), None, true, 60);
        if let Err(err) = auth_result {
            let lower = err.to_lowercase();
            let can_ignore = lower.contains("method not found")
                || lower.contains("unknown method")
                || lower.contains("no such method")
                || lower.contains("not implemented");
            if !can_ignore {
                let _ = attempt_acp_login(kind);
                let retry = send_rpc_request(session, "authenticate", auth_params, None, true, 60);
                if let Err(err) = retry {
                    let message = classify_acp_error(&err, kind).unwrap_or(err);
                    emit_agent_status(app, request_id, "error");
                    return Err(message);
                }
            }
        }
    }

    let cwd_value = resolve_agent_cwd(cwd).unwrap_or_else(|| ".".to_string());
    let session_params = serde_json::json!({ "cwd": cwd_value, "mcpServers": [] });
    let session_result = send_rpc_request(session, "session/new", session_params, None, true, 60);
    let session_value = match session_result {
        Ok(value) => value,
        Err(err) => {
            if has_auth_methods {
                let _ = attempt_acp_login(kind);
                let retry_params = serde_json::json!({ "cwd": cwd_value, "mcpServers": [] });
                let retry_result =
                    send_rpc_request(session, "session/new", retry_params, None, true, 60);
                match retry_result {
                    Ok(value) => value,
                    Err(err) => {
                        let message = classify_acp_error(&err, kind).unwrap_or(err);
                        emit_agent_status(app, request_id, "error");
                        return Err(message);
                    }
                }
            } else {
                let message = classify_acp_error(&err, kind).unwrap_or(err);
                emit_agent_status(app, request_id, "error");
                return Err(message);
            }
        }
    };

    if let Some(models) = session_value
        .as_ref()
        .and_then(|val| val.get("models"))
        .cloned()
    {
        emit_agent_event(
            app,
            request_id,
            AgentStreamEvent {
                models: Some(models),
                ..Default::default()
            },
        );
    }

    let Some(session_id) = session_value
        .as_ref()
        .and_then(|val| val.get("sessionId").and_then(|v| v.as_str()).map(|s| s.to_string()))
    else {
        emit_agent_status(app, request_id, "error");
        return Err("ACP session did not return a sessionId".to_string());
    };

    if let Ok(mut state) = session.state.lock() {
        state.session_id = Some(session_id.clone());
        state.cwd = Some(cwd_value.clone());
        state.initialized = true;
    }

    if matches!(kind, AgentRpcKind::ClaudeAcp | AgentRpcKind::OpenCodeAcp) {
        if let Err(err) = probe_acp_auth(session, &session_id, kind) {
            emit_agent_status(app, request_id, "error");
            if let Ok(mut state) = session.state.lock() {
                state.session_id = None;
                state.initialized = false;
            }
            return Err(err);
        }
    }

    emit_agent_status(app, request_id, "authenticated");
    emit_agent_status(app, request_id, "session_active");
    Ok(session_id)
}

fn wait_for_codex_ready(session: &AgentRpcSession, attempts: u32, delay_ms: u64) {
    for _ in 0..attempts {
        if send_rpc_request(
            session,
            "ping",
            serde_json::json!({}),
            None,
            true,
            3,
        )
        .is_ok()
        {
            return;
        }
        std::thread::sleep(Duration::from_millis(delay_ms));
    }
}

fn spawn_agent_rpc_session(
    app: tauri::AppHandle,
    kind: AgentRpcKind,
    cwd: Option<String>,
    model: Option<String>,
) -> CmdResult<Arc<AgentRpcSession>> {
    let mut cmd = match kind {
        AgentRpcKind::CodexMcp => {
            let mut cmd = Command::new("codex");
            for arg in detect_codex_mcp_args() {
                cmd.arg(arg);
            }
            if let Some(model) = model.as_ref() {
                let trimmed = model.trim();
                if !trimmed.is_empty() {
                    cmd.arg("-c").arg(format!("model=\"{}\"", trimmed));
                }
            }
            cmd.env("CODEX_NO_INTERACTIVE", "1")
                .env("CODEX_AUTO_CONTINUE", "1");
            cmd
        }
        AgentRpcKind::ClaudeAcp => {
            let mut cmd = Command::new("npx");
            cmd.arg("@zed-industries/claude-code-acp");
            cmd
        }
        AgentRpcKind::OpenCodeAcp => {
            let mut cmd = Command::new("opencode");
            cmd.arg("acp");
            cmd
        }
    };

    if let Some(cwd) = cwd.as_ref() {
        if !cwd.trim().is_empty() {
            cmd.current_dir(cwd);
        }
    }

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|err| {
        match kind {
            AgentRpcKind::CodexMcp => match err.kind() {
                ErrorKind::NotFound => {
                    return "Codex CLI not found. Please ensure 'codex' is installed and in PATH."
                        .to_string();
                }
                ErrorKind::PermissionDenied => {
                    return "Permission denied when starting Codex.".to_string();
                }
                _ => {}
            },
            AgentRpcKind::ClaudeAcp => match err.kind() {
                ErrorKind::NotFound => {
                    return "npx not found. Please install Node.js/npm to run Claude ACP."
                        .to_string();
                }
                ErrorKind::PermissionDenied => {
                    return "Permission denied when starting Claude ACP.".to_string();
                }
                _ => {}
            },
            AgentRpcKind::OpenCodeAcp => match err.kind() {
                ErrorKind::NotFound => {
                    return "OpenCode CLI not found. Please ensure 'opencode' is installed and in PATH."
                        .to_string();
                }
                ErrorKind::PermissionDenied => {
                    return "Permission denied when starting OpenCode ACP.".to_string();
                }
                _ => {}
            },
        }
        map_err(err)
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;
    let stderr = child.stderr.take();

    let session = Arc::new(AgentRpcSession {
        kind,
        child: Arc::new(Mutex::new(child)),
        stdin: Arc::new(Mutex::new(stdin)),
        state: Arc::new(Mutex::new(AgentRpcState {
            pending_responses: HashMap::new(),
            request_map: HashMap::new(),
            active_request: None,
            session_id: None,
            model: model.clone(),
            cwd: None,
            conversation_id: None,
            initialized: false,
            codex_session_started: false,
            codex_received_delta: false,
            codex_elicitation_map: HashMap::new(),
            codex_patch_changes: HashMap::new(),
            acp_permission_map: HashMap::new(),
            startup_error: None,
        })),
        next_id: AtomicU64::new(1),
    });

    let app_for_stdout = app.clone();
    let state_for_stdout = session.state.clone();
    let stdin_for_stdout = session.stdin.clone();
    let kind_for_stdout = session.kind;

    if let Some(stderr) = stderr {
        let app_for_stderr = app.clone();
        let state_for_stderr = session.state.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                match kind_for_stdout {
                    AgentRpcKind::CodexMcp => {
                        eprintln!("[codex mcp] {}", line);
                        if let Some(message) = classify_codex_error(&line) {
                            let active_request = state_for_stderr
                                .lock()
                                .ok()
                                .and_then(|state| state.active_request.clone());
                            if let Some(request_id) = active_request {
                                emit_agent_error(&app_for_stderr, &request_id, message);
                                if let Ok(mut state) = state_for_stderr.lock() {
                                    state.active_request = None;
                                }
                            } else if let Ok(mut state) = state_for_stderr.lock() {
                                state.startup_error = Some(message);
                            }
                        }
                    }
                    AgentRpcKind::ClaudeAcp => {
                        eprintln!("[claude acp] {}", line);
                        if let Some(message) = classify_acp_error(&line, AgentRpcKind::ClaudeAcp) {
                            let active_request = state_for_stderr
                                .lock()
                                .ok()
                                .and_then(|state| state.active_request.clone());
                            if let Some(request_id) = active_request {
                                emit_agent_error(&app_for_stderr, &request_id, message);
                                if let Ok(mut state) = state_for_stderr.lock() {
                                    state.active_request = None;
                                }
                            } else if let Ok(mut state) = state_for_stderr.lock() {
                                state.startup_error = Some(message);
                            }
                        }
                    }
                    AgentRpcKind::OpenCodeAcp => {
                        eprintln!("[opencode acp] {}", line);
                        if let Some(message) = classify_acp_error(&line, AgentRpcKind::OpenCodeAcp) {
                            let active_request = state_for_stderr
                                .lock()
                                .ok()
                                .and_then(|state| state.active_request.clone());
                            if let Some(request_id) = active_request {
                                emit_agent_error(&app_for_stderr, &request_id, message);
                                if let Ok(mut state) = state_for_stderr.lock() {
                                    state.active_request = None;
                                }
                            } else if let Ok(mut state) = state_for_stderr.lock() {
                                state.startup_error = Some(message);
                            }
                        }
                    }
                }
            }
        });
    }

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let parsed = serde_json::from_str::<serde_json::Value>(trimmed).ok();
            if parsed.is_none() {
                if kind_for_stdout == AgentRpcKind::CodexMcp {
                    if trimmed.contains("Press Enter to continue")
                        || trimmed.contains("Launching Codex CLI")
                    {
                        if let Ok(mut stdin) = stdin_for_stdout.lock() {
                            let _ = stdin.write_all(b"\n");
                            stdin.flush().ok();
                        }
                    }
                }
                if let Some(request_id) = state_for_stdout
                    .lock()
                    .ok()
                    .and_then(|state| state.active_request.clone())
                {
                    emit_agent_event(
                        &app_for_stdout,
                        &request_id,
                        AgentStreamEvent {
                            content: Some(trimmed.to_string()),
                            ..Default::default()
                        },
                    );
                }
                continue;
            }
            let value = parsed.unwrap();

            let response_id = value.get("id").and_then(|v| v.as_u64());
            let is_response = response_id.is_some()
                && (value.get("result").is_some() || value.get("error").is_some());
            if let Some(id) = response_id {
                if is_response {
                    if let Some(tx) = state_for_stdout
                        .lock()
                        .ok()
                        .and_then(|mut state| state.pending_responses.remove(&id))
                    {
                        let result = if value.get("error").is_some() {
                            Err(value["error"].to_string())
                        } else {
                            Ok(value.get("result").cloned().unwrap_or(serde_json::Value::Null))
                        };
                        let _ = tx.send(result);
                    }

                    let request_id = state_for_stdout
                        .lock()
                        .ok()
                        .and_then(|mut state| state.request_map.remove(&id));
                    if let Some(request_id) = request_id {
                        // 对于所有 Agent 类型，如果收到错误响应，都需要发送错误事件
                        let has_error = value.get("error").is_some();
                        if has_error {
                            let error_msg = value.get("error")
                                .map(|e| {
                                    // 尝试提取更有意义的错误信息
                                    if let Some(msg) = e.get("message").and_then(|m| m.as_str()) {
                                        msg.to_string()
                                    } else {
                                        e.to_string()
                                    }
                                })
                                .unwrap_or_else(|| "Unknown error".to_string());
                            emit_agent_error(&app_for_stdout, &request_id, error_msg);
                            if let Ok(mut state) = state_for_stdout.lock() {
                                state.active_request = None;
                            }
                        } else if kind_for_stdout != AgentRpcKind::CodexMcp {
                            emit_agent_event(
                                &app_for_stdout,
                                &request_id,
                                AgentStreamEvent {
                                    done: Some(true),
                                    ..Default::default()
                                },
                            );
                            if let Ok(mut state) = state_for_stdout.lock() {
                                state.active_request = None;
                            }
                        }
                    }
                    continue;
                }
            }

            if let Some(method) = value.get("method").and_then(|v| v.as_str()) {
                match (kind_for_stdout, method) {
                    (AgentRpcKind::ClaudeAcp | AgentRpcKind::OpenCodeAcp, "session/request_permission") => {
                        let request_id = value.get("id").and_then(|v| v.as_u64());
                        let params = value.get("params");
                        let call_id = params
                            .and_then(|p| p.get("toolCall"))
                            .and_then(|t| {
                                t.get("toolCallId")
                                    .or_else(|| t.get("tool_call_id"))
                                    .or_else(|| t.get("call_id"))
                                    .or_else(|| t.get("id"))
                            })
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        if let (Some(request_id), Some(call_id)) = (request_id, call_id.clone()) {
                            if let Ok(mut state) = state_for_stdout.lock() {
                                state.acp_permission_map.insert(call_id.clone(), request_id);
                            }
                        }
                        if let (Some(call_id), Some(active_request)) = (
                            call_id,
                            state_for_stdout
                                .lock()
                                .ok()
                                .and_then(|state| state.active_request.clone()),
                        ) {
                            emit_agent_event(
                                &app_for_stdout,
                                &active_request,
                                AgentStreamEvent {
                                    permission: Some(serde_json::json!({
                                        "source": "acp",
                                        "callId": call_id,
                                        "toolCall": params.and_then(|p| p.get("toolCall")).cloned(),
                                        "options": params.and_then(|p| p.get("options")).cloned(),
                                    })),
                                    ..Default::default()
                                },
                            );
                        }
                    }
                    (AgentRpcKind::ClaudeAcp | AgentRpcKind::OpenCodeAcp, "fs/read_text_file") => {
                        if let Some(request_id) = response_id {
                            let cwd = state_for_stdout
                                .lock()
                                .ok()
                                .and_then(|state| state.cwd.clone());
                            let result = handle_fs_read(value.get("params"), cwd);
                            let _ = send_rpc_response(&stdin_for_stdout, request_id, result);
                        }
                    }
                    (AgentRpcKind::ClaudeAcp | AgentRpcKind::OpenCodeAcp, "fs/write_text_file") => {
                        if let Some(request_id) = response_id {
                            let cwd = state_for_stdout
                                .lock()
                                .ok()
                                .and_then(|state| state.cwd.clone());
                            let result = handle_fs_write(value.get("params"), cwd);
                            let _ = send_rpc_response(&stdin_for_stdout, request_id, result);
                        }
                    }
                    (AgentRpcKind::CodexMcp, "codex/event") => {
                        if let Some(msg) = value.get("params").and_then(|p| p.get("msg")) {
                            if let Some(msg_type) = msg.get("type").and_then(|t| t.as_str()) {
                                if msg_type == "agent_message_delta" {
                                    if let Some(delta) = msg.get("delta").and_then(|d| d.as_str()) {
                                        if let Some(request_id) = state_for_stdout
                                            .lock()
                                            .ok()
                                            .and_then(|mut state| {
                                                state.codex_received_delta = true;
                                                state.active_request.clone()
                                            })
                                        {
                                            emit_agent_event(
                                                &app_for_stdout,
                                                &request_id,
                                                AgentStreamEvent {
                                                    content: Some(delta.to_string()),
                                                    ..Default::default()
                                                },
                                            );
                                        }
                                    }
                                }

                                if msg_type == "agent_reasoning_delta" {
                                    if let Some(delta) = msg.get("delta").and_then(|d| d.as_str()) {
                                        if let Some(request_id) = state_for_stdout
                                            .lock()
                                            .ok()
                                            .and_then(|state| state.active_request.clone())
                                        {
                                            emit_agent_event(
                                                &app_for_stdout,
                                                &request_id,
                                                AgentStreamEvent {
                                                    reasoning: Some(delta.to_string()),
                                                    ..Default::default()
                                                },
                                            );
                                        }
                                    }
                                }

                                if msg_type == "task_started" {
                                    if let Some(request_id) = state_for_stdout
                                        .lock()
                                        .ok()
                                        .and_then(|state| state.active_request.clone())
                                    {
                                        emit_agent_event(
                                            &app_for_stdout,
                                            &request_id,
                                            AgentStreamEvent {
                                                status: Some("task_started".to_string()),
                                                ..Default::default()
                                            },
                                        );
                                    }
                                }

                                if msg_type == "exec_approval_request"
                                    || msg_type == "apply_patch_approval_request"
                                {
                                    let call_id = msg
                                        .get("call_id")
                                        .and_then(|v| v.as_str())
                                        .or_else(|| msg.get("codex_call_id").and_then(|v| v.as_str()))
                                        .map(|s| s.to_string());

                                    if let Some(call_id) = call_id.clone() {
                                        if let Some(req_id) = response_id {
                                            if let Ok(mut state) = state_for_stdout.lock() {
                                                state.codex_elicitation_map.insert(call_id.clone(), req_id);
                                            }
                                        }

                                        if msg_type == "apply_patch_approval_request" {
                                            if let Some(changes) = msg
                                                .get("changes")
                                                .or_else(|| msg.get("codex_changes"))
                                                .cloned()
                                            {
                                                if let Ok(mut state) = state_for_stdout.lock() {
                                                    state.codex_patch_changes.insert(call_id.clone(), changes);
                                                }
                                            }
                                        }

                                        if let Some(request_id) = state_for_stdout
                                            .lock()
                                            .ok()
                                            .and_then(|state| state.active_request.clone())
                                        {
                                            emit_agent_event(
                                                &app_for_stdout,
                                                &request_id,
                                                AgentStreamEvent {
                                                    permission: Some(serde_json::json!({
                                                        "type": msg_type,
                                                        "callId": call_id,
                                                        "data": msg,
                                                    })),
                                                    ..Default::default()
                                                },
                                            );
                                        }
                                    }
                                }

                                if msg_type == "exec_command_begin"
                                    || msg_type == "exec_command_output_delta"
                                    || msg_type == "exec_command_end"
                                    || msg_type == "patch_apply_begin"
                                    || msg_type == "patch_apply_end"
                                    || msg_type == "mcp_tool_call_begin"
                                    || msg_type == "mcp_tool_call_end"
                                {
                                    if let Some(call_id) = msg
                                        .get("call_id")
                                        .and_then(|v| v.as_str())
                                        .or_else(|| msg.get("codex_call_id").and_then(|v| v.as_str()))
                                    {
                                        if let Some(request_id) = state_for_stdout
                                            .lock()
                                            .ok()
                                            .and_then(|state| state.active_request.clone())
                                        {
                                            emit_agent_event(
                                                &app_for_stdout,
                                                &request_id,
                                                AgentStreamEvent {
                                                    tool: Some(serde_json::json!({
                                                        "type": msg_type,
                                                        "callId": call_id,
                                                        "data": msg,
                                                    })),
                                                    ..Default::default()
                                                },
                                            );
                                        }
                                    }
                                }

                                if msg_type == "agent_message" {
                                    if let Some(message) = msg.get("message").and_then(|m| m.as_str()) {
                                        if let Some(request_id) = state_for_stdout
                                            .lock()
                                            .ok()
                                            .and_then(|state| {
                                                if state.codex_received_delta {
                                                    None
                                                } else {
                                                    state.active_request.clone()
                                                }
                                            })
                                        {
                                            emit_agent_event(
                                                &app_for_stdout,
                                                &request_id,
                                                AgentStreamEvent {
                                                    content: Some(message.to_string()),
                                                    ..Default::default()
                                                },
                                            );
                                        }
                                    }
                                }

                                if msg_type == "task_complete" {
                                    if let Some(request_id) = state_for_stdout
                                        .lock()
                                        .ok()
                                        .and_then(|mut state| {
                                            state.codex_received_delta = false;
                                            state.active_request.clone()
                                        })
                                    {
                                        emit_agent_event(
                                            &app_for_stdout,
                                            &request_id,
                                            AgentStreamEvent {
                                                done: Some(true),
                                                ..Default::default()
                                            },
                                        );
                                        if let Ok(mut state) = state_for_stdout.lock() {
                                            state.active_request = None;
                                        }
                                    }
                                }

                                if msg_type == "session_configured" {
                                    if let Some(session_id) = msg.get("session_id").and_then(|s| s.as_str()) {
                                        if let Ok(mut state) = state_for_stdout.lock() {
                                            state.conversation_id = Some(session_id.to_string());
                                            state.codex_session_started = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    (AgentRpcKind::ClaudeAcp, "session/update")
                    | (AgentRpcKind::OpenCodeAcp, "session/update") => {
                        if let Some(update) = value.get("params") {
                            if let Some(session_update) = update
                                .get("update")
                                .and_then(|u| u.get("sessionUpdate"))
                                .and_then(|u| u.as_str())
                            {
                                if session_update == "agent_message_chunk" {
                                    if let Some(text) = update
                                        .get("update")
                                        .and_then(|u| u.get("content"))
                                        .and_then(|c| c.get("text"))
                                        .and_then(|t| t.as_str())
                                    {
                                        if let Some(request_id) = state_for_stdout
                                            .lock()
                                            .ok()
                                            .and_then(|state| state.active_request.clone())
                                        {
                                            emit_agent_event(
                                                &app_for_stdout,
                                                &request_id,
                                                AgentStreamEvent {
                                                    content: Some(text.to_string()),
                                                    ..Default::default()
                                                },
                                            );
                                        }
                                    }
                                } else if session_update == "agent_thought_chunk" {
                                    if let Some(text) = update
                                        .get("update")
                                        .and_then(|u| u.get("content"))
                                        .and_then(|c| c.get("text"))
                                        .and_then(|t| t.as_str())
                                    {
                                        if let Some(request_id) = state_for_stdout
                                            .lock()
                                            .ok()
                                            .and_then(|state| state.active_request.clone())
                                        {
                                            emit_agent_event(
                                                &app_for_stdout,
                                                &request_id,
                                                AgentStreamEvent {
                                                    reasoning: Some(text.to_string()),
                                                    ..Default::default()
                                                },
                                            );
                                        }
                                    }
                                } else if session_update == "tool_call" || session_update == "tool_call_update" {
                                    if let Some(call_id) = update
                                        .get("update")
                                        .and_then(|u| {
                                            u.get("toolCallId")
                                                .or_else(|| u.get("tool_call_id"))
                                                .or_else(|| u.get("call_id"))
                                                .or_else(|| u.get("id"))
                                        })
                                        .and_then(|v| v.as_str())
                                    {
                                        if let Some(request_id) = state_for_stdout
                                            .lock()
                                            .ok()
                                            .and_then(|state| state.active_request.clone())
                                        {
                                            emit_agent_event(
                                                &app_for_stdout,
                                                &request_id,
                                                AgentStreamEvent {
                                                    tool: Some(serde_json::json!({
                                                        "type": session_update,
                                                        "callId": call_id,
                                                        "data": update,
                                                    })),
                                                    ..Default::default()
                                                },
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        if let Some(request_id) = state_for_stdout
            .lock()
            .ok()
            .and_then(|state| state.active_request.clone())
        {
            emit_agent_event(
                &app_for_stdout,
                &request_id,
                AgentStreamEvent {
                    done: Some(true),
                    ..Default::default()
                },
            );
        }
    });

    Ok(session)
}

fn send_rpc_request(
    session: &AgentRpcSession,
    method: &str,
    params: serde_json::Value,
    request_id: Option<String>,
    wait_response: bool,
    timeout_secs: u64,
) -> CmdResult<Option<serde_json::Value>> {
    let id = session.next_id.fetch_add(1, Ordering::Relaxed);
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });
    let line = format!("{}\n", payload.to_string());

    let mut rx = None;
    if wait_response {
        let (tx, receiver) = mpsc::channel();
        if let Ok(mut state) = session.state.lock() {
            state.pending_responses.insert(id, tx);
        }
        rx = Some(receiver);
    }

    if let Some(request_id) = request_id {
        if let Ok(mut state) = session.state.lock() {
            state.request_map.insert(id, request_id.clone());
            state.active_request = Some(request_id);
            state.codex_received_delta = false;
        }
    }

    {
        let mut stdin = session.stdin.lock().map_err(map_err)?;
        stdin.write_all(line.as_bytes()).map_err(map_err)?;
        stdin.flush().ok();
    }

    if let Some(receiver) = rx {
        let result = receiver
            .recv_timeout(Duration::from_secs(timeout_secs))
            .map_err(|_| "RPC request timed out".to_string())?;
        return result.map(Some).map_err(|e| e);
    }

    Ok(None)
}

fn send_rpc_response(
    stdin: &Arc<Mutex<std::process::ChildStdin>>,
    id: u64,
    result: Result<serde_json::Value, String>,
) -> CmdResult<()> {
    let payload = match result {
        Ok(value) => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": value,
        }),
        Err(message) => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32603,
                "message": message,
            }
        }),
    };
    let line = format!("{}\n", payload);
    let mut stdin = stdin.lock().map_err(map_err)?;
    stdin.write_all(line.as_bytes()).map_err(map_err)?;
    stdin.flush().map_err(map_err)?;
    Ok(())
}

fn handle_fs_read(
    params: Option<&serde_json::Value>,
    cwd: Option<String>,
) -> Result<serde_json::Value, String> {
    let params = params.ok_or_else(|| "Missing params".to_string())?;
    let path = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing path".to_string())?;
    let line = params.get("line").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
    let limit = params.get("limit").and_then(|v| v.as_u64()).map(|v| v as usize);
    let resolved = resolve_fs_path(cwd, path);
    let content = std::fs::read_to_string(&resolved).map_err(map_err)?;
    if line <= 1 && limit.is_none() {
        return Ok(serde_json::json!({ "content": content }));
    }
    let lines: Vec<&str> = content.lines().collect();
    let start = line.saturating_sub(1);
    let end = limit.map(|l| start.saturating_add(l)).unwrap_or(lines.len());
    let slice = if start >= lines.len() {
        String::new()
    } else {
        lines[start..std::cmp::min(end, lines.len())].join("\n")
    };
    Ok(serde_json::json!({ "content": slice }))
}

fn handle_fs_write(
    params: Option<&serde_json::Value>,
    cwd: Option<String>,
) -> Result<serde_json::Value, String> {
    let params = params.ok_or_else(|| "Missing params".to_string())?;
    let path = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing path".to_string())?;
    let content = params
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing content".to_string())?;
    let resolved = resolve_fs_path(cwd, path);
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent).map_err(map_err)?;
    }
    std::fs::write(&resolved, content).map_err(map_err)?;
    Ok(serde_json::json!({}))
}

fn resolve_fs_path(cwd: Option<String>, path: &str) -> PathBuf {
    let input = PathBuf::from(path);
    if input.is_absolute() {
        return input;
    }
    if let Some(cwd) = cwd {
        return PathBuf::from(cwd).join(input);
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(input)
}

fn default_agent_cwd() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let path = PathBuf::from(home).join(".opencontext");
    if std::fs::create_dir_all(&path).is_err() {
        return None;
    }
    let agents_path = path.join("AGENTS.md");
    if !agents_path.exists() {
        let _ = std::fs::write(&agents_path, DEFAULT_AGENTS_MD);
    }
    Some(path.to_string_lossy().to_string())
}

fn resolve_agent_cwd(cwd: Option<String>) -> Option<String> {
    let trimmed = cwd.as_deref().map(str::trim).unwrap_or("");
    if !trimmed.is_empty() {
        return Some(trimmed.to_string());
    }
    default_agent_cwd()
}

fn try_set_acp_model(
    session: &AgentRpcSession,
    session_id: &str,
    model: &str,
) -> CmdResult<()> {
    let params = serde_json::json!({
        "sessionId": session_id,
        "modelId": model,
    });
    if let Err(err) = send_rpc_request(session, "session/set_model", params, None, true, 30) {
        let lower = err.to_lowercase();
        let can_ignore = lower.contains("method not found")
            || lower.contains("unknown method")
            || lower.contains("no such method")
            || lower.contains("not implemented");
        if !can_ignore {
            return Err(err);
        }
    }
    Ok(())
}

fn respond_elicitation(session: &AgentRpcSession, call_id: &str, decision: &str) -> CmdResult<()> {
    let normalized = call_id
        .trim_start_matches("patch_")
        .trim_start_matches("elicitation_")
        .to_string();
    let req_id = {
        let mut state = session.state.lock().map_err(map_err)?;
        state
            .codex_elicitation_map
            .remove(call_id)
            .or_else(|| state.codex_elicitation_map.remove(&normalized))
    };

    let Some(req_id) = req_id else {
        return Ok(());
    };

    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": req_id,
        "result": {
            "decision": decision,
        }
    });
    let line = format!("{}\n", payload.to_string());

    let mut stdin = session.stdin.lock().map_err(map_err)?;
    stdin.write_all(line.as_bytes()).map_err(map_err)?;
    stdin.flush().ok();
    Ok(())
}

fn parse_model_list(value: Option<&serde_json::Value>) -> Vec<String> {
    match value {
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .filter_map(|item| item.as_str())
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect(),
        Some(serde_json::Value::String(text)) => text
            .lines()
            .flat_map(|line| line.split(','))
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

fn set_model_list_key(
    config: &mut HashMap<String, serde_json::Value>,
    key: &str,
    models: Option<Vec<String>>,
) {
    let models = models.unwrap_or_default();
    let cleaned: Vec<String> = models
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    if cleaned.is_empty() {
        config.remove(key);
    } else {
        config.insert(
            key.to_string(),
            serde_json::Value::Array(cleaned.into_iter().map(serde_json::Value::String).collect()),
        );
    }
}

fn get_or_create_rpc_session(
    app: tauri::AppHandle,
    state: State<AppState>,
    session_id: &str,
    kind: AgentRpcKind,
    cwd: Option<String>,
    model: Option<String>,
) -> CmdResult<Arc<AgentRpcSession>> {
    let existing = {
        let sessions = state.agent_rpc_sessions.lock().map_err(map_err)?;
        sessions.get(session_id).cloned()
    };

    if let Some(session) = existing {
        let desired = model
            .as_ref()
            .map(|m| m.trim().to_string())
            .filter(|m| !m.is_empty());
        if matches!(kind, AgentRpcKind::CodexMcp) {
            let current = session
                .state
                .lock()
                .ok()
                .and_then(|state| state.model.clone());
            if let Some(desired_model) = desired {
                if current.as_deref() != Some(desired_model.as_str()) {
                    if let Ok(mut child) = session.child.lock() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                    let mut sessions = state.agent_rpc_sessions.lock().map_err(map_err)?;
                    sessions.remove(session_id);
                } else {
                    return Ok(session);
                }
            } else {
                return Ok(session);
            }
        } else {
            return Ok(session);
        }
    }

    let session = spawn_agent_rpc_session(app, kind, cwd, model)?;
    let mut sessions = state.agent_rpc_sessions.lock().map_err(map_err)?;
    sessions.insert(session_id.to_string(), session.clone());
    Ok(session)
}

fn stop_rpc_stream(app: tauri::AppHandle, state: State<AppState>, session_id: &str) -> CmdResult<()> {
    let session = {
        let sessions = state.agent_rpc_sessions.lock().map_err(map_err)?;
        sessions.get(session_id).cloned()
    };

    if let Some(session) = session {
        if let Ok(mut state) = session.state.lock() {
            if let Some(request_id) = state.active_request.take() {
                state.request_map.retain(|_, v| v != &request_id);
                state.codex_received_delta = false;
                state.acp_permission_map.clear();
                emit_agent_event(
                    &app,
                    &request_id,
                    AgentStreamEvent {
                        done: Some(true),
                        status: Some("stopped".to_string()),
                        ..Default::default()
                    },
                );
            }
        }
    }

    Ok(())
}

#[derive(Deserialize)]
pub(crate) struct CodexExecOptions {
    messages: Vec<crate::chat::ChatMessage>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: String,
    model: Option<String>,
    cwd: Option<String>,
}

#[tauri::command]
pub(crate) fn codex_exec(
    app: tauri::AppHandle,
    state: State<AppState>,
    options: CodexExecOptions,
) -> CmdResult<serde_json::Value> {
    let request_id = options.request_id.unwrap_or_else(|| {
        format!(
            "agent-{}",
            AGENT_COUNTER.fetch_add(1, Ordering::Relaxed)
        )
    });

    let session_id = options.session_id.clone();
    let cwd = resolve_agent_cwd(options.cwd.clone());
    let model = options.model.clone();

    let session = get_or_create_rpc_session(
        app.clone(),
        state,
        &session_id,
        AgentRpcKind::CodexMcp,
        cwd.clone(),
        model,
    )?;

    let app_clone = app.clone();
    let request_id_clone = request_id.clone();

    std::thread::spawn(move || {
        if let Err(err) = codex_preflight(&app_clone, &session, &request_id_clone) {
            emit_agent_error(&app_clone, &request_id_clone, err);
            return;
        }
        let prompt = build_cli_prompt(&options.messages);
        let (conversation_id, use_reply) = {
            let mut state = session.state.lock().unwrap_or_else(|err| err.into_inner());
            let conversation_id = state
                .conversation_id
                .clone()
                .unwrap_or_else(|| {
                    let id = session_id.clone();
                    state.conversation_id = Some(id.clone());
                    id
                });
            let use_reply = state.codex_session_started;
            if !state.codex_session_started {
                state.codex_session_started = true;
            }
            (conversation_id, use_reply)
        };

        let mut args = serde_json::Map::new();
        args.insert("prompt".to_string(), serde_json::Value::String(prompt));
        if let Some(cwd) = cwd.clone() {
            if !cwd.trim().is_empty() {
                args.insert("cwd".to_string(), serde_json::Value::String(cwd));
            }
        }

        let params = if use_reply {
            args.insert(
                "conversationId".to_string(),
                serde_json::Value::String(conversation_id.clone()),
            );
            serde_json::json!({
                "name": "codex-reply",
                "arguments": serde_json::Value::Object(args),
            })
        } else {
            serde_json::json!({
                "name": "codex",
                "arguments": serde_json::Value::Object(args),
                "config": {
                    "conversationId": conversation_id,
                }
            })
        };

        if let Err(err) = send_rpc_request(
            &session,
            "tools/call",
            params,
            Some(request_id_clone.clone()),
            false,
            600,
        ) {
            emit_agent_error(&app_clone, &request_id_clone, err);
        }
    });

    Ok(serde_json::json!({ "requestId": request_id }))
}

#[derive(Deserialize)]
pub(crate) struct CodexKillOptions {
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[tauri::command]
pub(crate) fn codex_kill(
    app: tauri::AppHandle,
    state: State<AppState>,
    options: CodexKillOptions,
) -> CmdResult<()> {
    stop_rpc_stream(app, state, &options.session_id)
}

#[derive(Deserialize)]
pub(crate) struct ClaudeExecOptions {
    messages: Vec<crate::chat::ChatMessage>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: String,
    model: Option<String>,
    cwd: Option<String>,
}

#[tauri::command]
pub(crate) fn claude_exec(
    app: tauri::AppHandle,
    state: State<AppState>,
    options: ClaudeExecOptions,
) -> CmdResult<serde_json::Value> {
    let request_id = options.request_id.unwrap_or_else(|| {
        format!(
            "agent-{}",
            AGENT_COUNTER.fetch_add(1, Ordering::Relaxed)
        )
    });

    let session_id = options.session_id.clone();
    let cwd = resolve_agent_cwd(options.cwd.clone());
    let model = options.model.clone();

    let session = get_or_create_rpc_session(
        app.clone(),
        state,
        &session_id,
        AgentRpcKind::ClaudeAcp,
        cwd.clone(),
        None,
    )?;

    let app_clone = app.clone();
    let request_id_clone = request_id.clone();

    std::thread::spawn(move || {
        let session_id = match acp_preflight(&app_clone, &session, &request_id_clone, AgentRpcKind::ClaudeAcp, cwd.clone()) {
            Ok(id) => id,
            Err(err) => {
                emit_agent_error(&app_clone, &request_id_clone, err);
                return;
            }
        };

        if let Some(model) = model {
            let trimmed = model.trim().to_string();
            if !trimmed.is_empty() {
                let _ = try_set_acp_model(&session, &session_id, &trimmed);
            }
        }

        let prompt = build_cli_prompt(&options.messages);
        let params = serde_json::json!({
            "sessionId": session_id,
            "prompt": [
                { "type": "text", "text": prompt }
            ]
        });

        if let Err(err) = send_rpc_request(
            &session,
            "session/prompt",
            params,
            Some(request_id_clone.clone()),
            false,
            300,
        ) {
            emit_agent_error(&app_clone, &request_id_clone, err);
        }
    });

    Ok(serde_json::json!({ "requestId": request_id }))
}

#[derive(Deserialize)]
pub(crate) struct ClaudeKillOptions {
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[tauri::command]
pub(crate) fn claude_kill(
    app: tauri::AppHandle,
    state: State<AppState>,
    options: ClaudeKillOptions,
) -> CmdResult<()> {
    stop_rpc_stream(app, state, &options.session_id)
}

#[derive(Deserialize)]
pub(crate) struct OpenCodeRunOptions {
    messages: Vec<crate::chat::ChatMessage>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: String,
    model: Option<String>,
    cwd: Option<String>,
}

#[tauri::command]
pub(crate) fn opencode_run(
    app: tauri::AppHandle,
    state: State<AppState>,
    options: OpenCodeRunOptions,
) -> CmdResult<serde_json::Value> {
    let request_id = options.request_id.unwrap_or_else(|| {
        format!(
            "agent-{}",
            AGENT_COUNTER.fetch_add(1, Ordering::Relaxed)
        )
    });

    let session_id = options.session_id.clone();
    let cwd = resolve_agent_cwd(options.cwd.clone());
    let model = options.model.clone();

    let session = get_or_create_rpc_session(
        app.clone(),
        state,
        &session_id,
        AgentRpcKind::OpenCodeAcp,
        cwd.clone(),
        None,
    )?;

    let app_clone = app.clone();
    let request_id_clone = request_id.clone();

    std::thread::spawn(move || {
        let session_id = match acp_preflight(&app_clone, &session, &request_id_clone, AgentRpcKind::OpenCodeAcp, cwd.clone()) {
            Ok(id) => id,
            Err(err) => {
                emit_agent_error(&app_clone, &request_id_clone, err);
                return;
            }
        };

        if let Some(model) = model {
            let trimmed = model.trim().to_string();
            if !trimmed.is_empty() {
                let _ = try_set_acp_model(&session, &session_id, &trimmed);
            }
        }

        let prompt = build_cli_prompt(&options.messages);
        let params = serde_json::json!({
            "sessionId": session_id,
            "prompt": [
                { "type": "text", "text": prompt }
            ]
        });

        if let Err(err) = send_rpc_request(
            &session,
            "session/prompt",
            params,
            Some(request_id_clone.clone()),
            false,
            300,
        ) {
            emit_agent_error(&app_clone, &request_id_clone, err);
        }
    });

    Ok(serde_json::json!({ "requestId": request_id }))
}

#[derive(Deserialize)]
pub(crate) struct OpenCodeKillOptions {
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[tauri::command]
pub(crate) fn opencode_kill(
    app: tauri::AppHandle,
    state: State<AppState>,
    options: OpenCodeKillOptions,
) -> CmdResult<()> {
    stop_rpc_stream(app, state, &options.session_id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPreflightOptions {
    session_id: String,
    agent_id: String,
    model: Option<String>,
    cwd: Option<String>,
}

#[tauri::command]
pub(crate) fn agent_preflight(
    app: tauri::AppHandle,
    state: State<AppState>,
    options: AgentPreflightOptions,
) -> CmdResult<bool> {
    let kind = match options.agent_id.as_str() {
        "codex" => AgentRpcKind::CodexMcp,
        "claude" => AgentRpcKind::ClaudeAcp,
        "opencode" => AgentRpcKind::OpenCodeAcp,
        other => return Err(format!("Unsupported agent: {}", other)),
    };

    let resolved_cwd = resolve_agent_cwd(options.cwd.clone());
    let session = get_or_create_rpc_session(
        app.clone(),
        state,
        &options.session_id,
        kind,
        resolved_cwd.clone(),
        options.model.clone(),
    )?;
    let request_id = format!("preflight-{}", options.session_id);
    let cwd = resolved_cwd.clone();
    let app_clone = app.clone();

    std::thread::spawn(move || {
        let result = match kind {
            AgentRpcKind::CodexMcp => codex_preflight(&app_clone, &session, &request_id).map(|_| None),
            AgentRpcKind::ClaudeAcp | AgentRpcKind::OpenCodeAcp => {
                acp_preflight(&app_clone, &session, &request_id, kind, cwd).map(Some)
            }
        };

        match result {
            Ok(session_id) => {
                if let Some(model) = options.model.clone() {
                    let trimmed = model.trim().to_string();
                    if !trimmed.is_empty() {
                        if let Some(session_id) = session_id.as_ref() {
                            let _ = try_set_acp_model(&session, session_id, &trimmed);
                        }
                    }
                }
                emit_agent_event(
                    &app_clone,
                    &request_id,
                    AgentStreamEvent {
                        done: Some(true),
                        ..Default::default()
                    },
                );
            }
            Err(err) => {
                emit_agent_error(&app_clone, &request_id, err);
            }
        }
    });

    Ok(true)
}

#[tauri::command]
pub(crate) fn agent_models_get() -> CmdResult<serde_json::Value> {
    let config_path = SearchConfig::json_config_path();
    if !config_path.exists() {
        return Ok(serde_json::json!({
            "codex": DEFAULT_CODEX_MODELS,
            "claude": []
        }));
    }
    let content = std::fs::read_to_string(&config_path).map_err(map_err)?;
    let config: serde_json::Value = serde_json::from_str(&content).map_err(map_err)?;
    let codex = {
        let parsed = parse_model_list(config.get("AGENT_MODELS_CODEX"));
        if parsed.is_empty() {
            DEFAULT_CODEX_MODELS.iter().map(|item| item.to_string()).collect()
        } else {
            parsed
        }
    };
    let claude = parse_model_list(config.get("AGENT_MODELS_CLAUDE"));
    Ok(serde_json::json!({ "codex": codex, "claude": claude }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentModelsSaveOptions {
    codex: Option<Vec<String>>,
    claude: Option<Vec<String>>,
}

#[tauri::command]
pub(crate) fn agent_models_save(
    options: AgentModelsSaveOptions,
) -> CmdResult<serde_json::Value> {
    let config_path = SearchConfig::json_config_path();
    let mut config: HashMap<String, serde_json::Value> = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path).map_err(map_err)?;
        serde_json::from_str(&content).map_err(map_err)?
    } else {
        HashMap::new()
    };

    set_model_list_key(&mut config, "AGENT_MODELS_CODEX", options.codex);
    set_model_list_key(&mut config, "AGENT_MODELS_CLAUDE", options.claude);

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(map_err)?;
    }
    let content = serde_json::to_string_pretty(&config).map_err(map_err)?;
    std::fs::write(&config_path, content).map_err(map_err)?;
    Ok(serde_json::json!({ "config_path": config_path.to_string_lossy() }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcExecOptions {
    args: Vec<String>,
    cwd: Option<String>,
}

#[tauri::command]
pub(crate) fn oc_exec(options: OcExecOptions) -> CmdResult<serde_json::Value> {
    if options.args.is_empty() {
        return Err("Missing oc command arguments".to_string());
    }
    let mut cmd = Command::new("oc");
    cmd.args(&options.args);
    if let Some(cwd) = resolve_agent_cwd(options.cwd) {
        cmd.current_dir(cwd);
    }
    let output = cmd.output().map_err(map_err)?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let code = output.status.code().unwrap_or(-1);
    Ok(serde_json::json!({
        "stdout": stdout,
        "stderr": stderr,
        "code": code
    }))
}

#[derive(Deserialize)]
pub(crate) struct CodexPermissionResponseOptions {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "callId")]
    call_id: String,
    #[serde(rename = "type")]
    permission_type: String,
    approved: bool,
}

#[tauri::command]
pub(crate) fn codex_permission_response(
    state: State<AppState>,
    options: CodexPermissionResponseOptions,
) -> CmdResult<()> {
    let session = {
        let sessions = state.agent_rpc_sessions.lock().map_err(map_err)?;
        sessions.get(&options.session_id).cloned()
    };

    let Some(session) = session else {
        return Err("Codex session not found".to_string());
    };

    if options.permission_type == "apply_patch_approval_request" {
        let normalized = options
            .call_id
            .trim_start_matches("patch_")
            .trim_start_matches("elicitation_")
            .to_string();
        let changes = {
            let mut state = session.state.lock().map_err(map_err)?;
            state
                .codex_patch_changes
                .remove(&options.call_id)
                .or_else(|| state.codex_patch_changes.remove(&normalized))
                .unwrap_or_else(|| serde_json::json!({}))
        };

        let params = serde_json::json!({
            "call_id": options.call_id,
            "approved": options.approved,
            "changes": changes,
        });
        let _ = send_rpc_request(&session, "apply_patch_approval_response", params, None, false, 30)?;
        let _ = session.state.lock().map(|mut state| {
            state.codex_elicitation_map.remove(&options.call_id);
            state.codex_elicitation_map.remove(&normalized);
        });
    } else {
        let decision = if options.approved { "approved" } else { "denied" };
        respond_elicitation(&session, &options.call_id, decision)?;
    }

    Ok(())
}

#[derive(Deserialize)]
pub(crate) struct AcpPermissionResponseOptions {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "callId")]
    call_id: String,
    #[serde(rename = "optionId")]
    option_id: Option<String>,
}

#[tauri::command]
pub(crate) fn acp_permission_response(
    state: State<AppState>,
    options: AcpPermissionResponseOptions,
) -> CmdResult<()> {
    let session = {
        let sessions = state.agent_rpc_sessions.lock().map_err(map_err)?;
        sessions.get(&options.session_id).cloned()
    };

    let Some(session) = session else {
        return Err("ACP session not found".to_string());
    };

    let request_id = {
        let mut state = session.state.lock().map_err(map_err)?;
        state.acp_permission_map.remove(&options.call_id)
    };

    let Some(request_id) = request_id else {
        return Err("ACP permission request not found".to_string());
    };

    let result = if let Some(option_id) = options.option_id {
        serde_json::json!({
            "outcome": {
                "outcome": "selected",
                "optionId": option_id,
            }
        })
    } else {
        serde_json::json!({
            "outcome": {
                "outcome": "cancelled"
            }
        })
    };

    send_rpc_response(&session.stdin, request_id, Ok(result))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn agent_sessions_load(app: tauri::AppHandle) -> CmdResult<Option<serde_json::Value>> {
    let path = agent_sessions_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path).map_err(map_err)?;
    let payload = serde_json::from_str(&content).map_err(map_err)?;
    Ok(Some(payload))
}

#[tauri::command]
pub(crate) fn agent_sessions_save(
    app: tauri::AppHandle,
    payload: serde_json::Value,
) -> CmdResult<bool> {
    let path = agent_sessions_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(map_err)?;
    }
    let content = serde_json::to_string(&payload).map_err(map_err)?;
    std::fs::write(&path, content).map_err(map_err)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_codex_mcp_args_prefers_mcp_server_for_new_versions() {
        let args = parse_codex_mcp_args("codex v0.40.1");
        assert_eq!(args, vec!["mcp-server".to_string()]);
    }

    #[test]
    fn parse_codex_mcp_args_uses_legacy_for_old_versions() {
        let args = parse_codex_mcp_args("codex version 0.39.0");
        assert_eq!(args, vec!["mcp".to_string(), "serve".to_string()]);
    }

    #[test]
    fn parse_codex_mcp_args_defaults_to_mcp_server() {
        let args = parse_codex_mcp_args("");
        assert_eq!(args, vec!["mcp-server".to_string()]);
    }
}
