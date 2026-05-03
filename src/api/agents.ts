import { invoke } from "@tauri-apps/api/core";

export type AgentScanResult = { id: string; label: string };

export type AssetEntry = {
  id: string;
  kind: string;
  title: string;
  description: string;
  path: string;
  active: boolean;
};

export type AgentInventory = {
  skills: AssetEntry[];
  mcp: AssetEntry[];
  rules: AssetEntry[];
};

export type AgentId = "cursor" | "claude" | "trae" | "qoder";

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

/** Scan a chosen project folder for SKILL.md, MCP JSON, and rules (.md / .mdc). */
export async function scanProjectDirectory(
  root: string,
): Promise<AgentInventory | null> {
  try {
    return await invoke<AgentInventory>("scan_project_directory", { root });
  } catch {
    return null;
  }
}
