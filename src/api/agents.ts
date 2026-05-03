import { invoke } from "@tauri-apps/api/core";

export type AgentScanResult = { id: string; label: string };

export type AssetEntry = {
  id: string;
  kind: string;
  title: string;
  description: string;
  path: string;
  active: boolean;
  /** DeepSeek 持久化分类：`dev` | `office` | … */
  scenario?: string | null;
  /** DeepSeek 中文缩略介绍（<=100字） */
  brief_zh?: string | null;
  /** 技能文件夹内除主 SKILL.md 外的其他文件名（path 为目录时由扫描端填充） */
  skill_extra_files?: string[] | null;
};

export type AgentInventory = {
  skills: AssetEntry[];
  mcp: AssetEntry[];
  rules: AssetEntry[];
};

export type AgentId = "cursor" | "claude" | "trae" | "qoder" | "kiro";

export async function listDetectedAgents(): Promise<AgentScanResult[] | null> {
  try {
    return await invoke<AgentScanResult[]>("list_detected_agents");
  } catch {
    return null;
  }
}

export async function getAgentGlobalInventory(
  agentId: string,
): Promise<AgentInventory | null> {
  try {
    return await invoke<AgentInventory>("get_agent_global_inventory", {
      agentId, // Tauri: matches Rust `agent_id`
    });
  } catch {
    return null;
  }
}

/** Scan a project folder: Skills only under each agent’s `skills/` dir, plus MCP JSON and rules (conventional paths). */
export async function scanProjectDirectory(
  root: string,
): Promise<AgentInventory | null> {
  try {
    return await invoke<AgentInventory>("scan_project_directory", { root });
  } catch {
    return null;
  }
}

/** Result of reading a skill/rule document file. */
export interface SkillDocument {
  filename: string;
  content: string;
}

/** Read the documentation file (SKILL.md, README.md, etc.) from a file or directory path.
 *  If `path` is a directory, searches for known doc files (SKILL.md → skill.md → CLAUDE.md → README.md)
 *  up to 4 levels deep. Returns `(filename, content)`.
 */
export async function getSkillDocument(
  path: string,
): Promise<SkillDocument | null> {
  try {
    const [filename, content] = await invoke<[string, string]>(
      "read_skill_document",
      { path },
    );
    return { filename, content };
  } catch {
    return null;
  }
}

export type CopySkillPackageInput = {
  sourcePath: string;
  destKind: "global" | "project";
  agentId: string;
  bucketIndex: number;
  projectRoot?: string;
  onConflict?: "suffix" | "error";
};

function formatInvokeError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** 列出某项目根下「磁盘上已存在 Agent 目录」时可用的复制桶；桌面端失败时返回 null（前端可退回展示全部）。 */
export async function listVisibleProjectSkillBuckets(
  projectRoot: string,
): Promise<{ agentId: string; bucketIndex: number }[] | null> {
  try {
    return await invoke<{ agentId: string; bucketIndex: number }[]>(
      "list_visible_project_skill_buckets",
      { projectRoot },
    );
  } catch {
    return null;
  }
}

/** 将技能包（目录或 skills 根下的单文件 + 可选同名文件夹）复制到允许的全局或项目 Agent skills 目录。 */
export async function copySkillPackage(
  input: CopySkillPackageInput,
): Promise<{ path: string } | { error: string }> {
  try {
    const path = await invoke<string>("copy_skill_package", {
      sourcePath: input.sourcePath,
      destKind: input.destKind,
      agentId: input.agentId,
      bucketIndex: input.bucketIndex,
      projectRoot: input.projectRoot ?? null,
      onConflict: input.onConflict ?? "suffix",
    });
    return { path };
  } catch (e) {
    return { error: formatInvokeError(e) };
  }
}

/** 仅删除技能包文件夹（整目录删除）；散装 SKILL.md 会由后端拒绝。路径须能通过后端与复制相同的校验。 */
export async function deleteSkillAtPath(
  path: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    await invoke<void>("delete_skill_at_path", { path });
    return { ok: true };
  } catch (e) {
    return { error: formatInvokeError(e) };
  }
}
