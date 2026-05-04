//! AIControls — scan installed agents and global skills / MCP / rules.

mod deepseek;
mod gitee;
mod prompt_library;
mod resource_library;
mod scan;
mod skill_copy;
mod storage;

use scan::AgentInventory;
use tauri::AppHandle;

fn latest_file_mtime_in_dir(root: &std::path::Path) -> Result<i64, String> {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    if !root.exists() {
        return Err("路径不存在".into());
    }
    if !root.is_dir() {
        return Err("路径不是文件夹".into());
    }

    let mut best: Option<SystemTime> = None;
    let mut stack: Vec<std::path::PathBuf> = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let md = fs::metadata(&dir).ok();
        if let Some(m) = md.and_then(|m| m.modified().ok()) {
            best = Some(best.map_or(m, |cur| cur.max(m)));
        }

        let Ok(rd) = fs::read_dir(&dir) else {
            continue;
        };
        for ent in rd.flatten() {
            let path = ent.path();
            // Avoid following symlink directories (can introduce cycles).
            let ft = ent.file_type().ok();
            if ft.as_ref().is_some_and(|t| t.is_symlink()) {
                let md = fs::symlink_metadata(&path).ok();
                if let Some(m) = md.and_then(|m| m.modified().ok()) {
                    best = Some(best.map_or(m, |cur| cur.max(m)));
                }
                continue;
            }

            let md = ent.metadata().ok();
            if let Some(m) = md.as_ref().and_then(|m| m.modified().ok()) {
                best = Some(best.map_or(m, |cur| cur.max(m)));
            }
            if md.as_ref().is_some_and(|m| m.is_dir()) {
                stack.push(path);
            }
        }
    }

    let Some(t) = best else {
        return Err("无法读取目录修改时间".into());
    };
    let ms = t
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "无法解析修改时间".to_string())?
        .as_millis();
    Ok(ms as i64)
}

#[tauri::command]
fn list_detected_agents() -> Vec<scan::AgentScanResult> {
    scan::detect_agents()
}

#[tauri::command]
fn get_agent_global_inventory(
    app: AppHandle,
    agent_id: String,
) -> Result<AgentInventory, String> {
    let mut inv = scan::global_inventory(&agent_id)?;
    let scenario_map = storage::load_scenario_map(&app).unwrap_or_default();
    scan::attach_scenarios(&mut inv, &scenario_map);
    let brief_map = storage::load_brief_map(&app).unwrap_or_default();
    scan::attach_briefs(&mut inv, &brief_map);
    Ok(inv)
}

#[tauri::command]
fn scan_project_directory(app: AppHandle, root: String) -> Result<AgentInventory, String> {
    let mut inv = scan::scan_project_directory(std::path::Path::new(&root))?;
    let scenario_map = storage::load_scenario_map(&app).unwrap_or_default();
    scan::attach_scenarios(&mut inv, &scenario_map);
    let brief_map = storage::load_brief_map(&app).unwrap_or_default();
    scan::attach_briefs(&mut inv, &brief_map);
    Ok(inv)
}

#[tauri::command]
fn read_skill_document(path: String) -> Result<(String, String), String> {
    scan::read_skill_document(std::path::Path::new(&path))
}

#[tauri::command]
fn get_deepseek_settings(app: AppHandle) -> Result<storage::DeepseekSettingsPublic, String> {
    storage::get_deepseek_settings_public(&app)
}

#[tauri::command]
fn save_deepseek_settings(app: AppHandle, api_key: String) -> Result<(), String> {
    storage::save_deepseek_api_key(&app, api_key)
}

#[tauri::command]
async fn test_deepseek_connection(app: AppHandle) -> Result<String, String> {
    let key = storage::load_deepseek_api_key(&app)?
        .ok_or_else(|| "请先在下方保存 DeepSeek API Key。".to_string())?;
    deepseek::test_ping(&key).await
}

#[tauri::command]
async fn deepseek_classify_inventory(
    app: AppHandle,
    inventory: AgentInventory,
) -> Result<AgentInventory, String> {
    deepseek::classify_inventory_missing(&app, inventory).await
}

#[tauri::command]
async fn deepseek_summarize_inventory(
    app: AppHandle,
    inventory: AgentInventory,
) -> Result<AgentInventory, String> {
    deepseek::summarize_inventory_missing(&app, inventory).await
}

#[tauri::command]
async fn deepseek_enrich_resource_url(
    app: AppHandle,
    url: String,
) -> Result<deepseek::ResourceUrlEnrichment, String> {
    deepseek::enrich_resource_from_url(&app, url).await
}

/// 在系统文件管理器中打开路径：文件则打开其所在文件夹并选中；文件夹则打开该文件夹。
#[tauri::command]
fn reveal_path_in_folder(path: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("路径为空".into());
    }
    let p = std::path::Path::new(path);
    if !p.exists() {
        return Err("路径不存在".into());
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let st = if p.is_dir() {
            Command::new("open").arg(p).status()
        } else {
            Command::new("open").arg("-R").arg(p).status()
        };
        st.map_err(|e| format!("无法打开访达: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        if p.is_dir() {
            Command::new("explorer")
                .arg(p)
                .status()
                .map_err(|e| format!("无法打开资源管理器: {e}"))?;
        } else {
            let arg = format!("/select,{}", p.to_string_lossy());
            Command::new("explorer")
                .arg(arg)
                .status()
                .map_err(|e| format!("无法打开资源管理器: {e}"))?;
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        use std::process::Command;
        let dir = if p.is_dir() {
            p.to_path_buf()
        } else {
            p.parent()
                .ok_or_else(|| "无法解析父目录".to_string())?
                .to_path_buf()
        };
        Command::new("xdg-open")
            .arg(&dir)
            .status()
            .map_err(|e| format!("无法打开文件管理器: {e}"))?;
    }

    Ok(())
}

/// 未指定应用时：依次尝试 Visual Studio Code、Cursor；均不可用时在文件管理器中打开该文件夹。
fn open_project_folder_default_chain(p: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let try_app = |name: &str| -> bool {
            Command::new("open")
                .arg("-a")
                .arg(name)
                .arg(p)
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        };
        if try_app("Visual Studio Code") {
            return Ok(());
        }
        if try_app("Cursor") {
            return Ok(());
        }
        let st = Command::new("open")
            .arg(p)
            .status()
            .map_err(|e| format!("无法打开项目: {e}"))?;
        if !st.success() {
            return Err("打开项目失败".into());
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let try_cli = |name: &str| -> bool {
            Command::new(name)
                .arg(p)
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        };
        if try_cli("code") {
            return Ok(());
        }
        if try_cli("cursor") {
            return Ok(());
        }
        let st = Command::new("explorer")
            .arg(p)
            .status()
            .map_err(|e| format!("无法打开项目: {e}"))?;
        if !st.success() {
            return Err("打开项目失败".into());
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        use std::process::Command;
        let try_cli = |name: &str| -> bool {
            Command::new(name)
                .arg(p)
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        };
        if try_cli("code") {
            return Ok(());
        }
        if try_cli("cursor") {
            return Ok(());
        }
        let st = Command::new("xdg-open")
            .arg(p)
            .status()
            .map_err(|e| format!("无法打开项目: {e}"))?;
        if !st.success() {
            return Err("打开项目失败".into());
        }
    }
    Ok(())
}

/// 打开项目根目录：未指定 `application_path` 时先试 VS Code，再试 Cursor，再打开所在文件夹；
/// 指定时为该路径（如 `/Applications/Cursor.app` 或 Windows 下 `.exe` 全路径）打开此文件夹。
#[tauri::command]
fn open_project_path(path: String, application_path: Option<String>) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("路径为空".into());
    }
    let p = std::path::Path::new(path);
    if !p.exists() {
        return Err("路径不存在".into());
    }
    if !p.is_dir() {
        return Err("路径不是文件夹".into());
    }

    let app = application_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    if let Some(a) = app {
        #[cfg(target_os = "macos")]
        {
            use std::process::Command;
            let st = Command::new("open").arg("-a").arg(a).arg(p).status();
            let code = st.map_err(|e| format!("无法打开项目: {e}"))?;
            if !code.success() {
                return Err("打开项目失败".into());
            }
        }
        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            let st = Command::new(a).arg(p).status();
            let code = st.map_err(|e| format!("无法打开项目: {e}"))?;
            if !code.success() {
                return Err("打开项目失败".into());
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            use std::process::Command;
            let st = Command::new(a).arg(p).status();
            let code = st.map_err(|e| format!("无法打开项目: {e}"))?;
            if !code.success() {
                return Err("打开项目失败".into());
            }
        }
        Ok(())
    } else {
        open_project_folder_default_chain(p)
    }
}

/// 递归扫描目录，返回目录下（含子文件/子目录）的最新修改时间（Unix 毫秒）。
#[tauri::command]
fn get_project_latest_mtime_ms(root: String) -> Result<i64, String> {
    latest_file_mtime_in_dir(std::path::Path::new(root.trim()))
}

#[tauri::command]
fn list_visible_project_skill_buckets(
    project_root: String,
) -> Result<Vec<skill_copy::VisibleProjectSkillBucket>, String> {
    skill_copy::list_visible_project_skill_buckets(&project_root)
}

/// 参数与前端 `invoke` 顶层 camelCase 字段一一对应（勿再用单字段 struct，否则需包一层 `{ args: {...} }`）。
#[tauri::command]
fn copy_skill_package(
    source_path: String,
    dest_kind: String,
    agent_id: String,
    bucket_index: usize,
    project_root: Option<String>,
    on_conflict: Option<String>,
) -> Result<String, String> {
    let suffix = match on_conflict.as_deref() {
        Some("error") => false,
        _ => true,
    };
    skill_copy::perform_copy(
        &source_path,
        &dest_kind,
        &agent_id,
        bucket_index,
        project_root.as_deref(),
        suffix,
    )
}

#[tauri::command]
fn delete_skill_at_path(path: String) -> Result<(), String> {
    skill_copy::perform_delete_skill(&path)
}

#[tauri::command]
fn get_prompt_library(app: AppHandle) -> Result<prompt_library::PromptLibraryFile, String> {
    prompt_library::load_prompt_library(&app)
}

#[tauri::command]
fn save_prompt_library(
    app: AppHandle,
    library: prompt_library::PromptLibraryFile,
) -> Result<(), String> {
    prompt_library::save_prompt_library(&app, library)
}

#[tauri::command]
fn get_resource_library(app: AppHandle) -> Result<resource_library::ResourceLibraryFile, String> {
    resource_library::load_resource_library(&app)
}

#[tauri::command]
fn save_resource_library(
    app: AppHandle,
    library: resource_library::ResourceLibraryFile,
) -> Result<(), String> {
    resource_library::save_resource_library(&app, library)
}

#[tauri::command]
fn get_gitee_settings(app: AppHandle) -> Result<storage::GiteeSettingsPublic, String> {
    storage::get_gitee_settings_public(&app)
}

#[tauri::command]
fn save_gitee_app(
    app: AppHandle,
    client_id: String,
    client_secret: String,
    repo_name: String,
) -> Result<(), String> {
    storage::save_gitee_app(&app, client_id, client_secret, repo_name)
}

#[tauri::command]
async fn gitee_oauth_login(app: AppHandle) -> Result<String, String> {
    gitee::oauth_login(app).await
}

/// `force` 默认 `true`：手动备份始终上传。定时任务使用 `force: false` 以在无变更时跳过。
#[tauri::command]
async fn gitee_backup_now(app: AppHandle, force: Option<bool>) -> Result<String, String> {
    gitee::backup_now(app, force.unwrap_or(true)).await
}

#[tauri::command]
fn gitee_disconnect(app: AppHandle) -> Result<(), String> {
    gitee::disconnect(&app)
}

#[tauri::command]
async fn gitee_restore_from_repo_url(app: AppHandle, repo_url: String) -> Result<String, String> {
    gitee::restore_from_repo_url(app, repo_url).await
}

#[tauri::command]
fn get_gitee_sync_status(app: AppHandle) -> Result<gitee::GiteeSyncStatusPublic, String> {
    gitee::get_gitee_sync_status(&app)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            gitee::sync_ui_schedule_next_in_secs(300);
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    gitee::sync_ui_schedule_next_in_secs(300);
                    tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                    gitee::backup_periodic_tick(handle.clone()).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_detected_agents,
            get_agent_global_inventory,
            scan_project_directory,
            read_skill_document,
            get_deepseek_settings,
            save_deepseek_settings,
            test_deepseek_connection,
            deepseek_classify_inventory,
            deepseek_summarize_inventory,
            deepseek_enrich_resource_url,
            reveal_path_in_folder,
            open_project_path,
            get_project_latest_mtime_ms,
            copy_skill_package,
            delete_skill_at_path,
            list_visible_project_skill_buckets,
            get_prompt_library,
            save_prompt_library,
            get_resource_library,
            save_resource_library,
            get_gitee_settings,
            save_gitee_app,
            gitee_oauth_login,
            gitee_backup_now,
            gitee_disconnect,
            gitee_restore_from_repo_url,
            get_gitee_sync_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
