use crate::files::{FileError, Files, Handle, Result, Written};
use crate::runtime_directory::{validate_entries, DirectoryWritten, Entry, RuntimeDirectories};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
#[derive(Clone, Default)]
struct NativeFiles(Arc<Mutex<Files>>);
fn file_dialog(app: &tauri::AppHandle) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let dialog = app.dialog().file();
    match app.get_webview_window("main") {
        Some(window) => dialog.set_parent(&window),
        None => dialog,
    }
}
fn pick_directory(app: tauri::AppHandle) -> Result<Option<std::path::PathBuf>> {
    file_dialog(&app)
        .blocking_pick_folder()
        .map(|p| {
            p.into_path()
                .map_err(|e| FileError::detail("path", "无法读取所选路径：{detail}", e.to_string()))
        })
        .transpose()
}

async fn access<T: Send + 'static>(
    state: &NativeFiles,
    f: impl FnOnce(&mut Files) -> Result<T> + Send + 'static,
) -> Result<T> {
    let files = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = files
            .lock()
            .map_err(|_| FileError::localized("state", "文件服务不可用"))?;
        f(&mut guard)
    })
    .await
    .map_err(|e| FileError::detail("task", "原生文件任务失败：{detail}", e.to_string()))?
}
#[tauri::command]
async fn choose_project(
    app: tauri::AppHandle,
    state: State<'_, NativeFiles>,
) -> Result<Option<Handle>> {
    let path = tauri::async_runtime::spawn_blocking(move || {
        file_dialog(&app)
            .add_filter("ROCOS project", &["rcproj", "zip"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| {
        FileError::detail(
            "dialog",
            "无法完成原生文件对话框操作：{detail}",
            e.to_string(),
        )
    })?;
    if let Some(path) = path {
        let path = path
            .into_path()
            .map_err(|e| FileError::detail("path", "无法读取所选路径：{detail}", e.to_string()))?;
        access(&state, move |f| f.grant(&path, true, None).map(Some)).await
    } else {
        Ok(None)
    }
}
#[tauri::command]
async fn choose_target(
    app: tauri::AppHandle,
    state: State<'_, NativeFiles>,
    suggested_name: String,
    exclude_token: Option<String>,
    protected_tokens: Option<Vec<String>>,
) -> Result<Option<Handle>> {
    // A filename suggestion is never interpreted as a path or file capability.
    let name = suggested_name.replace(['/', '\\', ':'], "_");
    let path = tauri::async_runtime::spawn_blocking(move || {
        file_dialog(&app).set_file_name(name).blocking_save_file()
    })
    .await
    .map_err(|e| {
        FileError::detail(
            "dialog",
            "无法完成原生文件对话框操作：{detail}",
            e.to_string(),
        )
    })?;
    if let Some(path) = path {
        let path = path
            .into_path()
            .map_err(|e| FileError::detail("path", "无法读取所选路径：{detail}", e.to_string()))?;
        access(&state, move |f| {
            let h = f.grant(&path, true, None)?;
            for exclude in exclude_token
                .into_iter()
                .chain(protected_tokens.unwrap_or_default())
            {
                if let Err(e) = f.ensure_distinct(&h.token, &exclude) {
                    f.release(&h.token);
                    return Err(e);
                }
            }
            Ok(Some(h))
        })
        .await
    } else {
        Ok(None)
    }
}
#[tauri::command]
async fn choose_import(
    app: tauri::AppHandle,
    state: State<'_, NativeFiles>,
    directory: bool,
) -> Result<Option<Vec<Handle>>> {
    if directory {
        let path = tauri::async_runtime::spawn_blocking(move || pick_directory(app))
            .await
            .map_err(|e| {
                FileError::detail(
                    "dialog",
                    "无法完成原生文件对话框操作：{detail}",
                    e.to_string(),
                )
            })??;
        if let Some(path) = path {
            access(&state, move |f| f.directory(&path).map(Some)).await
        } else {
            Ok(None)
        }
    } else {
        let paths =
            tauri::async_runtime::spawn_blocking(move || file_dialog(&app).blocking_pick_files())
                .await
                .map_err(|e| {
                    FileError::detail(
                        "dialog",
                        "无法完成原生文件对话框操作：{detail}",
                        e.to_string(),
                    )
                })?;
        if let Some(paths) = paths {
            access(&state, move |f| {
                let mut handles = Vec::new();
                for path in paths {
                    let h = path
                        .into_path()
                        .map_err(|e| {
                            FileError::detail("path", "无法读取所选路径：{detail}", e.to_string())
                        })
                        .and_then(|path| f.grant(&path, false, None));
                    match h {
                        Ok(h) => handles.push(h),
                        Err(e) => {
                            for h in &handles {
                                f.release(&h.token);
                            }
                            return Err(e);
                        }
                    }
                }
                Ok(Some(handles))
            })
            .await
        } else {
            Ok(None)
        }
    }
}
#[tauri::command]
async fn read_chunk(
    state: State<'_, NativeFiles>,
    token: String,
    offset: u64,
    length: usize,
) -> Result<tauri::ipc::Response> {
    access(&state, move |f| {
        f.read(&token, offset, length)
            .map(tauri::ipc::Response::new)
    })
    .await
}
#[tauri::command]
async fn refresh_file(state: State<'_, NativeFiles>, token: String) -> Result<Handle> {
    access(&state, move |f| f.refresh(&token)).await
}
#[tauri::command]
async fn release_file(state: State<'_, NativeFiles>, token: String) -> Result<()> {
    access(&state, move |f| {
        f.release(&token);
        Ok(())
    })
    .await
}
#[tauri::command]
async fn begin_write(
    state: State<'_, NativeFiles>,
    token: String,
    length: u64,
    sha256: String,
) -> Result<String> {
    access(&state, move |f| f.begin(&token, length, &sha256)).await
}
#[tauri::command]
async fn write_chunk(
    state: State<'_, NativeFiles>,
    request: tauri::ipc::Request<'_>,
) -> Result<()> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(FileError::localized("body", "保存需要二进制数据"));
    };
    if bytes.len() > crate::files::CHUNK {
        return Err(FileError::localized("limit", "保存分块超过限额"));
    }
    let token = request
        .headers()
        .get("x-transfer-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| FileError::localized("transfer", "缺少保存任务"))?
        .to_owned();
    let offset = request
        .headers()
        .get("x-offset")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .ok_or_else(|| FileError::localized("range", "缺少有效偏移"))?;
    let bytes = bytes.clone();
    access(&state, move |f| f.append(&token, offset, &bytes)).await
}
#[tauri::command]
async fn finish_write(state: State<'_, NativeFiles>, transfer: String) -> Result<Written> {
    access(&state, move |f| f.finish(&transfer)).await
}
#[tauri::command]
async fn cancel_write(state: State<'_, NativeFiles>, transfer: String) -> Result<()> {
    access(&state, move |f| {
        f.cancel(&transfer);
        Ok(())
    })
    .await
}
#[derive(Clone, Default)]
struct NativeDirectories(Arc<Mutex<RuntimeDirectories>>);
async fn directory_access<T: Send + 'static>(
    state: &NativeDirectories,
    work: impl FnOnce(&mut RuntimeDirectories) -> Result<T> + Send + 'static,
) -> Result<T> {
    let directories = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = directories
            .lock()
            .map_err(|_| FileError::localized("state", "目录服务不可用"))?;
        work(&mut guard)
    })
    .await
    .map_err(|e| FileError::detail("task", "原生文件任务失败：{detail}", e.to_string()))?
}
#[tauri::command]
async fn choose_directory_export(
    app: tauri::AppHandle,
    state: State<'_, NativeDirectories>,
    name: String,
    entries: Vec<Entry>,
) -> Result<Option<String>> {
    validate_entries(&entries)?;
    let parent = tauri::async_runtime::spawn_blocking(move || pick_directory(app))
        .await
        .map_err(|e| {
            FileError::detail(
                "dialog",
                "无法完成原生文件对话框操作：{detail}",
                e.to_string(),
            )
        })??;
    match parent {
        Some(parent) => {
            directory_access(&state, move |d| d.begin(&parent, &name, entries).map(Some)).await
        }
        None => Ok(None),
    }
}
#[tauri::command]
async fn write_directory_chunk(
    state: State<'_, NativeDirectories>,
    request: tauri::ipc::Request<'_>,
) -> Result<()> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(FileError::localized("body", "导出需要二进制数据"));
    };
    if bytes.len() > crate::files::CHUNK {
        return Err(FileError::localized("limit", "导出分块超过限额"));
    }
    let header = |key| {
        request
            .headers()
            .get(key)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| FileError::localized("transfer", "缺少目录导出参数"))
    };
    let token = header("x-transfer-id")?.to_owned();
    let index = header("x-file-index")?
        .parse::<usize>()
        .map_err(|_| FileError::localized("range", "文件序号无效"))?;
    let offset = header("x-offset")?
        .parse::<u64>()
        .map_err(|_| FileError::localized("range", "偏移无效"))?;
    let bytes = bytes.clone();
    directory_access(&state, move |d| d.append(&token, index, offset, &bytes)).await
}
#[tauri::command]
async fn finish_directory_export(
    state: State<'_, NativeDirectories>,
    transfer: String,
) -> Result<DirectoryWritten> {
    directory_access(&state, move |d| d.finish(&transfer)).await
}
#[tauri::command]
async fn cancel_directory_export(
    state: State<'_, NativeDirectories>,
    transfer: String,
) -> Result<()> {
    directory_access(&state, move |d| d.cancel(&transfer)).await
}
#[tauri::command]
fn close_confirmed(window: tauri::WebviewWindow) -> Result<()> {
    window
        .destroy()
        .map_err(|e| FileError::detail("window", "无法关闭窗口：{detail}", e.to_string()))
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(NativeFiles::default())
        .manage(NativeDirectories::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("desktop-close-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            choose_project,
            choose_target,
            choose_import,
            read_chunk,
            refresh_file,
            release_file,
            begin_write,
            write_chunk,
            finish_write,
            cancel_write,
            close_confirmed,
            choose_directory_export,
            write_directory_chunk,
            finish_directory_export,
            cancel_directory_export
        ])
        .run(tauri::generate_context!())
        .expect("failed to launch ROCOS Configurator");
}
