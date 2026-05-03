//! Scan installed agent apps and read global (non-project) skills, MCP, rules.
//! Project scan walks a user-chosen directory recursively (agnostic of `.cursor` / `.claude` layout).

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct AgentScanResult {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetEntry {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub description: String,
    pub path: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentInventory {
    pub skills: Vec<AssetEntry>,
    pub mcp: Vec<AssetEntry>,
    pub rules: Vec<AssetEntry>,
}

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

fn stable_id(prefix: &str, path: &Path) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    prefix.hash(&mut h);
    path.to_string_lossy().hash(&mut h);
    format!("{}-{:x}", prefix, h.finish())
}

/// macOS: `/Applications/Foo.app`
#[cfg(target_os = "macos")]
fn app_bundle_exists(name: &str) -> bool {
    Path::new("/Applications")
        .join(format!("{name}.app"))
        .is_dir()
}

#[cfg(not(target_os = "macos"))]
fn app_bundle_exists(_name: &str) -> bool {
    false
}

pub fn detect_agents() -> Vec<AgentScanResult> {
    let home = home_dir();
    let mut out = Vec::new();

    if detect_cursor(&home) {
        out.push(AgentScanResult {
            id: "cursor".into(),
            label: "Cursor".into(),
        });
    }
    if detect_claude(&home) {
        out.push(AgentScanResult {
            id: "claude".into(),
            label: "Claude Code".into(),
        });
    }
    if detect_trae(&home) {
        out.push(AgentScanResult {
            id: "trae".into(),
            label: "Trae".into(),
        });
    }
    if detect_qoder(&home) {
        out.push(AgentScanResult {
            id: "qoder".into(),
            label: "Qoder".into(),
        });
    }

    out
}

fn detect_cursor(home: &Path) -> bool {
    app_bundle_exists("Cursor") || home.join(".cursor").is_dir()
}

fn detect_claude(home: &Path) -> bool {
    home.join(".claude").is_dir()
}

fn detect_trae(home: &Path) -> bool {
    app_bundle_exists("Trae")
        || app_bundle_exists("Trae CN")
        || home.join(".trae").is_dir()
}

fn detect_qoder(home: &Path) -> bool {
    app_bundle_exists("Qoder")
        || home.join(".qoder").is_dir()
        || home.join(".qoderwork").is_dir()
}

fn should_skip_scan_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | "vendor"
            | ".cache"
            | "coverage"
            | ".svn"
            | ".hg"
    )
}

fn walk_skill_files(dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<PathBuf>) {
    if depth > max_depth || !dir.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for ent in entries.flatten() {
        let p = ent.path();
        if p.is_dir() {
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if should_skip_scan_dir(name) {
                    continue;
                }
            }
            walk_skill_files(&p, depth + 1, max_depth, out);
        } else if p.file_name().and_then(|n| n.to_str()) == Some("SKILL.md") {
            out.push(p);
        }
    }
}

/// Project tree: skip heavy / external dirs; same SKILL.md discovery.
fn walk_skill_files_project(dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<PathBuf>) {
    if depth > max_depth || !dir.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for ent in entries.flatten() {
        let p = ent.path();
        if p.is_dir() {
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if should_skip_scan_dir(name) {
                    continue;
                }
            }
            walk_skill_files_project(&p, depth + 1, max_depth, out);
        } else if p.file_name().and_then(|n| n.to_str()) == Some("SKILL.md") {
            out.push(p);
        }
    }
}

fn walk_rule_files(dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<PathBuf>) {
    if depth > max_depth || !dir.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for ent in entries.flatten() {
        let p = ent.path();
        if p.is_dir() {
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if should_skip_scan_dir(name) {
                    continue;
                }
            }
            walk_rule_files(&p, depth + 1, max_depth, out);
        } else if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
            if name == "SKILL.md" {
                continue;
            }
            if name.ends_with(".mdc") || name.ends_with(".md") {
                out.push(p);
            }
        }
    }
}

fn walk_rule_files_project(dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<PathBuf>) {
    if depth > max_depth || !dir.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for ent in entries.flatten() {
        let p = ent.path();
        if p.is_dir() {
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if should_skip_scan_dir(name) {
                    continue;
                }
            }
            walk_rule_files_project(&p, depth + 1, max_depth, out);
        } else if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
            if name == "SKILL.md" {
                continue;
            }
            if name.ends_with(".mdc") || name.ends_with(".md") {
                out.push(p);
            }
        }
    }
}

fn collect_skill_files(root: &Path, out: &mut Vec<PathBuf>) {
    if root.is_dir() {
        walk_skill_files(root, 0, 12, out);
    }
}

fn collect_rule_files(root: &Path, out: &mut Vec<PathBuf>) {
    if root.is_dir() {
        walk_rule_files(root, 0, 12, out);
    }
}

fn collect_skill_files_project(root: &Path, out: &mut Vec<PathBuf>) {
    if root.is_dir() {
        walk_skill_files_project(root, 0, 16, out);
    }
}

fn collect_rule_files_project(root: &Path, out: &mut Vec<PathBuf>) {
    if root.is_dir() {
        walk_rule_files_project(root, 0, 16, out);
    }
}

fn read_preview(path: &Path, max: usize) -> String {
    fs::read_to_string(path)
        .map(|s| trim_frontmatter_preview(&s, max))
        .unwrap_or_default()
}

fn trim_frontmatter_preview(s: &str, max: usize) -> String {
    let t = s.trim();
    let body = if t.starts_with("---") {
        if let Some(rest) = t.strip_prefix("---") {
            if let Some(end) = rest.find("\n---") {
                rest[end + 4..].trim()
            } else {
                t
            }
        } else {
            t
        }
    } else {
        t
    };
    let one_line = body.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    truncate_chars(one_line.trim(), max)
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect::<String>() + "…"
    }
}

fn push_skills_from_paths(mut paths: Vec<PathBuf>, list: &mut Vec<AssetEntry>) {
    paths.sort();
    for p in paths {
        let title = p
            .parent()
            .and_then(|x| x.file_name())
            .map(|x| x.to_string_lossy().into_owned())
            .unwrap_or_else(|| "skill".into());
        let desc = read_preview(&p, 160);
        let desc = if desc.is_empty() {
            p.to_string_lossy().into_owned()
        } else {
            desc
        };
        list.push(AssetEntry {
            id: stable_id("skill", &p),
            kind: "skill".into(),
            title,
            description: desc,
            path: p.to_string_lossy().into_owned(),
            active: true,
        });
    }
}

fn push_skills_from_roots(roots: &[PathBuf], list: &mut Vec<AssetEntry>) {
    let mut paths = Vec::new();
    for r in roots {
        collect_skill_files(r, &mut paths);
    }
    push_skills_from_paths(paths, list);
}

fn push_skills_from_project_root(root: &Path, list: &mut Vec<AssetEntry>) {
    let mut paths = Vec::new();
    collect_skill_files_project(root, &mut paths);
    push_skills_from_paths(paths, list);
}

fn push_rules_from_paths(mut paths: Vec<PathBuf>, list: &mut Vec<AssetEntry>) {
    paths.sort();
    for p in paths {
        let title = p
            .file_stem()
            .map(|x| x.to_string_lossy().into_owned())
            .unwrap_or_else(|| "rule".into());
        let desc = read_preview(&p, 160);
        let desc = if desc.is_empty() {
            p.to_string_lossy().into_owned()
        } else {
            desc
        };
        list.push(AssetEntry {
            id: stable_id("rule", &p),
            kind: "rule".into(),
            title,
            description: desc,
            path: p.to_string_lossy().into_owned(),
            active: true,
        });
    }
}

fn push_rules_from_roots(roots: &[PathBuf], list: &mut Vec<AssetEntry>) {
    let mut paths = Vec::new();
    for r in roots {
        collect_rule_files(r, &mut paths);
    }
    push_rules_from_paths(paths, list);
}

fn push_rules_from_project_root(root: &Path, list: &mut Vec<AssetEntry>) {
    let mut paths = Vec::new();
    collect_rule_files_project(root, &mut paths);
    push_rules_from_paths(paths, list);
}

fn parse_mcp_object_at(
    map: &serde_json::Map<String, Value>,
    source_json: Option<&Path>,
    list: &mut Vec<AssetEntry>,
) {
    for (name, cfg) in map {
        let desc = match cfg {
            Value::Object(o) => {
                let cmd = o.get("command").and_then(|v| v.as_str()).unwrap_or("");
                let args = o
                    .get("args")
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str())
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                    .unwrap_or_default();
                let url = o.get("url").and_then(|v| v.as_str()).unwrap_or("");
                if !url.is_empty() {
                    format!("url: {url}")
                } else if !cmd.is_empty() {
                    format!("{cmd} {args}").trim().to_string()
                } else {
                    cfg.to_string()
                }
            }
            _ => cfg.to_string(),
        };
        let id_key = match source_json {
            Some(p) => format!("{}|{}", p.to_string_lossy(), name),
            None => name.clone(),
        };
        list.push(AssetEntry {
            id: stable_id("mcp", Path::new(&id_key)),
            kind: "mcp".into(),
            title: name.clone(),
            description: desc,
            path: source_json
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|| format!("mcp:{name}")),
            active: true,
        });
    }
}

fn parse_mcp_file(path: &Path, list: &mut Vec<AssetEntry>) {
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    let Ok(v) = serde_json::from_str::<Value>(&text) else {
        return;
    };
    if let Some(m) = v.get("mcpServers").and_then(|x| x.as_object()) {
        parse_mcp_object_at(m, Some(path), list);
        return;
    }
    if let Some(m) = v.get("servers").and_then(|x| x.as_object()) {
        parse_mcp_object_at(m, Some(path), list);
    }
}

fn merge_mcp_from_json_value(v: &Value, list: &mut Vec<AssetEntry>) {
    merge_mcp_from_json_value_at(v, None, list);
}

fn merge_mcp_from_json_value_at(
    v: &Value,
    source_json: Option<&Path>,
    list: &mut Vec<AssetEntry>,
) {
    if let Some(m) = v.get("mcpServers").and_then(|x| x.as_object()) {
        parse_mcp_object_at(m, source_json, list);
    }
    if let Some(m) = v.get("mcp").and_then(|x| x.as_object()) {
        parse_mcp_object_at(m, source_json, list);
    }
}

fn walk_json_for_mcp(dir: &Path, depth: usize, max_depth: usize, list: &mut Vec<AssetEntry>) {
    if depth > max_depth || !dir.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for ent in entries.flatten() {
        let p = ent.path();
        if p.is_dir() {
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if should_skip_scan_dir(name) {
                    continue;
                }
            }
            walk_json_for_mcp(&p, depth + 1, max_depth, list);
        } else if p.extension().and_then(|e| e.to_str()) == Some("json") {
            let Ok(text) = fs::read_to_string(&p) else {
                continue;
            };
            let Ok(v) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            if p.file_name().and_then(|n| n.to_str()) == Some("mcp.json") {
                parse_mcp_file(&p, list);
            } else {
                merge_mcp_from_json_value_at(&v, Some(&p), list);
            }
        }
    }
}

/// Walks `root` recursively: `SKILL.md`, `.md`/`.mdc` rules (excluding `SKILL.md`), and MCP entries from JSON (`mcp.json`, `settings*.json` with MCP keys, etc.).
pub fn scan_project_directory(root: &Path) -> Result<AgentInventory, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("无法解析路径: {e}"))?;
    if !root.is_dir() {
        return Err("所选路径不是文件夹".into());
    }

    let mut skills = Vec::new();
    let mut mcp = Vec::new();
    let mut rules = Vec::new();

    push_skills_from_project_root(&root, &mut skills);
    walk_json_for_mcp(&root, 0, 16, &mut mcp);
    push_rules_from_project_root(&root, &mut rules);

    dedupe_mcp(&mut mcp);

    Ok(AgentInventory {
        skills,
        mcp,
        rules,
    })
}

pub fn global_inventory(agent_id: &str) -> Result<AgentInventory, String> {
    let home = home_dir();
    let mut skills = Vec::new();
    let mut mcp = Vec::new();
    let mut rules = Vec::new();

    match agent_id {
        "cursor" => {
            let roots_skill = vec![
                home.join(".cursor/skills-cursor"),
                home.join(".cursor/skills"),
            ];
            push_skills_from_roots(&roots_skill, &mut skills);
            let mcp_path = home.join(".cursor/mcp.json");
            if mcp_path.is_file() {
                parse_mcp_file(&mcp_path, &mut mcp);
            }
            push_rules_from_roots(&[home.join(".cursor/rules")], &mut rules);
        }
        "claude" => {
            push_skills_from_roots(&[home.join(".claude/skills")], &mut skills);
            let settings = home.join(".claude/settings.json");
            if settings.is_file() {
                if let Ok(text) = fs::read_to_string(&settings) {
                    if let Ok(v) = serde_json::from_str::<Value>(&text) {
                        merge_mcp_from_json_value(&v, &mut mcp);
                    }
                }
            }
            let local = home.join(".claude/settings.local.json");
            if local.is_file() {
                if let Ok(text) = fs::read_to_string(&local) {
                    if let Ok(v) = serde_json::from_str::<Value>(&text) {
                        merge_mcp_from_json_value(&v, &mut mcp);
                    }
                }
            }
            let root_json = home.join(".claude.json");
            if root_json.is_file() {
                if let Ok(text) = fs::read_to_string(&root_json) {
                    if let Ok(v) = serde_json::from_str::<Value>(&text) {
                        merge_mcp_from_json_value(&v, &mut mcp);
                    }
                }
            }
            push_rules_from_roots(&[home.join(".claude/rules")], &mut rules);
        }
        "trae" => {
            push_skills_from_roots(&[home.join(".trae/skills")], &mut skills);
            for name in [".trae/mcp.json", ".cursor/mcp.json"] {
                let p = home.join(name);
                if p.is_file() {
                    parse_mcp_file(&p, &mut mcp);
                }
            }
            #[cfg(target_os = "macos")]
            {
                let asupport = home.join("Library/Application Support/Trae/User/mcp.json");
                if asupport.is_file() {
                    parse_mcp_file(&asupport, &mut mcp);
                }
            }
            push_rules_from_roots(&[home.join(".trae/rules")], &mut rules);
        }
        "qoder" => {
            push_skills_from_roots(
                &[home.join(".qoder/skills"), home.join(".qoderwork/skills")],
                &mut skills,
            );
            for rel in [".qoder/mcp.json", ".qoderwork/mcp.json"] {
                let p = home.join(rel);
                if p.is_file() {
                    parse_mcp_file(&p, &mut mcp);
                }
            }
            for rel in [".qoder/settings.json", ".qoderwork/settings.json"] {
                let p = home.join(rel);
                if p.is_file() {
                    if let Ok(text) = fs::read_to_string(&p) {
                        if let Ok(v) = serde_json::from_str::<Value>(&text) {
                            merge_mcp_from_json_value(&v, &mut mcp);
                        }
                    }
                }
            }
            push_rules_from_roots(
                &[home.join(".qoder/rules"), home.join(".qoderwork/rules")],
                &mut rules,
            );
        }
        _ => return Err(format!("unknown agent: {agent_id}")),
    }

    dedupe_mcp(&mut mcp);

    Ok(AgentInventory {
        skills,
        mcp,
        rules,
    })
}

fn dedupe_mcp(items: &mut Vec<AssetEntry>) {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut i = 0;
    while i < items.len() {
        let key = items[i].title.clone();
        if seen.contains_key(&key) {
            items.remove(i);
        } else {
            seen.insert(key, i);
            i += 1;
        }
    }
}
