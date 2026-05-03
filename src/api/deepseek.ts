import { invoke } from "@tauri-apps/api/core";
import type { AgentInventory } from "./agents";

export type DeepseekSettings = {
  apiKeyConfigured: boolean;
};

export async function getDeepseekSettings(): Promise<DeepseekSettings | null> {
  try {
    return await invoke<DeepseekSettings>("get_deepseek_settings");
  } catch {
    return null;
  }
}

export async function saveDeepseekSettings(apiKey: string): Promise<boolean> {
  try {
    await invoke("save_deepseek_settings", { apiKey });
    return true;
  } catch {
    return false;
  }
}

export async function testDeepseekConnection(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const msg = await invoke<string>("test_deepseek_connection");
    return { ok: true, message: msg };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** 对已加载库存中尚未写入本地缓存的条目调用 DeepSeek 分类；密钥未配置时后端直接返回原库存。 */
export async function deepseekClassifyInventory(
  inventory: AgentInventory,
): Promise<AgentInventory | null> {
  try {
    return await invoke<AgentInventory>("deepseek_classify_inventory", {
      inventory,
    });
  } catch {
    return null;
  }
}
