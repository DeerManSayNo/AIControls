//! AIControls — scan installed agents and global skills / MCP / rules.

mod deepseek;
mod scan;
mod skill_copy;
mod storage;

use scan::AgentInventory;
use tauri::AppHandle;

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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            reveal_path_in_folder,
            open_project_path,
            copy_skill_package,
            delete_skill_at_path,
            list_visible_project_skill_buckets,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
