//! AIControls — scan installed agents and global skills / MCP / rules.

mod scan;

#[tauri::command]
fn list_detected_agents() -> Vec<scan::AgentScanResult> {
    scan::detect_agents()
}

#[tauri::command]
fn get_agent_global_inventory(agent_id: String) -> Result<scan::AgentInventory, String> {
    scan::global_inventory(&agent_id)
}

#[tauri::command]
fn scan_project_directory(root: String) -> Result<scan::AgentInventory, String> {
    scan::scan_project_directory(std::path::Path::new(&root))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_detected_agents,
            get_agent_global_inventory,
            scan_project_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
