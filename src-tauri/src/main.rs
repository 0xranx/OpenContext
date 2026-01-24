// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent_rpc;
mod chat;
mod commands;
mod terminal_session;
mod utils;

use crate::agent_rpc::AgentRpcSession;
use crate::terminal_session::TerminalSession;
use commands::{agent::*, ai::*, context::*, search::*, terminal::*};
use opencontext_core::events::{create_event_bus, SharedEventBus};
use opencontext_core::search::{IndexSyncService, Indexer, SearchConfig, Searcher};
use opencontext_core::{EnvOverrides, OpenContext};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent, WindowEvent};
use tokio::sync::Mutex as AsyncMutex;

struct AppState {
    ctx: Mutex<OpenContext>,
    searcher: AsyncMutex<Option<Searcher>>,
    indexer: AsyncMutex<Option<Indexer>>,
    search_config: SearchConfig,
    #[allow(dead_code)]
    event_bus: SharedEventBus,
    terminal_sessions: Mutex<HashMap<String, TerminalSession>>,
    agent_rpc_sessions: Mutex<HashMap<String, Arc<AgentRpcSession>>>,
}

fn hide_main_window<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.hide();
    let _ = window.set_skip_taskbar(true);
    #[cfg(target_os = "macos")]
    {
        let _ = window.app_handle().set_dock_visibility(false);
    }
}

fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        {
            let _ = app.set_dock_visibility(true);
        }
        let _ = window.set_skip_taskbar(false);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn main() {
    // Create event bus for document lifecycle events
    let event_bus = create_event_bus();

    // Initialize OpenContext with event bus
    let ctx = OpenContext::initialize(EnvOverrides::default())
        .expect("failed to initialize OpenContext core")
        .with_event_bus(event_bus.clone());

    let search_config = SearchConfig::load().unwrap_or_default();
    let contexts_root = ctx.env_info().contexts_root.clone();

    // Clone for setup hook
    let sync_event_bus = event_bus.clone();
    let sync_config = search_config.clone();
    let sync_contexts_root = contexts_root.clone();

    let allow_close = Arc::new(AtomicBool::new(false));
    let allow_close_for_setup = allow_close.clone();
    let allow_close_for_run = allow_close.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState {
            ctx: Mutex::new(ctx),
            searcher: AsyncMutex::new(None),
            indexer: AsyncMutex::new(None),
            search_config,
            event_bus,
            terminal_sessions: Mutex::new(HashMap::new()),
            agent_rpc_sessions: Mutex::new(HashMap::new()),
        })
        .setup(move |app| {
            let minimize_to_tray_id: Option<tauri::menu::MenuId>;

            // Create Edit menu with predefined items for macOS
            // PredefinedMenuItem items automatically trigger native WebView edit actions
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

                let minimize_to_tray =
                    MenuItem::with_id(app, "minimize_to_tray", "Minimize to Tray", true, None::<&str>)?;
                minimize_to_tray_id = Some(minimize_to_tray.id().clone());

                let app_version = app.package_info().version.to_string();
                let mut about_builder = tauri::menu::AboutMetadataBuilder::new()
                    .version(Some(app_version.clone()))
                    .short_version(Some(app_version));
                let about_icon = Image::from_bytes(include_bytes!("../icons/about-icon.png"))
                    .ok()
                    .or_else(|| app.default_window_icon().cloned())
                    .or_else(|| Image::from_bytes(include_bytes!("../icons/128x128@2x.png")).ok());
                if let Some(icon) = about_icon {
                    about_builder = about_builder.icon(Some(icon));
                }
                let about_metadata = about_builder.build();

                let app_menu = Submenu::with_items(
                    app,
                    app.package_info().name.clone(),
                    true,
                    &[
                        &PredefinedMenuItem::about(app, None, Some(about_metadata)).unwrap(),
                        &PredefinedMenuItem::separator(app).unwrap(),
                        &PredefinedMenuItem::services(app, None).unwrap(),
                        &PredefinedMenuItem::separator(app).unwrap(),
                        &PredefinedMenuItem::hide(app, None).unwrap(),
                        &PredefinedMenuItem::hide_others(app, None).unwrap(),
                        &PredefinedMenuItem::show_all(app, None).unwrap(),
                        &PredefinedMenuItem::separator(app).unwrap(),
                        &minimize_to_tray,
                        &PredefinedMenuItem::quit(app, None).unwrap(),
                    ],
                )
                .unwrap();

                let edit_menu = Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(app, Some("Undo")).unwrap(),
                        &PredefinedMenuItem::redo(app, Some("Redo")).unwrap(),
                        &PredefinedMenuItem::separator(app).unwrap(),
                        &PredefinedMenuItem::cut(app, Some("Cut")).unwrap(),
                        &PredefinedMenuItem::copy(app, Some("Copy")).unwrap(),
                        &PredefinedMenuItem::paste(app, Some("Paste")).unwrap(),
                        &PredefinedMenuItem::select_all(app, Some("Select All")).unwrap(),
                    ],
                )
                .unwrap();

                let menu = Menu::with_items(app, &[&app_menu, &edit_menu]).unwrap();
                app.set_menu(menu).unwrap();
            }
            #[cfg(not(target_os = "macos"))]
            {
                minimize_to_tray_id = None;
            }

            let app_handle = app.handle();

            let tray_show = MenuItem::with_id(
                app_handle,
                "tray_show",
                "Show OpenContext",
                true,
                None::<&str>,
            )?;
            let tray_quit = MenuItem::with_id(
                app_handle,
                "tray_quit",
                "Quit OpenContext",
                true,
                None::<&str>,
            )?;
            let tray_menu = Menu::with_items(app_handle, &[&tray_show, &tray_quit])?;
            let tray_show_id = tray_show.id().clone();
            let tray_quit_id = tray_quit.id().clone();
            let tray_app_handle = app_handle.clone();
            let allow_close_for_menu = allow_close_for_setup.clone();
            let minimize_to_tray_id = minimize_to_tray_id.clone();
            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("OpenContext")
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| {
                    if event.id == tray_show_id {
                        show_main_window(app);
                    } else if event.id == tray_quit_id {
                        allow_close_for_menu.store(true, Ordering::SeqCst);
                        app.exit(0);
                    } else if minimize_to_tray_id
                        .as_ref()
                        .map_or(false, |id| event.id == *id)
                    {
                        if let Some(window) = app.get_webview_window("main") {
                            hide_main_window(&window);
                        }
                    }
                });

            #[cfg(target_os = "macos")]
            {
                if let Ok(icon) = Image::from_bytes(include_bytes!(
                    "../icons/tray-icon-template-36.png"
                )) {
                    tray_builder = tray_builder.icon(icon);
                } else if let Ok(icon) = Image::from_bytes(include_bytes!(
                    "../icons/tray-icon-template-64.png"
                )) {
                    tray_builder = tray_builder.icon(icon);
                } else if let Some(icon) = app.default_window_icon().cloned() {
                    tray_builder = tray_builder.icon(icon);
                }
                tray_builder = tray_builder.icon_as_template(true);
            }
            #[cfg(not(target_os = "macos"))]
            {
                if let Some(icon) = app.default_window_icon().cloned() {
                    tray_builder = tray_builder.icon(icon);
                } else if let Ok(icon) = Image::from_bytes(include_bytes!("../icons/64x64.png")) {
                    tray_builder = tray_builder.icon(icon);
                }
            }

            tray_builder
                .on_tray_icon_event(move |_tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    }
                    | TrayIconEvent::DoubleClick { .. } => {
                        show_main_window(&tray_app_handle);
                    }
                    _ => {}
                })
                .build(app_handle)?;

            if let Some(window) = app_handle.get_webview_window("main") {
                let window_for_event = window.clone();
                let allow_close_for_window = allow_close_for_setup.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        if allow_close_for_window.load(Ordering::SeqCst) {
                            return;
                        }
                        api.prevent_close();
                        hide_main_window(&window_for_event);
                    }
                });
            }

            // Start index sync service in background
            // Use tauri::async_runtime::spawn which works with Tauri's runtime management
            tauri::async_runtime::spawn(async move {
                let sync_service = IndexSyncService::new(sync_config, sync_contexts_root);
                if let Err(e) = sync_service.start(sync_event_bus).await {
                    log::error!("[IndexSync] Service error: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Folder commands
            list_folders,
            create_folder,
            rename_folder,
            move_folder,
            remove_folder,
            // Document commands
            list_docs,
            create_doc,
            get_doc_by_id,
            get_doc_meta,
            move_doc,
            rename_doc,
            remove_doc,
            set_doc_description,
            get_doc_content,
            save_doc_content,
            // Utility commands
            generate_manifest,
            get_env_info,
            save_config,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_kill,
            // Search commands
            semantic_search,
            build_search_index,
            get_index_status,
            clean_search_index,
            // AI commands
            get_ai_config,
            save_ai_config,
            ai_chat,
            agent_sessions_load,
            agent_sessions_save,
            codex_exec,
            codex_kill,
            codex_permission_response,
            acp_permission_response,
            claude_exec,
            claude_kill,
            opencode_run,
            opencode_kill,
            agent_preflight,
            agent_models_get,
            agent_models_save,
            oc_exec,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            allow_close_for_run.store(true, Ordering::SeqCst);
        }
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen {
            has_visible_windows,
            ..
        } = event
        {
            if !has_visible_windows {
                show_main_window(app_handle);
            }
        }
    });
}
