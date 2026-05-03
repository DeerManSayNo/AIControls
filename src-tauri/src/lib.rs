//! AIControls — scan installed agents and global skills / MCP / rules.

mod deepseek;
mod scan;
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
    let map = storage::load_scenario_map(&app).unwrap_or_default();
    scan::attach_scenarios(&mut inv, &map);
    Ok(inv)
}

#[tauri::command]
fn scan_project_directory(app: AppHandle, root: String) -> Result<AgentInventory, String> {
    let mut inv = scan::scan_project_directory(std::path::Path::new(&root))?;
    let map = storage::load_scenario_map(&app).unwrap_or_default();
    scan::attach_scenarios(&mut inv, &map);
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
