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
