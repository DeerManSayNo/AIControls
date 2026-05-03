//! Copy a skill **package** (folder with `SKILL.md` + siblings/subdirs, or loose `SKILL.md` + optional same-name folder)
//! into an allowed global or project agent `skills` parent directory only.

use std::fs;
use std::path::{Path, PathBuf};

use crate::scan::{extract_skill_declared_name, skills_container_dir};

fn home_dir_buf() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

/// Same order as `global_inventory` / `collect_project_skill_paths` (bucket_index).
pub fn global_skill_parent_dirs(agent_id: &str) -> Result<Vec<PathBuf>, String> {
    let home = home_dir_buf();
    Ok(match agent_id {
        "cursor" => vec![
            home.join(".cursor/skills-cursor"),
            home.join(".cursor/skills"),
        ],
        "claude" => vec![home.join(".claude/skills")],
        "trae" => vec![home.join(".trae/skills")],
        "qoder" => vec![
            home.join(".qoder/skills"),
            home.join(".qoderwork/skills"),
        ],
        "kiro" => vec![home.join(".kiro/skills")],
        _ => return Err(format!("未知 agent: {agent_id}")),
    })
}

/// e.g. `<project>/.cursor/skills` → marker `<project>/.cursor`
fn bucket_agent_marker_path(project_root: &Path, bucket_dest: &Path) -> Option<PathBuf> {
    let rel = bucket_dest.strip_prefix(project_root).ok()?;
    let mut it = rel.components();
    let first = it.next()?;
    Some(project_root.join(first.as_os_str()))
}

fn bucket_agent_marker_exists(project_root: &Path, bucket_dest: &Path) -> bool {
    bucket_agent_marker_path(project_root, bucket_dest)
        .map(|p| p.is_dir())
        .unwrap_or(false)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibleProjectSkillBucket {
    pub agent_id: String,
    pub bucket_index: usize,
}

/// 仅返回「项目根下已存在对应 Agent 目录」时的复制桶（如仅有 `.cursor`/`.claude` 则不会列出 Trae/Qoder 等）。
pub fn list_visible_project_skill_buckets(project_root: &str) -> Result<Vec<VisibleProjectSkillBucket>, String> {
    let root = Path::new(project_root.trim())
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {e}"))?;
    if !root.is_dir() {
        return Err("项目路径不是文件夹".into());
    }
    let mut out = Vec::new();
    for agent_id in ["cursor", "claude", "trae", "qoder", "kiro"] {
        let buckets = project_skill_parent_dirs(&root, agent_id)?;
        for (idx, bucket_path) in buckets.iter().enumerate() {
            if bucket_agent_marker_exists(&root, bucket_path) {
                out.push(VisibleProjectSkillBucket {
                    agent_id: agent_id.to_string(),
                    bucket_index: idx,
                });
            }
        }
    }
    Ok(out)
}

/// Project-relative skill roots for `agent_id` (bucket_index matches this slice).
pub fn project_skill_parent_dirs(project_root: &Path, agent_id: &str) -> Result<Vec<PathBuf>, String> {
    let root = project_root
        .canonicalize()
        .map_err(|e| format!("无法解析项目根目录: {e}"))?;
    if !root.is_dir() {
        return Err("项目根目录不是文件夹".into());
    }
    let rels: &[&str] = match agent_id {
        "cursor" => &[".cursor/skills-cursor", ".cursor/skills"],
        "claude" => &[".claude/skills"],
        "trae" => &[".trae/skills"],
        "qoder" => &[".qoder/skills", ".qoderwork/skills"],
        "kiro" => &[".kiro/skills"],
        _ => return Err(format!("未知 agent: {agent_id}")),
    };
    Ok(rels.iter().map(|r| root.join(r)).collect())
}

fn sanitize_folder_segment(name: &str) -> String {
    let t = name.trim();
    if t.is_empty() {
        return String::new();
    }
    let mut s = String::with_capacity(t.len());
    for ch in t.chars() {
        match ch {
            '/' | '\\' | ':' | '\0' => s.push('-'),
            c if c.is_control() => s.push('-'),
            c => s.push(c),
        }
    }
    let s = s.trim_matches('.').trim().to_string();
    if s.is_empty() {
        "skill".into()
    } else {
        s
    }
}

fn pick_dest_dir(dest_parent: &Path, base: &str, use_suffix: bool) -> Result<PathBuf, String> {
    let base = sanitize_folder_segment(base);
    if base.is_empty() {
        return Err("无效的文件夹名".into());
    }
    if !use_suffix {
        let p = dest_parent.join(&base);
        if p.exists() {
            return Err(format!("目标已存在: {}", p.display()));
        }
        return Ok(p);
    }
    let mut n = 0_u32;
    loop {
        let name = if n == 0 {
            base.clone()
        } else {
            format!("{base}-{n}")
        };
        let p = dest_parent.join(&name);
        if !p.exists() {
            return Ok(p);
        }
        n += 1;
        if n > 10_000 {
            return Err("无法分配不冲突的目标目录名".into());
        }
    }
}

fn copy_tree_merge_contents(from: &Path, to: &Path) -> Result<(), String> {
    if !from.is_dir() {
        return Err(format!("源不是目录: {}", from.display()));
    }
    fs::create_dir_all(to)
        .map_err(|e| format!("创建目录失败 {e}: {}", to.display()))?;
    for ent in fs::read_dir(from)
        .map_err(|e| format!("读取目录失败 {e}: {}", from.display()))?
    {
        let ent = ent.map_err(|e| format!("读取目录项失败: {e}"))?;
        let fp = ent.path();
        let tp = to.join(ent.file_name());
        let ty = ent
            .file_type()
            .map_err(|e| format!("读取文件类型失败 {e}: {}", fp.display()))?;
        if ty.is_dir() {
            copy_tree_merge_contents(&fp, &tp)?;
        } else if ty.is_file() {
            if let Some(parent) = tp.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("{e}"))?;
            }
            fs::copy(&fp, &tp).map_err(|e| {
                format!(
                    "复制文件失败 {e}: {} → {}",
                    fp.display(),
                    tp.display()
                )
            })?;
        }
    }
    Ok(())
}

enum SkillCopySource {
    /// Recursively copy everything under this directory into a new folder under dest parent.
    Directory { root: PathBuf, folder_base_name: String },
    /// `SKILL.md` (or variant) sits directly under a `skills` container; materialize `dest_parent/<name>/`.
    LooseMarkdown {
        skill_md: PathBuf,
        dest_folder_name: String,
    },
}

fn resolve_skill_copy_source(path: &Path) -> Result<SkillCopySource, String> {
    let path = if path.exists() {
        path
            .canonicalize()
            .map_err(|e| format!("无法解析路径: {e}"))?
    } else {
        return Err("路径不存在".into());
    };

    if path.is_dir() {
        let folder_base_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "skill".into());
        return Ok(SkillCopySource::Directory {
            root: path,
            folder_base_name,
        });
    }

    let parent = path
        .parent()
        .ok_or_else(|| "无法解析技能文件父目录".to_string())?
        .to_path_buf();
    let parent_name = parent
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let content = fs::read_to_string(&path).unwrap_or_default();
    let declared = extract_skill_declared_name(&content);
    let in_container = skills_container_dir(&parent_name);

    if parent.is_dir() && !in_container {
        return Ok(SkillCopySource::Directory {
            root: parent,
            folder_base_name: parent_name,
        });
    }

    if in_container {
        let raw_name = declared
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| path.file_stem().and_then(|s| s.to_str()))
            .unwrap_or("skill");
        let dest_folder_name = sanitize_folder_segment(raw_name);
        return Ok(SkillCopySource::LooseMarkdown {
            skill_md: path,
            dest_folder_name,
        });
    }

    Err("无法解析技能包（仅支持技能目录或位于 skills 根下的 SKILL 文件）".into())
}

fn path_starts_with_canonical(child: &Path, prefix: &Path) -> bool {
    let Ok(c) = child.canonicalize() else {
        return false;
    };
    let Ok(p) = prefix.canonicalize() else {
        return false;
    };
    c.starts_with(&p)
}

fn resolve_dest_parent(
    kind: &str,
    agent_id: &str,
    bucket_index: usize,
    project_root: Option<&Path>,
) -> Result<PathBuf, String> {
    let dest_parent = match kind {
        "global" => {
            let buckets = global_skill_parent_dirs(agent_id)?;
            buckets
                .get(bucket_index)
                .cloned()
                .ok_or_else(|| "bucket_index 越界".to_string())?
        }
        "project" => {
            let root = project_root.ok_or_else(|| "project 模式需要 project_root".to_string())?;
            let buckets = project_skill_parent_dirs(root, agent_id)?;
            buckets
                .get(bucket_index)
                .cloned()
                .ok_or_else(|| "bucket_index 越界".to_string())?
        }
        _ => return Err(format!("未知 kind: {kind}")),
    };
    Ok(dest_parent)
}

/// `on_conflict_suffix`: true → `name`, `name-2`, … ; false → error if exists.
pub fn perform_copy(
    source_path: &str,
    kind: &str,
    agent_id: &str,
    bucket_index: usize,
    project_root: Option<&str>,
    on_conflict_suffix: bool,
) -> Result<String, String> {
    let source = Path::new(source_path.trim());
    let dest_parent = resolve_dest_parent(kind, agent_id, bucket_index, project_root.map(Path::new))?;

    fs::create_dir_all(&dest_parent)
        .map_err(|e| format!("无法创建目标 skills 目录: {e}"))?;

    let dest_parent = dest_parent
        .canonicalize()
        .map_err(|e| format!("无法解析目标目录: {e}"))?;

    if kind == "project" {
        let root = project_root.ok_or_else(|| "project 模式需要 project_root".to_string())?;
        let root = Path::new(root)
            .canonicalize()
            .map_err(|e| format!("无法解析项目根目录: {e}"))?;
        if !dest_parent.starts_with(&root) {
            return Err("目标 skills 目录必须位于所选项目根之下".into());
        }
    }

    let source_kind = resolve_skill_copy_source(source)?;

    let final_dir = match source_kind {
        SkillCopySource::Directory {
            root,
            folder_base_name,
        } => {
            if path_starts_with_canonical(&dest_parent, &root) {
                return Err("不能复制到该技能包自身目录内部".into());
            }
            let dest_dir = pick_dest_dir(&dest_parent, &folder_base_name, on_conflict_suffix)?;
            copy_tree_merge_contents(&root, &dest_dir)?;
            dest_dir
        }
        SkillCopySource::LooseMarkdown {
            skill_md,
            dest_folder_name,
        } => {
            let parent = skill_md
                .parent()
                .ok_or_else(|| "无效路径".to_string())?
                .to_path_buf();
            if path_starts_with_canonical(&dest_parent, &parent) {
                return Err("不能复制到源文件所在目录内部".into());
            }
            let dest_dir = pick_dest_dir(&dest_parent, &dest_folder_name, on_conflict_suffix)?;
            fs::create_dir_all(&dest_dir).map_err(|e| format!("{e}"))?;
            let fname = skill_md
                .file_name()
                .ok_or_else(|| "无效文件名".to_string())?;
            fs::copy(&skill_md, dest_dir.join(fname)).map_err(|e| format!("复制 SKILL 文件失败: {e}"))?;

            // Optional: sibling directory next to the loose markdown, same name as package folder.
            let sibling = parent.join(&dest_folder_name);
            if sibling.is_dir() {
                let can_dest = dest_dir
                    .canonicalize()
                    .map_err(|e| format!("{e}"))?;
                let can_sib = sibling
                    .canonicalize()
                    .map_err(|e| format!("{e}"))?;
                if can_sib != can_dest {
                    copy_tree_merge_contents(&sibling, &dest_dir)?;
                }
            }

            dest_dir
        }
    };

    Ok(final_dir.to_string_lossy().into_owned())
}

/// 仅删除**技能包文件夹**（`remove_dir_all`）。`skills` 根下的散装 `SKILL.md` 只能复制，不提供整夹删除。
pub fn perform_delete_skill(source_path: &str) -> Result<(), String> {
    let trimmed = source_path.trim();
    if trimmed.is_empty() {
        return Err("路径为空".into());
    }
    let sk = resolve_skill_copy_source(Path::new(trimmed))?;
    match sk {
        SkillCopySource::Directory { root, .. } => {
            fs::remove_dir_all(&root).map_err(|e| {
                format!(
                    "删除技能目录失败 ({e}): {}",
                    root.to_string_lossy()
                )
            })?;
        }
        SkillCopySource::LooseMarkdown { .. } => {
            return Err(
                "当前技能为 skills 目录下的散装 SKILL.md，未形成技能文件夹；请整理为文件夹技能包后再删除，或在访达中手动删除该文件。"
                    .into(),
            );
        }
    }
    Ok(())
}
