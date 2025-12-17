#![allow(dead_code)]

#[cfg(test)]
mod tests;

use chrono::{SecondsFormat, Utc};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use std::{env, fs, path::PathBuf, sync::Arc};
use thiserror::Error;

// Events module (enabled with "search" feature)
#[cfg(feature = "search")]
pub mod events;

// Search module (enabled with "search" feature)
#[cfg(feature = "search")]
pub mod search;

#[cfg(feature = "search")]
use events::{DocEvent, FolderEvent, SharedEventBus};

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("{0}")]
    Message(String),
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type CoreResult<T> = Result<T, CoreError>;

#[derive(Clone)]
pub struct OpenContext {
    contexts_root: PathBuf,
    db_path: PathBuf,
    conn: Arc<Mutex<Connection>>,
    #[cfg(feature = "search")]
    event_bus: Option<SharedEventBus>,
}

#[derive(Debug, Clone, Default)]
pub struct EnvOverrides {
    pub base_root: Option<PathBuf>,
    pub contexts_root: Option<PathBuf>,
    pub db_path: Option<PathBuf>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EnvInfo {
    pub contexts_root: PathBuf,
    pub db_path: PathBuf,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Folder {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub rel_path: String,
    pub abs_path: PathBuf,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Doc {
    pub id: i64,
    pub folder_id: i64,
    pub name: String,
    pub rel_path: String,
    pub abs_path: PathBuf,
    pub description: String,
    pub stable_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DocManifestEntry {
    pub doc_name: String,
    pub rel_path: String,
    pub abs_path: PathBuf,
    pub stable_id: String,
    pub description: String,
    pub updated_at: String,
}

impl OpenContext {
    pub fn initialize(overrides: EnvOverrides) -> CoreResult<Self> {
        let base_root = overrides
            .base_root
            .or_else(|| env_path("OPENCONTEXT_ROOT"))
            .or_else(default_base_root)
            .ok_or_else(|| CoreError::Message("Unable to resolve user home directory".into()))?;
        let contexts_root = overrides
            .contexts_root
            .or_else(|| env_path("OPENCONTEXT_CONTEXTS_ROOT"))
            .unwrap_or_else(|| base_root.join("contexts"));
        let db_path = overrides
            .db_path
            .or_else(|| env_path("OPENCONTEXT_DB_PATH"))
            .unwrap_or_else(|| base_root.join("opencontext.db"));

        fs::create_dir_all(&contexts_root)?;
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                rel_path TEXT NOT NULL UNIQUE,
                abs_path TEXT NOT NULL,
                description TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS docs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                rel_path TEXT NOT NULL UNIQUE,
                abs_path TEXT NOT NULL,
                description TEXT DEFAULT '',
                stable_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        ",
        )?;

        ensure_schema_migrations(&conn)?;

        Ok(Self {
            contexts_root,
            db_path,
            conn: Arc::new(Mutex::new(conn)),
            #[cfg(feature = "search")]
            event_bus: None,
        })
    }

    /// Set the event bus for this context
    #[cfg(feature = "search")]
    pub fn with_event_bus(mut self, event_bus: SharedEventBus) -> Self {
        self.event_bus = Some(event_bus);
        self
    }

    /// Get the event bus
    #[cfg(feature = "search")]
    pub fn event_bus(&self) -> Option<&SharedEventBus> {
        self.event_bus.as_ref()
    }

    /// Emit a document event
    #[cfg(feature = "search")]
    fn emit_doc_event(&self, event: DocEvent) {
        if let Some(ref bus) = self.event_bus {
            bus.emit_doc(event);
        }
    }

    /// Emit a folder event
    #[cfg(feature = "search")]
    fn emit_folder_event(&self, event: FolderEvent) {
        if let Some(ref bus) = self.event_bus {
            bus.emit_folder(event);
        }
    }

    pub fn get_doc_by_stable_id(&self, stable_id: &str) -> CoreResult<Doc> {
        let cleaned = stable_id.trim();
        if cleaned.is_empty() {
            return Err(CoreError::Message("stable_id is required.".into()));
        }
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, folder_id, name, rel_path, abs_path, description, stable_id, created_at, updated_at
                 FROM docs WHERE stable_id = ?1",
            )?;
            let doc = stmt
                .query_row([cleaned], row_to_doc)
                .optional()?
                .ok_or_else(|| CoreError::Message(format!("Document with stable_id \"{cleaned}\" not found.")))?;
            Ok(doc)
        })
    }

    pub fn get_doc_meta(&self, doc_path: &str) -> CoreResult<Doc> {
        let rel_doc_path = normalize_doc_path(Some(doc_path))?;
        let mut doc = self
            .find_doc(&rel_doc_path)?
            .ok_or_else(|| doc_not_found(&rel_doc_path))?;
        // If edited outside OpenContext, sync updated_at from filesystem mtime.
        if let Ok(updated) = sync_updated_at_from_fs(&doc) {
            if updated != doc.updated_at {
                let ts = updated.clone();
                self.with_conn(|conn| {
                    conn.execute(
                        "UPDATE docs SET updated_at = ?1 WHERE id = ?2",
                        params![ts, doc.id],
                    )?;
                    Ok(())
                })?;
                doc.updated_at = updated;
            }
        }
        Ok(doc)
    }

    pub fn env_info(&self) -> EnvInfo {
        EnvInfo {
            contexts_root: self.contexts_root.clone(),
            db_path: self.db_path.clone(),
        }
    }

    pub fn list_folders(&self, all: bool) -> CoreResult<Vec<Folder>> {
        self.with_conn(|conn| {
            let query = if all {
                "SELECT id, parent_id, name, rel_path, abs_path, description, created_at, updated_at FROM folders ORDER BY rel_path"
            } else {
                "SELECT id, parent_id, name, rel_path, abs_path, description, created_at, updated_at FROM folders WHERE parent_id IS NULL ORDER BY name"
            };
            let mut stmt = conn.prepare(query)?;
            let rows = stmt
                .query_map([], row_to_folder)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn create_folder(
        &self,
        path: &str,
        description: Option<&str>,
    ) -> CoreResult<FolderSummary> {
        let rel_path = normalize_folder_path(Some(path))?;
        if rel_path.is_empty() {
            return Err(CoreError::Message(
                "Cannot create root folder. Provide a sub-path like \"project-a\".".into(),
            ));
        }
        let parent_path = parent_rel_path(&rel_path);
        if let Some(parent) = parent_path.as_deref() {
            self.ensure_folder_record(parent)?;
        }
        let parent_for_compare = parent_path.clone().unwrap_or_default();
        if rel_path != parent_for_compare && self.find_folder(&rel_path)?.is_some() {
            self.update_folder_description(&rel_path, description.unwrap_or(""))?;
            return Ok(FolderSummary {
                rel_path: rel_path.clone(),
                abs_path: self.contexts_root.join(&rel_path),
                description: description.unwrap_or("").to_string(),
            });
        }
        let ts = now_iso();
        let name = rel_path.split('/').last().unwrap_or(&rel_path).to_string();
        let abs_path = self.contexts_root.join(&rel_path);
        fs::create_dir_all(&abs_path)?;
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO folders (parent_id, name, rel_path, abs_path, description, created_at, updated_at) VALUES (
                    (SELECT id FROM folders WHERE rel_path = ?1),
                    ?2, ?3, ?4, ?5, ?6, ?6
                )",
                params![
                    parent_path,
                    name,
                    rel_path,
                    abs_path.to_string_lossy(),
                    description.unwrap_or(""),
                    ts
                ],
            )?;
            Ok(())
        })?;
        Ok(FolderSummary {
            rel_path,
            abs_path,
            description: description.unwrap_or("").to_string(),
        })
    }

    pub fn rename_folder(&self, path: &str, new_name: &str) -> CoreResult<RenameResult> {
        let rel_path = normalize_folder_path(Some(path))?;
        if rel_path.is_empty() {
            return Err(CoreError::Message(
                "Cannot rename the root contexts directory.".into(),
            ));
        }
        if new_name.is_empty() || new_name.contains('/') {
            return Err(CoreError::Message(
                "New name must be a single path segment.".into(),
            ));
        }
        let folder = self
            .find_folder(&rel_path)?
            .ok_or_else(|| folder_not_found(&rel_path))?;
        let parent_path = parent_rel_path(&rel_path);
        let new_rel_path = if let Some(parent) = parent_path.as_deref() {
            if parent.is_empty() {
                new_name.to_string()
            } else {
                format!("{}/{}", parent, new_name)
            }
        } else {
            new_name.to_string()
        };
        if self.find_folder(&new_rel_path)?.is_some() {
            return Err(CoreError::Message(format!(
                "Target folder \"{new_rel_path}\" already exists."
            )));
        }
        let new_abs_path = self.contexts_root.join(&new_rel_path);
        if let Some(parent) = new_abs_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&folder.abs_path, &new_abs_path)?;
        let ts = now_iso();

        // Collect affected doc paths before the transaction (for event emission)
        #[cfg(feature = "search")]
        let affected_doc_paths: Vec<String> = self.with_conn(|conn| {
            let like_pattern = format!("{}/%", folder.rel_path);
            let mut stmt = conn.prepare("SELECT rel_path FROM docs WHERE rel_path LIKE ?1")?;
            let paths = stmt
                .query_map([like_pattern], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(paths)
        })?;

        self.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            {
                tx.execute(
                    "UPDATE folders SET name = ?1, rel_path = ?2, abs_path = ?3, updated_at = ?4 WHERE id = ?5",
                    params![new_name, new_rel_path, new_abs_path.to_string_lossy(), ts, folder.id],
                )?;
                let like_pattern = format!("{}/%", folder.rel_path);
                let mut stmt = tx.prepare("SELECT id, rel_path FROM folders WHERE rel_path LIKE ?1")?;
                let folder_rows = stmt
                    .query_map([like_pattern.clone()], |row| {
                        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                for (id, child_rel) in folder_rows {
                    let suffix = &child_rel[folder.rel_path.len() + 1..];
                    let updated_rel = format!("{}/{}", new_rel_path, suffix);
                    let updated_abs = self.contexts_root.join(&updated_rel);
                    tx.execute(
                        "UPDATE folders SET rel_path = ?1, abs_path = ?2, updated_at = ?3 WHERE id = ?4",
                        params![updated_rel, updated_abs.to_string_lossy(), ts, id],
                    )?;
                }
                let mut doc_stmt =
                    tx.prepare("SELECT id, rel_path FROM docs WHERE rel_path LIKE ?1")?;
                let doc_rows = doc_stmt
                    .query_map([like_pattern], |row| {
                        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                for (id, doc_rel) in doc_rows {
                    let suffix = &doc_rel[folder.rel_path.len() + 1..];
                    let updated_rel = format!("{}/{}", new_rel_path, suffix);
                    let updated_abs = self.contexts_root.join(&updated_rel);
                    tx.execute(
                        "UPDATE docs SET rel_path = ?1, abs_path = ?2, updated_at = ?3 WHERE id = ?4",
                        params![updated_rel, updated_abs.to_string_lossy(), ts, id],
                    )?;
                }
            }
            tx.commit()?;
            Ok(())
        })?;

        // Emit folder event with affected docs
        #[cfg(feature = "search")]
        {
            let affected_docs: Vec<(String, String)> = affected_doc_paths
                .into_iter()
                .map(|old_path| {
                    let suffix = &old_path[folder.rel_path.len() + 1..];
                    let new_path = format!("{}/{}", new_rel_path, suffix);
                    (old_path, new_path)
                })
                .collect();
            self.emit_folder_event(FolderEvent::Renamed {
                old_path: rel_path.clone(),
                new_path: new_rel_path.clone(),
                affected_docs,
            });
        }

        Ok(RenameResult {
            old_path: rel_path,
            new_path: new_rel_path,
        })
    }

    pub fn move_folder(&self, path: &str, dest_folder_path: &str) -> CoreResult<RenameResult> {
        let rel_path = normalize_folder_path(Some(path))?;
        if rel_path.is_empty() {
            return Err(CoreError::Message(
                "Cannot move the root contexts directory.".into(),
            ));
        }
        let dest_rel_folder = normalize_folder_path(Some(dest_folder_path))?;
        if dest_rel_folder.is_empty() {
            return Err(CoreError::Message(
                "Root is not supported. Please move into a folder under contexts/.".into(),
            ));
        }
        if dest_rel_folder == rel_path || dest_rel_folder.starts_with(&format!("{}/", rel_path)) {
            return Err(CoreError::Message(
                "Cannot move a folder into itself or its descendants.".into(),
            ));
        }

        let folder = self
            .find_folder(&rel_path)?
            .ok_or_else(|| folder_not_found(&rel_path))?;
        let dest_folder = self
            .find_folder(&dest_rel_folder)?
            .ok_or_else(|| folder_not_found(&dest_rel_folder))?;

        let new_rel_path = if dest_folder.rel_path.is_empty() {
            folder.name.clone()
        } else {
            format!("{}/{}", dest_folder.rel_path, folder.name)
        };
        if self.find_folder(&new_rel_path)?.is_some() {
            return Err(CoreError::Message(format!(
                "Target folder \"{new_rel_path}\" already exists."
            )));
        }

        let new_abs_path = self.contexts_root.join(&new_rel_path);
        if let Some(parent) = new_abs_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&folder.abs_path, &new_abs_path)?;

        let ts = now_iso();

        // Collect affected doc paths before the transaction (for event emission)
        #[cfg(feature = "search")]
        let affected_doc_paths: Vec<String> = self.with_conn(|conn| {
            let like_pattern = format!("{}/%", folder.rel_path);
            let mut stmt = conn.prepare("SELECT rel_path FROM docs WHERE rel_path LIKE ?1")?;
            let paths = stmt
                .query_map([like_pattern], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(paths)
        })?;

        self.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            {
                tx.execute(
                    "UPDATE folders SET parent_id = ?1, rel_path = ?2, abs_path = ?3, updated_at = ?4 WHERE id = ?5",
                    params![
                        dest_folder.id,
                        new_rel_path,
                        new_abs_path.to_string_lossy(),
                        ts,
                        folder.id
                    ],
                )?;

                let like_pattern = format!("{}/%", folder.rel_path);
                let mut stmt = tx.prepare("SELECT id, rel_path FROM folders WHERE rel_path LIKE ?1")?;
                let folder_rows = stmt
                    .query_map([like_pattern.clone()], |row| {
                        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                for (id, child_rel) in folder_rows {
                    let suffix = &child_rel[folder.rel_path.len() + 1..];
                    let updated_rel = format!("{}/{}", new_rel_path, suffix);
                    let updated_abs = self.contexts_root.join(&updated_rel);
                    tx.execute(
                        "UPDATE folders SET rel_path = ?1, abs_path = ?2, updated_at = ?3 WHERE id = ?4",
                        params![updated_rel, updated_abs.to_string_lossy(), ts, id],
                    )?;
                }

                let mut doc_stmt =
                    tx.prepare("SELECT id, rel_path FROM docs WHERE rel_path LIKE ?1")?;
                let doc_rows = doc_stmt
                    .query_map([like_pattern], |row| {
                        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                for (id, doc_rel) in doc_rows {
                    let suffix = &doc_rel[folder.rel_path.len() + 1..];
                    let updated_rel = format!("{}/{}", new_rel_path, suffix);
                    let updated_abs = self.contexts_root.join(&updated_rel);
                    tx.execute(
                        "UPDATE docs SET rel_path = ?1, abs_path = ?2, updated_at = ?3 WHERE id = ?4",
                        params![updated_rel, updated_abs.to_string_lossy(), ts, id],
                    )?;
                }
            }
            tx.commit()?;
            Ok(())
        })?;

        // Emit folder event with affected docs
        #[cfg(feature = "search")]
        {
            let affected_docs: Vec<(String, String)> = affected_doc_paths
                .into_iter()
                .map(|old_path| {
                    let suffix = &old_path[folder.rel_path.len() + 1..];
                    let new_path = format!("{}/{}", new_rel_path, suffix);
                    (old_path, new_path)
                })
                .collect();
            self.emit_folder_event(FolderEvent::Moved {
                old_path: rel_path.clone(),
                new_path: new_rel_path.clone(),
                affected_docs,
            });
        }

        Ok(RenameResult {
            old_path: rel_path,
            new_path: new_rel_path,
        })
    }

    pub fn remove_folder(&self, path: &str, force: bool) -> CoreResult<Removed> {
        let rel_path = normalize_folder_path(Some(path))?;
        if rel_path.is_empty() {
            return Err(CoreError::Message(
                "Cannot remove the root contexts directory.".into(),
            ));
        }
        let folder = self
            .find_folder(&rel_path)?
            .ok_or_else(|| folder_not_found(&rel_path))?;

        // Collect documents to be removed (for event emission)
        #[cfg(feature = "search")]
        let removed_docs: Vec<String> = self.with_conn(|conn| {
            let like_pattern = format!("{}/%", rel_path);
            let mut stmt =
                conn.prepare("SELECT rel_path FROM docs WHERE rel_path LIKE ?1 OR folder_id = ?2")?;
            let paths = stmt
                .query_map(params![like_pattern, folder.id], |row| {
                    row.get::<_, String>(0)
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(paths)
        })?;

        self.with_conn(|conn| {
            let child_count: i64 = conn.query_row(
                "SELECT COUNT(1) FROM folders WHERE parent_id = ?1",
                params![folder.id],
                |row| row.get(0),
            )?;
            let doc_count: i64 = conn.query_row(
                "SELECT COUNT(1) FROM docs WHERE folder_id = ?1",
                params![folder.id],
                |row| row.get(0),
            )?;
            if !force && (child_count > 0 || doc_count > 0) {
                return Err(CoreError::Message(format!(
                    "Folder \"{rel_path}\" is not empty. Use --force to delete recursively."
                )));
            }
            let like_pattern = format!("{}/%", rel_path);
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "DELETE FROM docs WHERE rel_path LIKE ?1",
                params![like_pattern.clone()],
            )?;
            tx.execute(
                "DELETE FROM folders WHERE rel_path LIKE ?1",
                params![like_pattern.clone()],
            )?;
            tx.execute("DELETE FROM docs WHERE folder_id = ?1", params![folder.id])?;
            tx.execute("DELETE FROM folders WHERE id = ?1", params![folder.id])?;
            tx.commit()?;
            Ok(())
        })?;
        if folder.abs_path.exists() {
            if force {
                fs::remove_dir_all(&folder.abs_path)?;
            } else {
                fs::remove_dir(&folder.abs_path)?;
            }
        }

        // Emit folder deleted event
        #[cfg(feature = "search")]
        self.emit_folder_event(FolderEvent::Deleted {
            rel_path: rel_path.clone(),
            removed_docs,
        });

        Ok(Removed { rel_path })
    }

    pub fn list_docs(&self, folder_path: &str, recursive: bool) -> CoreResult<Vec<Doc>> {
        let rel_folder_path = normalize_folder_path(Some(folder_path))?;
        let folder = self
            .find_folder(&rel_folder_path)?
            .ok_or_else(|| folder_not_found(&rel_folder_path))?;
        self.with_conn(|conn| {
            if recursive {
                let pattern = if folder.rel_path.is_empty() {
                    "%".to_string()
                } else {
                    format!("{}/%", folder.rel_path)
                };
                let mut stmt = conn.prepare(
                    "SELECT id, folder_id, name, rel_path, abs_path, description, stable_id, created_at, updated_at
                     FROM docs WHERE rel_path LIKE ?1 ORDER BY rel_path",
                )?;
                let rows = stmt
                    .query_map([pattern], row_to_doc)?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            } else {
                if rel_folder_path.is_empty() {
                    let mut stmt = conn.prepare(
                        "SELECT id, folder_id, name, rel_path, abs_path, description, stable_id, created_at, updated_at
                         FROM docs WHERE folder_id IS NULL ORDER BY name",
                    )?;
                    let rows = stmt
                        .query_map([], row_to_doc)?
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok(rows)
                } else {
                    let mut stmt = conn.prepare(
                        "SELECT id, folder_id, name, rel_path, abs_path, description, stable_id, created_at, updated_at
                         FROM docs WHERE folder_id = ?1 ORDER BY name",
                    )?;
                    let rows = stmt
                        .query_map([folder.id], row_to_doc)?
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok(rows)
                }
            }
        })
    }

    pub fn create_doc(
        &self,
        folder_path: &str,
        name: &str,
        description: Option<&str>,
    ) -> CoreResult<DocCreated> {
        if name.is_empty() {
            return Err(CoreError::Message("Document name is required.".into()));
        }
        if name.contains('/') {
            return Err(CoreError::Message(
                "Document name must not contain \"/\".".into(),
            ));
        }
        let rel_folder_path = normalize_folder_path(Some(folder_path))?;
        let folder = self
            .find_folder(&rel_folder_path)?
            .ok_or_else(|| folder_not_found(&rel_folder_path))?;
        let rel_path = if folder.rel_path.is_empty() {
            name.to_string()
        } else {
            format!("{}/{}", folder.rel_path, name)
        };
        if self.find_doc(&rel_path)?.is_some() {
            return Err(CoreError::Message(format!(
                "File \"{rel_path}\" already exists."
            )));
        }
        let abs_path = self.contexts_root.join(&rel_path);
        if let Some(parent) = abs_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&abs_path, "")?;
        let ts = now_iso();
        let stable_id = self.with_conn(|conn| {
            let sid = generate_stable_id(conn)?;
            conn.execute(
                "INSERT INTO docs (folder_id, name, rel_path, abs_path, description, stable_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                params![
                    folder.id,
                    name,
                    rel_path,
                    abs_path.to_string_lossy(),
                    description.unwrap_or(""),
                    sid,
                    ts
                ],
            )?;
            Ok(sid)
        })?;

        // Emit event
        #[cfg(feature = "search")]
        self.emit_doc_event(DocEvent::Created {
            rel_path: rel_path.clone(),
        });

        Ok(DocCreated {
            rel_path,
            abs_path,
            description: description.unwrap_or("").to_string(),
            stable_id,
        })
    }

    pub fn move_doc(&self, doc_path: &str, dest_folder_path: &str) -> CoreResult<RenameResult> {
        let rel_doc_path = normalize_doc_path(Some(doc_path))?;
        let doc = self
            .find_doc(&rel_doc_path)?
            .ok_or_else(|| doc_not_found(&rel_doc_path))?;
        let dest_rel_folder = normalize_folder_path(Some(dest_folder_path))?;
        let dest_folder = self
            .find_folder(&dest_rel_folder)?
            .ok_or_else(|| folder_not_found(&dest_rel_folder))?;
        let new_rel_path = if dest_folder.rel_path.is_empty() {
            doc.name.clone()
        } else {
            format!("{}/{}", dest_folder.rel_path, doc.name)
        };
        if self.find_doc(&new_rel_path)?.is_some() {
            return Err(CoreError::Message(format!(
                "Document \"{new_rel_path}\" already exists."
            )));
        }
        let new_abs_path = self.contexts_root.join(&new_rel_path);
        if let Some(parent) = new_abs_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&doc.abs_path, &new_abs_path)?;
        let ts = now_iso();
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE docs SET folder_id = ?1, rel_path = ?2, abs_path = ?3, updated_at = ?4 WHERE id = ?5",
                params![
                    dest_folder.id,
                    new_rel_path,
                    new_abs_path.to_string_lossy(),
                    ts,
                    doc.id
                ],
            )?;
            Ok(())
        })?;

        // Emit event
        #[cfg(feature = "search")]
        self.emit_doc_event(DocEvent::Moved {
            old_path: rel_doc_path.clone(),
            new_path: new_rel_path.clone(),
        });

        Ok(RenameResult {
            old_path: rel_doc_path,
            new_path: new_rel_path,
        })
    }

    pub fn rename_doc(&self, doc_path: &str, new_name: &str) -> CoreResult<RenameResult> {
        if new_name.is_empty() || new_name.contains('/') {
            return Err(CoreError::Message(
                "New name must be a single file name without \"/\".".into(),
            ));
        }
        let rel_doc_path = normalize_doc_path(Some(doc_path))?;
        let doc = self
            .find_doc(&rel_doc_path)?
            .ok_or_else(|| doc_not_found(&rel_doc_path))?;
        let folder_rel = parent_rel_path(&doc.rel_path);
        let new_rel_path = folder_rel
            .and_then(|p| if p.is_empty() { None } else { Some(p) })
            .map(|prefix| format!("{}/{}", prefix, new_name))
            .unwrap_or_else(|| new_name.to_string());
        if self.find_doc(&new_rel_path)?.is_some() {
            return Err(CoreError::Message(format!(
                "Document \"{new_rel_path}\" already exists."
            )));
        }
        let new_abs_path = self.contexts_root.join(&new_rel_path);
        if let Some(parent) = new_abs_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&doc.abs_path, &new_abs_path)?;
        let ts = now_iso();
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE docs SET name = ?1, rel_path = ?2, abs_path = ?3, updated_at = ?4 WHERE id = ?5",
                params![new_name, new_rel_path, new_abs_path.to_string_lossy(), ts, doc.id],
            )?;
            Ok(())
        })?;

        // Emit event
        #[cfg(feature = "search")]
        self.emit_doc_event(DocEvent::Renamed {
            old_path: rel_doc_path.clone(),
            new_path: new_rel_path.clone(),
        });

        Ok(RenameResult {
            old_path: rel_doc_path,
            new_path: new_rel_path,
        })
    }

    pub fn remove_doc(&self, doc_path: &str) -> CoreResult<Removed> {
        let rel_doc_path = normalize_doc_path(Some(doc_path))?;
        let doc = self
            .find_doc(&rel_doc_path)?
            .ok_or_else(|| doc_not_found(&rel_doc_path))?;
        if doc.abs_path.exists() {
            fs::remove_file(&doc.abs_path)?;
        }
        self.with_conn(|conn| {
            conn.execute("DELETE FROM docs WHERE id = ?1", params![doc.id])?;
            Ok(())
        })?;

        // Emit event
        #[cfg(feature = "search")]
        self.emit_doc_event(DocEvent::Deleted {
            rel_path: rel_doc_path.clone(),
        });
        Ok(Removed {
            rel_path: rel_doc_path,
        })
    }

    pub fn set_doc_description(&self, doc_path: &str, description: &str) -> CoreResult<DocSummary> {
        let rel_doc_path = normalize_doc_path(Some(doc_path))?;
        let doc = self
            .find_doc(&rel_doc_path)?
            .ok_or_else(|| doc_not_found(&rel_doc_path))?;
        let ts = now_iso();
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE docs SET description = ?1, updated_at = ?2 WHERE id = ?3",
                params![description, ts, doc.id],
            )?;
            Ok(())
        })?;
        Ok(DocSummary {
            rel_path: rel_doc_path,
            description: description.to_string(),
        })
    }

    pub fn get_doc_content(&self, doc_path: &str) -> CoreResult<String> {
        let rel_doc_path = normalize_doc_path(Some(doc_path))?;
        let doc = self
            .find_doc(&rel_doc_path)?
            .ok_or_else(|| doc_not_found(&rel_doc_path))?;
        // Best-effort: sync updated_at from filesystem mtime when reading.
        if let Ok(updated) = sync_updated_at_from_fs(&doc) {
            if updated != doc.updated_at {
                let ts = updated;
                self.with_conn(|conn| {
                    conn.execute(
                        "UPDATE docs SET updated_at = ?1 WHERE id = ?2",
                        params![ts, doc.id],
                    )?;
                    Ok(())
                })?;
            }
        }
        let content = fs::read_to_string(&doc.abs_path)?;
        Ok(content)
    }

    pub fn save_doc_content(
        &self,
        doc_path: &str,
        content: &str,
        description: Option<&str>,
    ) -> CoreResult<DocSaved> {
        let rel_doc_path = normalize_doc_path(Some(doc_path))?;
        let doc = self
            .find_doc(&rel_doc_path)?
            .ok_or_else(|| doc_not_found(&rel_doc_path))?;
        fs::write(&doc.abs_path, content)?;
        let ts = now_iso();
        self.with_conn(|conn| {
            if let Some(desc) = description {
                conn.execute(
                    "UPDATE docs SET description = ?1, updated_at = ?2 WHERE id = ?3",
                    params![desc, ts, doc.id],
                )?;
            } else {
                conn.execute(
                    "UPDATE docs SET updated_at = ?1 WHERE id = ?2",
                    params![ts, doc.id],
                )?;
            }
            Ok(())
        })?;

        // Emit event
        #[cfg(feature = "search")]
        self.emit_doc_event(DocEvent::Updated {
            rel_path: rel_doc_path.clone(),
        });

        Ok(DocSaved {
            rel_path: rel_doc_path,
            abs_path: doc.abs_path,
        })
    }

    pub fn generate_manifest(
        &self,
        folder_path: &str,
        limit: Option<usize>,
    ) -> CoreResult<Vec<DocManifestEntry>> {
        if let Some(l) = limit {
            if l == 0 {
                return Err(CoreError::Message(
                    "limit must be a positive integer".into(),
                ));
            }
        }
        let rel_path = normalize_folder_path(Some(folder_path))?;
        let folder = self
            .find_folder(&rel_path)?
            .ok_or_else(|| folder_not_found(&rel_path))?;
        self.with_conn(|conn| {
            let sql = if limit.is_some() {
                "SELECT name, rel_path, abs_path, stable_id, description, updated_at FROM docs WHERE rel_path LIKE ?1 ORDER BY rel_path LIMIT ?2"
            } else {
                "SELECT name, rel_path, abs_path, stable_id, description, updated_at FROM docs WHERE rel_path LIKE ?1 ORDER BY rel_path"
            };
            let pattern = if folder.rel_path.is_empty() {
                "%".to_string()
            } else {
                format!("{}/%", folder.rel_path)
            };
            let mut stmt = conn.prepare(sql)?;
            if let Some(limit) = limit {
                let rows = stmt
                    .query_map(params![pattern, limit as i64], manifest_row)?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            } else {
                let rows = stmt
                    .query_map([pattern], manifest_row)?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            }
        })
    }

    fn find_folder(&self, rel_path: &str) -> CoreResult<Option<Folder>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, parent_id, name, rel_path, abs_path, description, created_at, updated_at
                 FROM folders WHERE rel_path = ?1",
            )?;
            Ok(stmt.query_row([rel_path], row_to_folder).optional()?)
        })
    }

    fn find_doc(&self, rel_path: &str) -> CoreResult<Option<Doc>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, folder_id, name, rel_path, abs_path, description, stable_id, created_at, updated_at
                 FROM docs WHERE rel_path = ?1",
            )?;
            Ok(stmt.query_row([rel_path], row_to_doc).optional()?)
        })
    }

    fn ensure_folder_record(&self, rel_path: &str) -> CoreResult<Option<Folder>> {
        if rel_path.is_empty() {
            return Ok(None);
        }
        if let Some(existing) = self.find_folder(rel_path)? {
            return Ok(Some(existing));
        }
        let parent = parent_rel_path(rel_path);
        if let Some(ref parent_rel) = parent {
            if !parent_rel.is_empty() {
                self.ensure_folder_record(parent_rel)?;
            }
        }
        let abs_path = self.contexts_root.join(rel_path);
        fs::create_dir_all(&abs_path)?;
        let ts = now_iso();
        let name = rel_path.split('/').last().unwrap_or(rel_path);
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO folders (parent_id, name, rel_path, abs_path, description, created_at, updated_at)
                 VALUES (
                    (SELECT id FROM folders WHERE rel_path = ?1),
                    ?2, ?3, ?4, '', ?5, ?5
                 )",
                params![parent, name, rel_path, abs_path.to_string_lossy(), ts],
            )?;
            Ok(())
        })?;
        self.find_folder(rel_path)
    }

    fn update_folder_description(&self, rel_path: &str, description: &str) -> CoreResult<()> {
        let ts = now_iso();
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE folders SET description = ?1, updated_at = ?2 WHERE rel_path = ?3",
                params![description, ts, rel_path],
            )?;
            Ok(())
        })
    }

    fn with_conn<F, T>(&self, action: F) -> CoreResult<T>
    where
        F: FnOnce(&Connection) -> CoreResult<T>,
    {
        let conn = self.conn.lock();
        action(&conn)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FolderSummary {
    pub rel_path: String,
    pub abs_path: PathBuf,
    pub description: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RenameResult {
    pub old_path: String,
    pub new_path: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Removed {
    pub rel_path: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DocCreated {
    pub rel_path: String,
    pub abs_path: PathBuf,
    pub description: String,
    pub stable_id: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DocSummary {
    pub rel_path: String,
    pub description: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DocSaved {
    pub rel_path: String,
    pub abs_path: PathBuf,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn normalize_folder_path(input: Option<&str>) -> CoreResult<String> {
    let Some(value) = input else {
        return Err(CoreError::Message("Folder path is required".into()));
    };
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == "/" {
        return Ok(String::new());
    }
    let normalized = trimmed
        .replace('\\', "/")
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("/");
    Ok(normalized)
}

fn normalize_doc_path(input: Option<&str>) -> CoreResult<String> {
    let Some(value) = input else {
        return Err(CoreError::Message("Document path is required".into()));
    };
    let cleaned = value
        .trim()
        .replace('\\', "/")
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("/");
    if cleaned.is_empty() {
        return Err(CoreError::Message("Document path cannot be root".into()));
    }
    Ok(cleaned)
}

fn parent_rel_path(rel_path: &str) -> Option<String> {
    if rel_path.is_empty() {
        return None;
    }
    let mut parts: Vec<&str> = rel_path.split('/').collect();
    if parts.is_empty() {
        return None;
    }
    parts.pop();
    let joined = parts.join("/");
    if joined.is_empty() {
        None
    } else {
        Some(joined)
    }
}

fn folder_not_found(rel_path: &str) -> CoreError {
    CoreError::Message(format!(
        "Folder \"{rel_path}\" does not exist. Use \"oc folder create {rel_path}\" first."
    ))
}

fn doc_not_found(rel_path: &str) -> CoreError {
    CoreError::Message(format!("Document \"{rel_path}\" not found."))
}

fn row_to_folder(row: &rusqlite::Row<'_>) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: row.get(0)?,
        parent_id: row.get(1)?,
        name: row.get(2)?,
        rel_path: row.get(3)?,
        abs_path: PathBuf::from(row.get::<_, String>(4)?),
        description: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn row_to_doc(row: &rusqlite::Row<'_>) -> rusqlite::Result<Doc> {
    Ok(Doc {
        id: row.get(0)?,
        folder_id: row.get(1)?,
        name: row.get(2)?,
        rel_path: row.get(3)?,
        abs_path: PathBuf::from(row.get::<_, String>(4)?),
        description: row.get(5)?,
        stable_id: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn manifest_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DocManifestEntry> {
    Ok(DocManifestEntry {
        doc_name: row.get(0)?,
        rel_path: row.get(1)?,
        abs_path: PathBuf::from(row.get::<_, String>(2)?),
        stable_id: row.get(3)?,
        description: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn ensure_schema_migrations(conn: &Connection) -> CoreResult<()> {
    // Add docs.stable_id if missing.
    let mut stmt = conn.prepare("PRAGMA table_info(docs)")?;
    let cols = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    let has_stable_id = cols.iter().any(|c| c == "stable_id");
    if !has_stable_id {
        conn.execute("ALTER TABLE docs ADD COLUMN stable_id TEXT", [])?;
    }
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_stable_id ON docs(stable_id)",
        [],
    )?;

    // Backfill missing stable_id.
    let mut stmt = conn.prepare("SELECT id FROM docs WHERE stable_id IS NULL OR stable_id = ''")?;
    let ids = stmt
        .query_map([], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for id in ids {
        let sid = generate_stable_id(conn)?;
        conn.execute(
            "UPDATE docs SET stable_id = ?1 WHERE id = ?2",
            params![sid, id],
        )?;
    }
    Ok(())
}

fn generate_stable_id(conn: &Connection) -> CoreResult<String> {
    // Use SQLite's RNG via randomblob(16), then format as UUIDv4-like string.
    let bytes: Vec<u8> = conn.query_row("SELECT randomblob(16)", [], |row| row.get(0))?;
    if bytes.len() != 16 {
        return Err(CoreError::Message("failed to generate stable_id".into()));
    }
    let mut b = [0u8; 16];
    b.copy_from_slice(&bytes[..16]);
    // UUID v4 variant/version bits
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex = b.iter().map(|v| format!("{:02x}", v)).collect::<String>();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    ))
}

fn sync_updated_at_from_fs(doc: &Doc) -> CoreResult<String> {
    let meta = fs::metadata(&doc.abs_path)?;
    let modified = meta.modified()?;
    let dt: chrono::DateTime<chrono::Utc> = modified.into();
    Ok(dt.to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn default_base_root() -> Option<PathBuf> {
    if let Ok(root) = env::var("OPENCONTEXT_ROOT") {
        return Some(PathBuf::from(root));
    }
    dirs::home_dir().map(|home| home.join(".opencontext"))
}

fn env_path(key: &str) -> Option<PathBuf> {
    env::var(key).ok().map(PathBuf::from)
}
