use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

const PROMPT_LIBRARY_FILE: &str = "prompt-library.json";
const PROMPT_LIBRARY_TMP: &str = "prompt-library.json.tmp";
const PROMPT_LIBRARY_BAK: &str = "prompt-library.json.bak";
const CURRENT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptItem {
    pub id: String,
    pub r#type: String,
    pub title: String,
    pub prompt: String,
    #[serde(default)]
    pub output_type: String,
    #[serde(default)]
    pub output_example: String,
    #[serde(default)]
    pub related_link: Option<String>,
    #[serde(default)]
    pub image_data_url: Option<String>,
    pub tags: Vec<String>,
    #[serde(default)]
    pub note: String,
    pub folder_id: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptLibraryFile {
    pub version: u32,
    pub folders: Vec<PromptFolder>,
    pub items: Vec<PromptItem>,
}

fn app_prompt_library_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::storage::app_local_dir(app)?;
    Ok(dir.join(PROMPT_LIBRARY_FILE))
}

fn default_folders() -> Vec<PromptFolder> {
    vec![
        PromptFolder {
            id: "image".to_string(),
            name: "图片".to_string(),
            parent_id: None,
        },
        PromptFolder {
            id: "code".to_string(),
            name: "代码".to_string(),
            parent_id: None,
        },
        PromptFolder {
            id: "doc".to_string(),
            name: "文档".to_string(),
            parent_id: None,
        },
        PromptFolder {
            id: "text".to_string(),
            name: "纯文本".to_string(),
            parent_id: None,
        },
    ]
}

fn default_library() -> PromptLibraryFile {
    PromptLibraryFile {
        version: CURRENT_VERSION,
        folders: default_folders(),
        items: Vec::new(),
    }
}

fn root_folder_id_of(
    folder_id: &str,
    by_id: &HashMap<String, PromptFolder>,
) -> Result<String, String> {
    let mut visited = HashSet::new();
    let mut cursor = folder_id.to_string();
    loop {
        if !visited.insert(cursor.clone()) {
            return Err("检测到 folder 循环引用".into());
        }
        let folder = by_id
            .get(&cursor)
            .ok_or_else(|| format!("folder 不存在：{cursor}"))?;
        if let Some(parent) = &folder.parent_id {
            cursor = parent.clone();
        } else {
            return Ok(folder.id.clone());
        }
    }
}

fn validate_and_normalize(mut lib: PromptLibraryFile) -> Result<PromptLibraryFile, String> {
    if lib.version == 0 {
        lib.version = CURRENT_VERSION;
    }
    if lib.version > CURRENT_VERSION {
        return Err(format!(
            "Prompt 库版本过高（{}），请升级应用。",
            lib.version
        ));
    }
    lib.version = CURRENT_VERSION;

    let mut folder_ids = HashSet::new();
    for f in &lib.folders {
        if f.id.trim().is_empty() {
            return Err("folder id 不能为空".into());
        }
        if !folder_ids.insert(f.id.clone()) {
            return Err(format!("folder id 重复：{}", f.id));
        }
    }
    let by_id: HashMap<String, PromptFolder> = lib
        .folders
        .iter()
        .map(|f| (f.id.clone(), f.clone()))
        .collect();

    // Ensure 4 roots exist and are roots.
    for root in ["image", "code", "doc", "text"] {
        let Some(folder) = by_id.get(root) else {
            return Err(format!("缺少根文件夹：{root}"));
        };
        if folder.parent_id.is_some() {
            return Err(format!("根文件夹 {root} 不允许设置 parentId"));
        }
    }

    // Validate all folders can resolve to one of 4 roots.
    for f in &lib.folders {
        let root = root_folder_id_of(&f.id, &by_id)?;
        if !matches!(root.as_str(), "image" | "code" | "doc" | "text") {
            return Err(format!("folder {} 未归属到合法根目录", f.id));
        }
    }

    for item in &mut lib.items {
        item.title = item.title.trim().to_string();
        item.prompt = item.prompt.trim().to_string();
        item.output_type = item.output_type.trim().to_string();
        item.output_example = item.output_example.trim().to_string();
        item.related_link = item
            .related_link
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string);
        item.note = item.note.trim().to_string();
        item.r#type = item.r#type.trim().to_string();
        item.folder_id = item.folder_id.trim().to_string();
        if item.output_type.is_empty() {
            item.output_type = item.r#type.clone();
        }
        if item.title.is_empty() || item.prompt.is_empty() {
            return Err(format!("条目 {} 缺少必填字段", item.id));
        }
        if !matches!(item.output_type.as_str(), "image" | "code" | "doc" | "text") {
            return Err(format!(
                "条目 {} outputType 非法：{}",
                item.id, item.output_type
            ));
        }
        if item.output_type == "image"
            && item
                .image_data_url
                .as_deref()
                .is_some_and(|s| !s.trim().is_empty())
            && !item
                .image_data_url
                .as_deref()
                .unwrap_or_default()
                .trim()
                .starts_with("data:image/")
        {
            return Err(format!("条目 {} 图片数据格式非法", item.id));
        }
        if item.output_type == "image" {
            let has_image = item
                .image_data_url
                .as_deref()
                .is_some_and(|s| !s.trim().is_empty());
            if !has_image {
                return Err(format!("条目 {} 缺少图片输出示例", item.id));
            }
            item.output_example.clear();
        } else {
            item.image_data_url = None;
            if item.output_example.is_empty() {
                return Err(format!("条目 {} 缺少输出示例", item.id));
            }
        }
        if item.id.trim().is_empty() {
            return Err("存在条目 id 为空".into());
        }
        if !matches!(item.r#type.as_str(), "image" | "code" | "doc" | "text") {
            return Err(format!("条目 {} type 非法：{}", item.id, item.r#type));
        }
        let root = root_folder_id_of(&item.folder_id, &by_id)?;
        if root != item.r#type {
            return Err(format!(
                "条目 {} 的 type 与 folder 不一致（{} vs {}）",
                item.id, item.r#type, root
            ));
        }
        let mut tag_set = HashSet::new();
        item.tags = item
            .tags
            .iter()
            .map(|t| t.trim().to_lowercase())
            .filter(|t| !t.is_empty() && tag_set.insert(t.clone()))
            .collect();
    }
    Ok(lib)
}

fn write_library_atomic(app: &AppHandle, lib: &PromptLibraryFile) -> Result<(), String> {
    let path = app_prompt_library_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "无法解析 Prompt 库目录".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    let tmp = parent.join(PROMPT_LIBRARY_TMP);
    let bak = parent.join(PROMPT_LIBRARY_BAK);
    if path.exists() {
        let _ = fs::copy(&path, bak);
    }
    let json =
        serde_json::to_string_pretty(lib).map_err(|e| format!("序列化 Prompt 库失败：{e}"))?;
    fs::write(&tmp, json).map_err(|e| format!("写入临时文件失败：{e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("保存 Prompt 库失败：{e}"))?;
    Ok(())
}

pub fn load_prompt_library(app: &AppHandle) -> Result<PromptLibraryFile, String> {
    let path = app_prompt_library_path(app)?;
    if !path.exists() {
        return Ok(default_library());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("读取 Prompt 库失败：{e}"))?;
    let lib: PromptLibraryFile =
        serde_json::from_str(&text).map_err(|e| format!("解析 Prompt 库失败：{e}"))?;
    validate_and_normalize(lib)
}

pub fn save_prompt_library(app: &AppHandle, lib: PromptLibraryFile) -> Result<(), String> {
    let normalized = validate_and_normalize(lib)?;
    write_library_atomic(app, &normalized)
}

