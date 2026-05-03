import { invoke } from "@tauri-apps/api/core";

/** 在系统文件管理器中展示该路径（桌面端）；浏览器或无权限时静默失败。 */
export async function revealPathInFolder(path: string): Promise<void> {
  try {
    await invoke("reveal_path_in_folder", { path });
  } catch {
    /* Web 预览或路径无效 */
  }
}
