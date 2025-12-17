//! Unit tests for opencontext-core

#[cfg(test)]
mod context_tests {
    use crate::{EnvOverrides, OpenContext};
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn create_test_context() -> (OpenContext, TempDir) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let base_path = temp_dir.path().to_path_buf();

        let ctx = OpenContext::initialize(EnvOverrides {
            base_root: Some(base_path.clone()),
            contexts_root: Some(base_path.join("contexts")),
            db_path: Some(base_path.join("test.db")),
        })
        .expect("Failed to initialize context");

        (ctx, temp_dir)
    }

    #[test]
    fn test_initialize_creates_directories() {
        let (ctx, temp_dir) = create_test_context();
        let info = ctx.env_info();

        assert!(
            info.contexts_root.exists(),
            "Contexts directory should exist"
        );
        assert!(info.db_path.exists(), "Database file should exist");
        drop(temp_dir);
    }

    #[test]
    fn test_initialize_idempotent() {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let base_path = temp_dir.path().to_path_buf();

        let overrides = EnvOverrides {
            base_root: Some(base_path.clone()),
            contexts_root: Some(base_path.join("contexts")),
            db_path: Some(base_path.join("test.db")),
        };

        // Initialize twice - should not fail
        let _ctx1 = OpenContext::initialize(overrides.clone()).expect("First init failed");
        let _ctx2 = OpenContext::initialize(overrides).expect("Second init failed");
    }

    #[test]
    fn test_env_info_returns_paths() {
        let (ctx, temp_dir) = create_test_context();
        let info = ctx.env_info();

        assert!(info.contexts_root.to_string_lossy().contains("contexts"));
        assert!(info.db_path.to_string_lossy().contains("test.db"));
        drop(temp_dir);
    }
}

#[cfg(test)]
mod folder_tests {
    use super::context_tests::*;
    use crate::{EnvOverrides, OpenContext};
    use tempfile::TempDir;

    fn create_test_context() -> (OpenContext, TempDir) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let base_path = temp_dir.path().to_path_buf();

        let ctx = OpenContext::initialize(EnvOverrides {
            base_root: Some(base_path.clone()),
            contexts_root: Some(base_path.join("contexts")),
            db_path: Some(base_path.join("test.db")),
        })
        .expect("Failed to initialize context");

        (ctx, temp_dir)
    }

    #[test]
    fn test_create_folder_basic() {
        let (ctx, _temp) = create_test_context();

        let result = ctx
            .create_folder("test-folder", None)
            .expect("Failed to create folder");

        assert_eq!(result.rel_path, "test-folder");
        assert!(result.abs_path.exists());
    }

    #[test]
    fn test_create_folder_with_description() {
        let (ctx, _temp) = create_test_context();

        let result = ctx
            .create_folder("my-folder", Some("A test folder"))
            .expect("Failed to create folder");

        assert_eq!(result.rel_path, "my-folder");
        assert_eq!(result.description, "A test folder");
    }

    #[test]
    fn test_create_nested_folder() {
        let (ctx, _temp) = create_test_context();

        // Create nested folder - should auto-create parents
        let result = ctx
            .create_folder("parent/child/grandchild", None)
            .expect("Failed to create nested folder");

        assert_eq!(result.rel_path, "parent/child/grandchild");
        assert!(result.abs_path.exists());

        // Verify parent folders were created
        let folders = ctx.list_folders(true).expect("Failed to list folders");
        assert!(folders.iter().any(|f| f.rel_path == "parent"));
        assert!(folders.iter().any(|f| f.rel_path == "parent/child"));
    }

    #[test]
    fn test_create_folder_idempotent() {
        let (ctx, _temp) = create_test_context();

        // Create same folder twice - should not fail
        ctx.create_folder("idempotent-folder", None)
            .expect("First create failed");
        let result = ctx
            .create_folder("idempotent-folder", Some("Updated desc"))
            .expect("Second create failed");

        assert_eq!(result.rel_path, "idempotent-folder");
    }

    #[test]
    fn test_create_folder_invalid_path() {
        let (ctx, _temp) = create_test_context();

        // Empty path should fail
        let result = ctx.create_folder("", None);
        assert!(result.is_err());

        // Root path should fail
        let result = ctx.create_folder("/", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_list_folders_empty() {
        let (ctx, _temp) = create_test_context();

        let folders = ctx.list_folders(false).expect("Failed to list folders");
        assert!(folders.is_empty());
    }

    #[test]
    fn test_list_folders_top_level() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("folder-a", None).unwrap();
        ctx.create_folder("folder-b", None).unwrap();
        ctx.create_folder("folder-a/child", None).unwrap();

        let folders = ctx.list_folders(false).expect("Failed to list folders");

        // Should only return top-level folders
        assert_eq!(folders.len(), 2);
        assert!(folders.iter().all(|f| !f.rel_path.contains('/')));
    }

    #[test]
    fn test_list_folders_all_levels() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("folder-a", None).unwrap();
        ctx.create_folder("folder-a/child", None).unwrap();
        ctx.create_folder("folder-b", None).unwrap();

        let folders = ctx.list_folders(true).expect("Failed to list folders");

        assert_eq!(folders.len(), 3);
    }

    #[test]
    fn test_rename_folder_basic() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("old-name", None).unwrap();

        let result = ctx
            .rename_folder("old-name", "new-name")
            .expect("Failed to rename folder");

        assert_eq!(result.old_path, "old-name");
        assert_eq!(result.new_path, "new-name");

        // Verify old folder doesn't exist in DB
        let folders = ctx.list_folders(true).unwrap();
        assert!(!folders.iter().any(|f| f.rel_path == "old-name"));
        assert!(folders.iter().any(|f| f.rel_path == "new-name"));
    }

    #[test]
    fn test_rename_folder_updates_children() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("parent", None).unwrap();
        ctx.create_folder("parent/child", None).unwrap();
        ctx.create_doc("parent/child", "test.md", None).unwrap();

        ctx.rename_folder("parent", "renamed-parent")
            .expect("Failed to rename");

        // Verify child folder path updated
        let folders = ctx.list_folders(true).unwrap();
        assert!(folders.iter().any(|f| f.rel_path == "renamed-parent/child"));

        // Verify doc path updated
        let docs = ctx.list_docs("renamed-parent/child", false).unwrap();
        assert_eq!(docs.len(), 1);
        assert!(docs[0].rel_path.starts_with("renamed-parent/child/"));
    }

    #[test]
    fn test_rename_folder_target_exists() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("source", None).unwrap();
        ctx.create_folder("target", None).unwrap();

        let result = ctx.rename_folder("source", "target");
        assert!(result.is_err());
    }

    #[test]
    fn test_rename_folder_not_found() {
        let (ctx, _temp) = create_test_context();

        let result = ctx.rename_folder("nonexistent", "new-name");
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_folder_empty() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("to-remove", None).unwrap();

        let result = ctx
            .remove_folder("to-remove", false)
            .expect("Failed to remove folder");

        assert_eq!(result.rel_path, "to-remove");

        let folders = ctx.list_folders(true).unwrap();
        assert!(!folders.iter().any(|f| f.rel_path == "to-remove"));
    }

    #[test]
    fn test_remove_folder_not_empty_without_force() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("parent", None).unwrap();
        ctx.create_doc("parent", "doc.md", None).unwrap();

        let result = ctx.remove_folder("parent", false);
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_folder_force_recursive() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("parent", None).unwrap();
        ctx.create_folder("parent/child", None).unwrap();
        ctx.create_doc("parent", "doc1.md", None).unwrap();
        ctx.create_doc("parent/child", "doc2.md", None).unwrap();

        ctx.remove_folder("parent", true)
            .expect("Failed to force remove");

        let folders = ctx.list_folders(true).unwrap();
        assert!(folders.is_empty());
    }

    #[test]
    fn test_remove_folder_not_found() {
        let (ctx, _temp) = create_test_context();

        let result = ctx.remove_folder("nonexistent", false);
        assert!(result.is_err());
    }
}

#[cfg(test)]
mod doc_tests {
    use crate::{EnvOverrides, OpenContext};
    use tempfile::TempDir;

    fn create_test_context() -> (OpenContext, TempDir) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let base_path = temp_dir.path().to_path_buf();

        let ctx = OpenContext::initialize(EnvOverrides {
            base_root: Some(base_path.clone()),
            contexts_root: Some(base_path.join("contexts")),
            db_path: Some(base_path.join("test.db")),
        })
        .expect("Failed to initialize context");

        // Create a test folder
        ctx.create_folder("test-folder", None).unwrap();

        (ctx, temp_dir)
    }

    #[test]
    fn test_create_doc_basic() {
        let (ctx, _temp) = create_test_context();

        let result = ctx
            .create_doc("test-folder", "test.md", None)
            .expect("Failed to create doc");

        assert_eq!(result.rel_path, "test-folder/test.md");
        assert!(result.abs_path.exists());
    }

    #[test]
    fn test_create_doc_with_description() {
        let (ctx, _temp) = create_test_context();

        let result = ctx
            .create_doc("test-folder", "doc.md", Some("My document"))
            .expect("Failed to create doc");

        assert_eq!(result.description, "My document");
    }

    #[test]
    fn test_create_doc_generates_stable_id() {
        let (ctx, _temp) = create_test_context();

        let result = ctx.create_doc("test-folder", "doc.md", None).unwrap();

        assert!(!result.stable_id.is_empty());
        // UUID format: 8-4-4-4-12
        assert_eq!(result.stable_id.len(), 36);
        assert_eq!(result.stable_id.chars().filter(|&c| c == '-').count(), 4);
    }

    #[test]
    fn test_create_doc_already_exists() {
        let (ctx, _temp) = create_test_context();

        ctx.create_doc("test-folder", "duplicate.md", None).unwrap();

        let result = ctx.create_doc("test-folder", "duplicate.md", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_doc_invalid_name() {
        let (ctx, _temp) = create_test_context();

        // Name with slash should fail
        let result = ctx.create_doc("test-folder", "invalid/name.md", None);
        assert!(result.is_err());

        // Empty name should fail
        let result = ctx.create_doc("test-folder", "", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_doc_folder_not_found() {
        let (ctx, _temp) = create_test_context();

        let result = ctx.create_doc("nonexistent-folder", "doc.md", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_list_docs_in_folder() {
        let (ctx, _temp) = create_test_context();

        ctx.create_doc("test-folder", "doc1.md", None).unwrap();
        ctx.create_doc("test-folder", "doc2.md", None).unwrap();

        let docs = ctx
            .list_docs("test-folder", false)
            .expect("Failed to list docs");

        assert_eq!(docs.len(), 2);
    }

    #[test]
    fn test_list_docs_recursive() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("test-folder/child", None).unwrap();
        ctx.create_doc("test-folder", "parent-doc.md", None)
            .unwrap();
        ctx.create_doc("test-folder/child", "child-doc.md", None)
            .unwrap();

        let docs = ctx
            .list_docs("test-folder", true)
            .expect("Failed to list docs");

        assert_eq!(docs.len(), 2);
    }

    #[test]
    fn test_list_docs_empty() {
        let (ctx, _temp) = create_test_context();

        let docs = ctx
            .list_docs("test-folder", false)
            .expect("Failed to list docs");
        assert!(docs.is_empty());
    }

    #[test]
    fn test_move_doc_basic() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("dest-folder", None).unwrap();
        ctx.create_doc("test-folder", "moveme.md", None).unwrap();

        let result = ctx
            .move_doc("test-folder/moveme.md", "dest-folder")
            .expect("Failed to move doc");

        assert_eq!(result.old_path, "test-folder/moveme.md");
        assert_eq!(result.new_path, "dest-folder/moveme.md");
    }

    #[test]
    fn test_move_doc_target_exists() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("dest-folder", None).unwrap();
        ctx.create_doc("test-folder", "doc.md", None).unwrap();
        ctx.create_doc("dest-folder", "doc.md", None).unwrap();

        let result = ctx.move_doc("test-folder/doc.md", "dest-folder");
        assert!(result.is_err());
    }

    #[test]
    fn test_move_doc_not_found() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("dest-folder", None).unwrap();

        let result = ctx.move_doc("test-folder/nonexistent.md", "dest-folder");
        assert!(result.is_err());
    }

    #[test]
    fn test_rename_doc_basic() {
        let (ctx, _temp) = create_test_context();

        ctx.create_doc("test-folder", "old-name.md", None).unwrap();

        let result = ctx
            .rename_doc("test-folder/old-name.md", "new-name.md")
            .expect("Failed to rename doc");

        assert_eq!(result.old_path, "test-folder/old-name.md");
        assert_eq!(result.new_path, "test-folder/new-name.md");
    }

    #[test]
    fn test_rename_doc_target_exists() {
        let (ctx, _temp) = create_test_context();

        ctx.create_doc("test-folder", "doc1.md", None).unwrap();
        ctx.create_doc("test-folder", "doc2.md", None).unwrap();

        let result = ctx.rename_doc("test-folder/doc1.md", "doc2.md");
        assert!(result.is_err());
    }

    #[test]
    fn test_rename_doc_not_found() {
        let (ctx, _temp) = create_test_context();

        let result = ctx.rename_doc("test-folder/nonexistent.md", "new-name.md");
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_doc_basic() {
        let (ctx, _temp) = create_test_context();

        ctx.create_doc("test-folder", "to-delete.md", None).unwrap();

        let result = ctx
            .remove_doc("test-folder/to-delete.md")
            .expect("Failed to remove doc");

        assert_eq!(result.rel_path, "test-folder/to-delete.md");

        let docs = ctx.list_docs("test-folder", false).unwrap();
        assert!(docs.is_empty());
    }

    #[test]
    fn test_remove_doc_not_found() {
        let (ctx, _temp) = create_test_context();

        let result = ctx.remove_doc("test-folder/nonexistent.md");
        assert!(result.is_err());
    }

    #[test]
    fn test_set_doc_description() {
        let (ctx, _temp) = create_test_context();

        ctx.create_doc("test-folder", "doc.md", None).unwrap();

        let result = ctx
            .set_doc_description("test-folder/doc.md", "New description")
            .expect("Failed to set description");

        assert_eq!(result.description, "New description");

        // Verify it persisted
        let doc = ctx.get_doc_meta("test-folder/doc.md").unwrap();
        assert_eq!(doc.description, "New description");
    }

    #[test]
    fn test_set_doc_description_not_found() {
        let (ctx, _temp) = create_test_context();

        let result = ctx.set_doc_description("test-folder/nonexistent.md", "desc");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_doc_meta() {
        let (ctx, _temp) = create_test_context();

        ctx.create_doc("test-folder", "doc.md", Some("Description"))
            .unwrap();

        let doc = ctx
            .get_doc_meta("test-folder/doc.md")
            .expect("Failed to get meta");

        assert_eq!(doc.name, "doc.md");
        assert_eq!(doc.rel_path, "test-folder/doc.md");
        assert_eq!(doc.description, "Description");
        assert!(!doc.stable_id.is_empty());
    }

    #[test]
    fn test_get_doc_by_stable_id() {
        let (ctx, _temp) = create_test_context();

        let created = ctx.create_doc("test-folder", "doc.md", None).unwrap();

        let doc = ctx
            .get_doc_by_stable_id(&created.stable_id)
            .expect("Failed to get by stable_id");

        assert_eq!(doc.rel_path, "test-folder/doc.md");
        assert_eq!(doc.stable_id, created.stable_id);
    }

    #[test]
    fn test_get_doc_by_stable_id_not_found() {
        let (ctx, _temp) = create_test_context();

        let result = ctx.get_doc_by_stable_id("00000000-0000-0000-0000-000000000000");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_doc_content() {
        let (ctx, _temp) = create_test_context();

        ctx.create_doc("test-folder", "doc.md", None).unwrap();

        // Initially empty
        let content = ctx
            .get_doc_content("test-folder/doc.md")
            .expect("Failed to get content");
        assert!(content.is_empty());
    }

    #[test]
    fn test_save_doc_content() {
        let (ctx, _temp) = create_test_context();

        ctx.create_doc("test-folder", "doc.md", None).unwrap();

        ctx.save_doc_content("test-folder/doc.md", "# Hello World", None)
            .expect("Failed to save content");

        let content = ctx.get_doc_content("test-folder/doc.md").unwrap();
        assert_eq!(content, "# Hello World");
    }

    #[test]
    fn test_save_doc_content_with_description() {
        let (ctx, _temp) = create_test_context();

        ctx.create_doc("test-folder", "doc.md", None).unwrap();

        ctx.save_doc_content("test-folder/doc.md", "Content", Some("New desc"))
            .expect("Failed to save");

        let doc = ctx.get_doc_meta("test-folder/doc.md").unwrap();
        assert_eq!(doc.description, "New desc");
    }
}

#[cfg(test)]
mod manifest_tests {
    use crate::{EnvOverrides, OpenContext};
    use tempfile::TempDir;

    fn create_test_context() -> (OpenContext, TempDir) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let base_path = temp_dir.path().to_path_buf();

        let ctx = OpenContext::initialize(EnvOverrides {
            base_root: Some(base_path.clone()),
            contexts_root: Some(base_path.join("contexts")),
            db_path: Some(base_path.join("test.db")),
        })
        .expect("Failed to initialize context");

        (ctx, temp_dir)
    }

    #[test]
    fn test_generate_manifest_all() {
        let (ctx, _temp) = create_test_context();

        // Create a root folder first (needed for manifest generation)
        ctx.create_folder("root", None).unwrap();
        ctx.create_folder("root/folder-a", None).unwrap();
        ctx.create_folder("root/folder-b", None).unwrap();
        ctx.create_doc("root/folder-a", "doc1.md", Some("Doc 1"))
            .unwrap();
        ctx.create_doc("root/folder-b", "doc2.md", Some("Doc 2"))
            .unwrap();

        let manifest = ctx
            .generate_manifest("root", None)
            .expect("Failed to generate manifest");

        assert_eq!(manifest.len(), 2);
        assert!(manifest.iter().any(|e| e.rel_path.ends_with("doc1.md")));
        assert!(manifest.iter().any(|e| e.rel_path.ends_with("doc2.md")));
    }

    #[test]
    fn test_generate_manifest_folder() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("target", None).unwrap();
        ctx.create_folder("other", None).unwrap();
        ctx.create_doc("target", "doc1.md", None).unwrap();
        ctx.create_doc("other", "doc2.md", None).unwrap();

        let manifest = ctx
            .generate_manifest("target", None)
            .expect("Failed to generate manifest");

        assert_eq!(manifest.len(), 1);
        assert_eq!(manifest[0].rel_path, "target/doc1.md");
    }

    #[test]
    fn test_generate_manifest_with_limit() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("folder", None).unwrap();
        for i in 1..=10 {
            ctx.create_doc("folder", &format!("doc{}.md", i), None)
                .unwrap();
        }

        let manifest = ctx
            .generate_manifest("folder", Some(3))
            .expect("Failed to generate manifest");

        assert_eq!(manifest.len(), 3);
    }

    #[test]
    fn test_generate_manifest_empty() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("empty-folder", None).unwrap();

        let manifest = ctx
            .generate_manifest("empty-folder", None)
            .expect("Failed to generate manifest");

        assert!(manifest.is_empty());
    }

    #[test]
    fn test_generate_manifest_entry_fields() {
        let (ctx, _temp) = create_test_context();

        ctx.create_folder("folder", None).unwrap();
        ctx.create_doc("folder", "doc.md", Some("Test description"))
            .unwrap();

        let manifest = ctx.generate_manifest("folder", None).unwrap();

        assert_eq!(manifest.len(), 1);
        let entry = &manifest[0];

        assert_eq!(entry.doc_name, "doc.md");
        assert_eq!(entry.rel_path, "folder/doc.md");
        assert!(!entry.stable_id.is_empty());
        assert_eq!(entry.description, "Test description");
        assert!(!entry.updated_at.is_empty());
        assert!(entry.abs_path.to_string_lossy().contains("folder/doc.md"));
    }
}
