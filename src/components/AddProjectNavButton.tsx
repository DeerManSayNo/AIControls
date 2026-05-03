import { useNavigate } from "react-router-dom";
import { appendProjectPath } from "../projectPathsStorage";
import { NavIconFolderPlus } from "./navIcons";

export default function AddProjectNavButton() {
  const navigate = useNavigate();

  const pickFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择项目文件夹",
      });
      if (selected === null) return;
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (typeof path === "string" && path.length > 0) {
        appendProjectPath(path);
        navigate(`/project?path=${encodeURIComponent(path)}`);
      }
    } catch {
      const manual = window.prompt(
        "无法打开系统文件夹对话框。\n请粘贴项目根目录的完整路径（或使用桌面客户端）：",
      );
      const trimmed = manual?.trim();
      if (trimmed) {
        appendProjectPath(trimmed);
        navigate(`/project?path=${encodeURIComponent(trimmed)}`);
      }
    }
  };

  return (
    <button
      type="button"
      className="side-nav-link side-nav-action"
      onClick={pickFolder}
      title="选择本地文件夹并扫描其中配置"
    >
      <span className="side-nav-link__icon">
        <NavIconFolderPlus />
      </span>
      <span className="side-nav-link__label side-nav-link__label--cjk-optical">
        添加项目
      </span>
    </button>
  );
}
