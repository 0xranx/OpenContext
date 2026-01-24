use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum AgentRpcKind {
    CodexMcp,
    ClaudeAcp,
    OpenCodeAcp,
}

pub(crate) struct AgentRpcSession {
    pub(crate) kind: AgentRpcKind,
    #[allow(dead_code)]
    pub(crate) child: Arc<Mutex<std::process::Child>>,
    pub(crate) stdin: Arc<Mutex<std::process::ChildStdin>>,
    pub(crate) state: Arc<Mutex<AgentRpcState>>,
    pub(crate) next_id: std::sync::atomic::AtomicU64,
}

pub(crate) struct AgentRpcState {
    pub(crate) pending_responses:
        HashMap<u64, std::sync::mpsc::Sender<Result<serde_json::Value, String>>>,
    pub(crate) request_map: HashMap<u64, String>,
    pub(crate) active_request: Option<String>,
    #[allow(dead_code)]
    pub(crate) session_id: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) cwd: Option<String>,
    pub(crate) conversation_id: Option<String>,
    #[allow(dead_code)]
    pub(crate) initialized: bool,
    pub(crate) codex_session_started: bool,
    pub(crate) codex_received_delta: bool,
    pub(crate) codex_elicitation_map: HashMap<String, u64>,
    pub(crate) codex_patch_changes: HashMap<String, serde_json::Value>,
    pub(crate) acp_permission_map: HashMap<String, u64>,
    pub(crate) startup_error: Option<String>,
}
