use portable_pty::MasterPty;
use std::io::Write;
use std::sync::{Arc, Mutex};

pub(crate) struct TerminalSession {
    pub(crate) master: Box<dyn MasterPty + Send>,
    pub(crate) writer: Mutex<Box<dyn Write + Send>>,
    pub(crate) child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
}
