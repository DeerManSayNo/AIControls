//! DeepSeek Chat API — connectivity test + batched scenario classification.

use crate::scan::{attach_scenarios, AgentInventory, AssetEntry};
use crate::storage;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tauri::AppHandle;

const API_URL: &str = "https://api.deepseek.com/chat/completions";
const MODEL: &str = "deepseek-chat";

const SCENARIO_SLUGS: &[&str] = &[
    "dev",
    "office",
    "creative",
    "data",
    "network",
    "ops",
    "collab",
];

#[derive(Debug, Deserialize)]
struct ChatCompletionBody {
    #[serde(default)]
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: MessageBody,
}

#[derive(Debug, Deserialize)]
struct MessageBody {
    #[serde(default)]
    content: String,
}

fn normalize_slug(raw: &str) -> Option<String> {
    let s = raw.trim().to_lowercase();
    SCENARIO_SLUGS.iter().find(|&&x| x == s.as_str()).map(|s| (*s).to_string())
}

fn extract_json_object(text: &str) -> Result<Value, String> {
    let t = text.trim();
    if let Ok(v) = serde_json::from_str::<Value>(t) {
        return Ok(v);
    }
    let start = t.find('{').ok_or_else(|| "响应中未找到 JSON 对象".to_string())?;
    let end = t.rfind('}').ok_or_else(|| "响应中未找到 JSON 对象结尾".to_string())?;
    let slice = &t[start..=end];
    serde_json::from_str(slice).map_err(|e| format!("解析模型 JSON 失败：{e}"))
}

async fn chat_completion(
    api_key: &str,
    system: &str,
    user: &str,
    json_object_mode: bool,
    max_tokens: u32,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let mut body = json!({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
        "max_tokens": max_tokens,
    });
    if json_object_mode {
        if let Some(o) = body.as_object_mut() {
            o.insert(
                "response_format".into(),
                json!({"type": "json_object"}),
            );
        }
    }

    let res = client
        .post(API_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("DeepSeek 请求失败：{e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!(
            "DeepSeek 返回错误 HTTP {status}：{}",
            err_text.chars().take(400).collect::<String>()
        ));
    }

    let parsed: ChatCompletionBody = res.json().await.map_err(|e| e.to_string())?;
    parsed
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or_else(|| "DeepSeek 响应缺少 choices".to_string())
}

pub async fn test_ping(api_key: &str) -> Result<String, String> {
    let reply = chat_completion(
        api_key,
        "You reply with exactly the word OK and nothing else.",
        "Ping.",
        false,
        16,
    )
    .await?;
    Ok(reply.trim().to_string())
}

fn classify_system_prompt() -> String {
    r#"你是 AIControls 的资产分类助手。输入是多条 Skill / MCP / Rule 的简要信息。
必须为每一条选出 **恰好一个** 英文类别 slug（小写），只能从下列集合中选：
dev — 各类编码、前后端、仓库与 API / MCP 集成等开发全流程
office — 办公自动化、日程、文档、邮件等
creative — 文案、音视频、设计、图像生成与多媒体处理等
data — 数据获取、分析、存储、向量库、数据库等
network — 浏览器自动化、网页抓取、联网搜索与 HTTP 抓取等
ops — 容器、云资源、监控、部署与故障排查等
collab — 团队沟通、项目管理、会议与任务协同等

只输出 **一个 JSON 对象**：键为每条资产的 id（字符串），值为 slug。
不要 Markdown，不要解释，不要多余字段。"#
        .to_string()
}

async fn classify_batch(
    api_key: &str,
    batch: &[AssetEntry],
) -> Result<HashMap<String, String>, String> {
    let mut lines = Vec::new();
    for e in batch {
        lines.push(format!(
            "- id={} kind={} title={} description={}",
            serde_json::to_string(&e.id).map_err(|e| e.to_string())?,
            serde_json::to_string(&e.kind).map_err(|e| e.to_string())?,
            serde_json::to_string(&e.title).map_err(|e| e.to_string())?,
            serde_json::to_string(&e.description).map_err(|e| e.to_string())?,
        ));
    }
    let user = format!(
        "请为下列条目分类（输出 JSON 对象 id→slug）：\n{}",
        lines.join("\n")
    );

    let raw = chat_completion(
        api_key,
        &classify_system_prompt(),
        &user,
        true,
        800,
    )
    .await?;
    let v = extract_json_object(&raw)?;
    let obj = v.as_object().ok_or_else(|| "模型输出不是 JSON 对象".to_string())?;

    let mut out = HashMap::new();
    for (id, val) in obj {
        let slug = val
            .as_str()
            .ok_or_else(|| format!("字段 {id} 的值不是字符串"))?;
        let Some(norm) = normalize_slug(slug) else {
            return Err(format!("条目 {id} 的类别 {slug} 非法"));
        };
        out.insert(id.clone(), norm);
    }

    Ok(out)
}

async fn classify_batch_fill_missing(
    api_key: &str,
    chunk: &[AssetEntry],
) -> Result<HashMap<String, String>, String> {
    let mut delta = classify_batch(api_key, chunk).await?;
    for e in chunk {
        if delta.contains_key(&e.id) {
            continue;
        }
        match classify_batch(api_key, &[e.clone()]).await {
            Ok(m) => delta.extend(m),
            Err(_) => {
                /* 单次失败则跳过该 id，下次扫描仍会尝试 */
            }
        }
    }
    Ok(delta)
}

/// 仅为尚未写入本地缓存 map 的条目调用 DeepSeek；结果持久化并写回 `inventory.scenario`。
pub async fn classify_inventory_missing(
    app: &AppHandle,
    mut inventory: AgentInventory,
) -> Result<AgentInventory, String> {
    let api_key = match storage::load_deepseek_api_key(app)? {
        Some(k) if !k.is_empty() => k,
        _ => return Ok(inventory),
    };

    let mut map = storage::load_scenario_map(app).unwrap_or_default();
    attach_scenarios(&mut inventory, &map);

    let mut seen = HashSet::<String>::new();
    let missing: Vec<AssetEntry> = inventory
        .skills
        .iter()
        .chain(inventory.mcp.iter())
        .chain(inventory.rules.iter())
        .filter(|e| !map.contains_key(&e.id))
        .filter(|e| seen.insert(e.id.clone()))
        .cloned()
        .collect();

    if missing.is_empty() {
        return Ok(inventory);
    }

    const BATCH: usize = 12;
    for chunk in missing.chunks(BATCH) {
        let delta = classify_batch_fill_missing(&api_key, chunk).await?;
        if !delta.is_empty() {
            storage::merge_scenario_map(app, &delta)?;
            map.extend(delta);
            attach_scenarios(&mut inventory, &map);
        }
    }

    Ok(inventory)
}
