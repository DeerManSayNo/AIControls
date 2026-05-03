import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useNavigate } from "react-router-dom";
import { revealPathInFolder } from "../api/reveal";
import { removeProjectPath } from "../projectPathsStorage";
import { NavIconFolder } from "./navIcons";

function folderBasename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "项目";
}

type Props = {
  projectPath: string;
  isCurrent: boolean;
};

export default function ProjectNavItem({ projectPath, isCurrent }: Props) {
  const navigate = useNavigate();
  const to = `/project?path=${encodeURIComponent(projectPath)}`;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const onContextMenuCapture = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const closeMenu = () => setMenu(null);

  const handleRemove = () => {
    if (
      !window.confirm(
        `从侧栏移除「${folderBasename(projectPath)}」？\n不会删除磁盘上的文件夹。`,
      )
    ) {
      return;
    }
    removeProjectPath(projectPath);
    closeMenu();
    if (isCurrent) {
      navigate("/");
    }
  };

  return (
    <>
      <div
        className="side-nav-project-item"
        onContextMenuCapture={onContextMenuCapture}
      >
        <NavLink
          to={to}
          className={() => `side-nav-link${isCurrent ? " active" : ""}`}
          title={projectPath}
        >
          <span className="side-nav-link__icon">
            <NavIconFolder />
          </span>
          <span className="side-nav-link__label">
            {folderBasename(projectPath)}
          </span>
        </NavLink>
      </div>
      {menu
        ? createPortal(
            <div
              ref={menuRef}
              className="card-context-menu"
              style={{
                position: "fixed",
                left: menu.x,
                top: menu.y,
                zIndex: 10_000,
              }}
              role="menu"
              aria-label="项目操作"
            >
              <button
                type="button"
                role="menuitem"
                className="card-context-menu__item"
                onClick={() => {
                  void revealPathInFolder(projectPath, { alertOnError: true });
                  closeMenu();
                }}
              >
                打开所在目录
              </button>
              <button
                type="button"
                role="menuitem"
                className="card-context-menu__item card-context-menu__item--danger"
                onClick={handleRemove}
              >
                删除项目
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
