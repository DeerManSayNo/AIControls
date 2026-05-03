//! Local persistence for DeepSeek API key and AI‑assigned asset scenario labels.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepseekSettingsPublic {
    pub api_key_configured: bool,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct DeepseekSettingsFile {
    #[serde(default)]
    api_key: String,
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(p) = path.parent() {
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn app_local_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("无法解析应用数据目录：{e}"))
}

fn deepseek_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_dir(app)?.join("deepseek_settings.json"))
}

fn scenario_map_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_dir(app)?.join("asset_scenarios.json"))
}

fn brief_map_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_dir(app)?.join("asset_briefs_zh.json"))
}

pub fn get_deepseek_settings_public(app: &AppHandle) -> Result<DeepseekSettingsPublic, String> {
    let configured = load_deepseek_api_key(app)?.map(|s| !s.is_empty()).unwrap_or(false);
    Ok(DeepseekSettingsPublic {
        api_key_configured: configured,
    })
}

pub fn load_deepseek_api_key(app: &AppHandle) -> Result<Option<String>, String> {
    let path = deepseek_settings_path(app)?;
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let file: DeepseekSettingsFile =
        serde_json::from_str(&text).map_err(|e| format!("读取 DeepSeek 配置失败：{e}"))?;
    let k = file.api_key.trim().to_string();
    if k.is_empty() {
        Ok(None)
    } else {
        Ok(Some(k))
    }
}

pub fn save_deepseek_api_key(app: &AppHandle, api_key: String) -> Result<(), String> {
    let path = deepseek_settings_path(app)?;
    ensure_parent(&path)?;
    let file = DeepseekSettingsFile {
        api_key: api_key.trim().to_string(),
    };
    let json =
        serde_json::to_string_pretty(&file).map_err(|e| format!("序列化配置失败：{e}"))?;
    fs::write(path, json).map_err(|e| format!("写入 DeepSeek 配置失败：{e}"))?;
    Ok(())
}

pub fn load_scenario_map(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    let path = scenario_map_path(app)?;
    if !path.is_file() {
        return Ok(HashMap::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: HashMap<String, String> =
        serde_json::from_str(&text).map_err(|e| format!("读取分类缓存失败：{e}"))?;
    Ok(v)
}

pub fn merge_scenario_map(app: &AppHandle, delta: &HashMap<String, String>) -> Result<(), String> {
    if delta.is_empty() {
        return Ok(());
    }
    let mut m = load_scenario_map(app).unwrap_or_default();
    for (k, v) in delta {
        m.insert(k.clone(), v.clone());
    }
    save_scenario_map(app, &m)
}

pub fn load_brief_map(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    let path = brief_map_path(app)?;
    if !path.is_file() {
        return Ok(HashMap::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: HashMap<String, String> =
        serde_json::from_str(&text).map_err(|e| format!("读取缩略介绍缓存失败：{e}"))?;
    Ok(v)
}

pub fn merge_brief_map(app: &AppHandle, delta: &HashMap<String, String>) -> Result<(), String> {
    if delta.is_empty() {
        return Ok(());
    }
    let mut m = load_brief_map(app).unwrap_or_default();
    for (k, v) in delta {
        m.insert(k.clone(), v.clone());
    }
    save_brief_map(app, &m)
}

fn save_scenario_map(app: &AppHandle, map: &HashMap<String, String>) -> Result<(), String> {
    let path = scenario_map_path(app)?;
    ensure_parent(&path)?;
    let json =
        serde_json::to_string_pretty(map).map_err(|e| format!("序列化分类缓存失败：{e}"))?;
    fs::write(path, json).map_err(|e| format!("写入分类缓存失败：{e}"))?;
    Ok(())
}

fn save_brief_map(app: &AppHandle, map: &HashMap<String, String>) -> Result<(), String> {
    let path = brief_map_path(app)?;
    ensure_parent(&path)?;
    let json =
        serde_json::to_string_pretty(map).map_err(|e| format!("序列化缩略介绍缓存失败：{e}"))?;
    fs::write(path, json).map_err(|e| format!("写入缩略介绍缓存失败：{e}"))?;
    Ok(())
}
