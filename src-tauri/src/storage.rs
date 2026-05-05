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

fn brief_map_path(app: &AppHandle, locale: &str) -> Result<PathBuf, String> {
    let key = match locale {
        "zh" => "asset_briefs_zh.json",
        "en" => "asset_briefs_en.json",
        _ => "asset_briefs_en.json",
    };
    Ok(app_local_dir(app)?.join(key))
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

pub fn load_brief_map(app: &AppHandle, locale: &str) -> Result<HashMap<String, String>, String> {
    let path = brief_map_path(app, locale)?;
    if !path.is_file() {
        // backward compatibility: legacy zh brief cache file
        if locale == "zh" {
            let legacy = app_local_dir(app)?.join("asset_briefs_zh.json");
            if legacy.is_file() {
                let text = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
                let v: HashMap<String, String> =
                    serde_json::from_str(&text).map_err(|e| format!("读取缩略介绍缓存失败：{e}"))?;
                return Ok(v);
            }
        }
        return Ok(HashMap::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: HashMap<String, String> =
        serde_json::from_str(&text).map_err(|e| format!("读取缩略介绍缓存失败：{e}"))?;
    Ok(v)
}

pub fn merge_brief_map(
    app: &AppHandle,
    locale: &str,
    delta: &HashMap<String, String>,
) -> Result<(), String> {
    if delta.is_empty() {
        return Ok(());
    }
    let mut m = load_brief_map(app, locale).unwrap_or_default();
    for (k, v) in delta {
        m.insert(k.clone(), v.clone());
    }
    save_brief_map(app, locale, &m)
}

fn save_scenario_map(app: &AppHandle, map: &HashMap<String, String>) -> Result<(), String> {
    let path = scenario_map_path(app)?;
    ensure_parent(&path)?;
    let json =
        serde_json::to_string_pretty(map).map_err(|e| format!("序列化分类缓存失败：{e}"))?;
    fs::write(path, json).map_err(|e| format!("写入分类缓存失败：{e}"))?;
    Ok(())
}

fn save_brief_map(
    app: &AppHandle,
    locale: &str,
    map: &HashMap<String, String>,
) -> Result<(), String> {
    let path = brief_map_path(app, locale)?;
    ensure_parent(&path)?;
    let json =
        serde_json::to_string_pretty(map).map_err(|e| format!("序列化缩略介绍缓存失败：{e}"))?;
    fs::write(path, json).map_err(|e| format!("写入缩略介绍缓存失败：{e}"))?;
    Ok(())
}

// --- Gitee OAuth / backup ---

fn gitee_app_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_dir(app)?.join("gitee_app.json"))
}

fn gitee_token_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_dir(app)?.join("gitee_token.json"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GiteeSettingsPublic {
    pub app_configured: bool,
    pub connected: bool,
    pub owner_login: Option<String>,
    pub repo_name: Option<String>,
    /// 已保存的 OAuth Client ID（非密钥，用于表单预填）。
    pub client_id_saved: Option<String>,
    /// 本地已保存的备份仓库名（来自应用配置，用于表单预填）。
    pub saved_repo_name: Option<String>,
    /// 用户须在 Gitee 第三方应用里填写完全一致的回调地址。
    pub oauth_callback_url: String,
}

#[derive(Debug, Deserialize, Serialize, Default)]
pub struct GiteeAppFile {
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    #[serde(default)]
    pub repo_name: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GiteeTokenFile {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    /// 毫秒时间戳；到期前会尝试 refresh。
    #[serde(default)]
    pub expires_at_ms: Option<i64>,
    pub owner_login: String,
    pub repo_name: String,
}

pub fn gitee_oauth_callback_url() -> &'static str {
    "http://127.0.0.1:19876/oauth/gitee/callback"
}

pub fn get_gitee_settings_public(app: &AppHandle) -> Result<GiteeSettingsPublic, String> {
    let app_path = gitee_app_path(app)?;
    let (app_ok, client_id_saved, saved_repo_name) = if app_path.is_file() {
        let text = fs::read_to_string(&app_path).map_err(|e| e.to_string())?;
        let f: GiteeAppFile =
            serde_json::from_str(&text).map_err(|e| format!("读取 Gitee 应用配置失败：{e}"))?;
        let ok = !f.client_id.trim().is_empty() && !f.client_secret.trim().is_empty();
        let cid = if f.client_id.trim().is_empty() {
            None
        } else {
            Some(f.client_id.trim().to_string())
        };
        let sr = if f.repo_name.trim().is_empty() {
            None
        } else {
            Some(f.repo_name.trim().to_string())
        };
        (ok, cid, sr)
    } else {
        (false, None, None)
    };

    let token_path = gitee_token_path(app)?;
    let (connected, owner, repo) = if token_path.is_file() {
        let text = fs::read_to_string(&token_path).map_err(|e| e.to_string())?;
        if let Ok(t) = serde_json::from_str::<GiteeTokenFile>(&text) {
            if !t.access_token.trim().is_empty() && !t.owner_login.trim().is_empty() {
                (
                    true,
                    Some(t.owner_login),
                    Some(t.repo_name).filter(|s| !s.trim().is_empty()),
                )
            } else {
                (false, None, None)
            }
        } else {
            (false, None, None)
        }
    } else {
        (false, None, None)
    };

    Ok(GiteeSettingsPublic {
        app_configured: app_ok,
        connected,
        owner_login: owner,
        repo_name: repo,
        client_id_saved,
        saved_repo_name,
        oauth_callback_url: gitee_oauth_callback_url().to_string(),
    })
}

pub fn load_gitee_app(app: &AppHandle) -> Result<GiteeAppFile, String> {
    let path = gitee_app_path(app)?;
    if !path.is_file() {
        return Ok(GiteeAppFile::default());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("读取 Gitee 应用配置失败：{e}"))
}

fn sanitize_gitee_repo_name(raw: &str) -> String {
    let s = raw.trim().to_lowercase();
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            out.push(c);
        } else if c.is_whitespace() {
            out.push('-');
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "aicontrols-backup".to_string()
    } else {
        out
    }
}

pub fn save_gitee_app(
    app: &AppHandle,
    client_id: String,
    client_secret: String,
    repo_name: String,
) -> Result<(), String> {
    let path = gitee_app_path(app)?;
    let mut prev = load_gitee_app(app).unwrap_or_default();
    let mut id = client_id.trim().to_string();
    if id.is_empty() {
        id = prev.client_id.trim().to_string();
    }
    let mut secret = client_secret.trim().to_string();
    if secret.is_empty() {
        secret = prev.client_secret.clone();
    }
    let repo = repo_name.trim().to_string();
    let repo = if repo.is_empty() {
        "aicontrols-backup".to_string()
    } else {
        sanitize_gitee_repo_name(&repo)
    };
    if id.is_empty() {
        return Err("Client ID 不能为空。".into());
    }
    if secret.is_empty() {
        return Err("Client Secret 不能为空（首次保存请填写完整）。".into());
    }
    prev.client_id = id;
    prev.client_secret = secret;
    prev.repo_name = repo;
    ensure_parent(&path)?;
    let json =
        serde_json::to_string_pretty(&prev).map_err(|e| format!("序列化 Gitee 配置失败：{e}"))?;
    fs::write(path, json).map_err(|e| format!("写入 Gitee 配置失败：{e}"))?;
    Ok(())
}

pub fn load_gitee_token(app: &AppHandle) -> Result<Option<GiteeTokenFile>, String> {
    let path = gitee_token_path(app)?;
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let t: GiteeTokenFile =
        serde_json::from_str(&text).map_err(|e| format!("读取 Gitee 授权失败：{e}"))?;
    if t.access_token.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(t))
}

pub fn save_gitee_token(app: &AppHandle, token: &GiteeTokenFile) -> Result<(), String> {
    let path = gitee_token_path(app)?;
    ensure_parent(&path)?;
    let json =
        serde_json::to_string_pretty(token).map_err(|e| format!("序列化 Gitee 授权失败：{e}"))?;
    fs::write(path, json).map_err(|e| format!("写入 Gitee 授权失败：{e}"))?;
    Ok(())
}

pub fn clear_gitee_token(app: &AppHandle) -> Result<(), String> {
    let path = gitee_token_path(app)?;
    if path.is_file() {
        fs::remove_file(&path).map_err(|e| format!("删除 Gitee 授权文件失败：{e}"))?;
    }
    clear_gitee_backup_fingerprint(app)?;
    Ok(())
}

// --- Gitee 备份内容指纹（用于跳过无变更的定时同步）---

fn gitee_backup_fingerprint_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_dir(app)?.join("gitee_backup_fingerprint.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct GiteeBackupFingerprint {
    #[serde(default)]
    pub prompt_sha256: Option<String>,
    #[serde(default)]
    pub resource_sha256: Option<String>,
    #[serde(default)]
    pub all_scenarios_sha256: Option<String>,
    #[serde(default)]
    pub all_briefs_sha256: Option<String>,
}

pub fn load_gitee_backup_fingerprint(
    app: &AppHandle,
) -> Result<Option<GiteeBackupFingerprint>, String> {
    let path = gitee_backup_fingerprint_path(app)?;
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: GiteeBackupFingerprint =
        serde_json::from_str(&text).map_err(|e| format!("读取备份指纹失败：{e}"))?;
    Ok(Some(v))
}

pub fn save_gitee_backup_fingerprint(
    app: &AppHandle,
    fp: &GiteeBackupFingerprint,
) -> Result<(), String> {
    let path = gitee_backup_fingerprint_path(app)?;
    ensure_parent(&path)?;
    let json =
        serde_json::to_string_pretty(fp).map_err(|e| format!("序列化备份指纹失败：{e}"))?;
    fs::write(path, json).map_err(|e| format!("写入备份指纹失败：{e}"))?;
    Ok(())
}

pub fn clear_gitee_backup_fingerprint(app: &AppHandle) -> Result<(), String> {
    let path = gitee_backup_fingerprint_path(app)?;
    if path.is_file() {
        fs::remove_file(&path).map_err(|e| format!("删除备份指纹失败：{e}"))?;
    }
    Ok(())
}
