import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { NavLink, useNavigate } from "react-router-dom";
import {
  addUserAgentFromPath,
  listDetectedAgents,
  removeAgentFromSidebar,
  type AgentScanResult,
} from "../api/agents";
import { invalidateCachedAgentGlobalInventory } from "../api/agentInventoryCache";
import { revealPathInFolder } from "../api/reveal";
import { useI18n } from "../i18n/provider";
import { NavIconFolderPlus, NavIconForAgent } from "./navIcons";

function navClass(active: boolean) {
  return `side-nav-link${active ? " active" : ""}`;
}

type Props = {
  pendingActivePath?: string | null;
  onPendingActivePath?: (path: string) => void;
};

export default function AgentNavLinks({
  pendingActivePath = null,
  onPendingActivePath,
}: Props) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentScanResult[] | null>(null);
  const [listNonce, setListNonce] = useState(0);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    agent: AgentScanResult;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listDetectedAgents().then(setAgents);
  }, [listNonce]);

  useEffect(() => {
    const bump = () => setListNonce((n) => n + 1);
    window.addEventListener("aicontrols-agents-changed", bump);
    return () => window.removeEventListener("aicontrols-agents-changed", bump);
  }, []);

  const pickAddAgentFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title:
          locale === "zh"
            ? "选择以 . 开头的配置目录（如 .myagent）"
            : "Choose a dot-folder (e.g. .myagent)",
      });
      if (selected === null) return;
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (typeof path !== "string" || path.length === 0) return;
      const r = await addUserAgentFromPath(path);
      if ("error" in r) {
        window.alert(r.error);
        return;
      }
      invalidateCachedAgentGlobalInventory();
      window.dispatchEvent(new Event("aicontrols-agents-changed"));
      navigate(`/agent/${r.id}`);
    } catch {
      const manual = window.prompt(
        locale === "zh"
          ? "无法打开文件夹对话框。请粘贴以 . 开头的配置目录完整路径："
          : "Folder picker unavailable. Paste the full path to a dot-folder:",
      );
      const trimmed = manual?.trim();
      if (!trimmed) return;
      const r = await addUserAgentFromPath(trimmed);
      if ("error" in r) {
        window.alert(r.error);
        return;
      }
      invalidateCachedAgentGlobalInventory();
      window.dispatchEvent(new Event("aicontrols-agents-changed"));
      navigate(`/agent/${r.id}`);
    }
  };

  const addAgentButton = (
    <button
      type="button"
      className="side-nav-link side-nav-action"
      onClick={() => void pickAddAgentFolder()}
      title={t("nav.addAgentTitle")}
    >
      <span className="side-nav-link__icon">
        <NavIconFolderPlus />
      </span>
      <span className="side-nav-link__label side-nav-link__label--cjk-optical">
        {t("nav.addAgent")}
      </span>
    </button>
  );

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

  const closeMenu = () => setMenu(null);

  const openAgentMenu = (e: MouseEvent, agent: AgentScanResult) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, agent });
  };

  if (agents === null) {
    return (
      <div className="side-nav-sub-label" aria-live="polite">
        {t("nav.agentScanning")}
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <>
        <p
          className="side-nav-sub-label"
          title="安装 Cursor、Claude Code、Codex、Hermes、OpenClaw、Trae、Qoder、Kiro 或生成对应用户目录后重新打开"
        >
          {t("nav.noAgents")}
        </p>
        {addAgentButton}
      </>
    );
  }

  return (
    <>
      {agents.map((a) => {
        const to = `/agent/${a.id}`;
        return (
          <NavLink
            key={a.id}
            to={to}
            className={({ isActive }) =>
              navClass(pendingActivePath ? pendingActivePath === to : isActive)
            }
            title={a.rootPath ?? a.label}
            onContextMenuCapture={(e) => openAgentMenu(e, a)}
            onPointerDown={(e) => {
              if (e.button === 0) onPendingActivePath?.(to);
            }}
            onClick={() => onPendingActivePath?.(to)}
          >
            <span className="side-nav-link__icon">
              {NavIconForAgent(a.id)}
            </span>
            <span className="side-nav-link__label">{a.label}</span>
          </NavLink>
        );
      })}
      {addAgentButton}
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
              aria-label={locale === "zh" ? "Agent 操作" : "Agent actions"}
            >
              <button
                type="button"
                role="menuitem"
                className="card-context-menu__item"
                disabled={!menu.agent.rootPath}
                onClick={() => {
                  if (menu.agent.rootPath) {
                    void revealPathInFolder(menu.agent.rootPath, {
                      alertOnError: true,
                    });
                  }
                  closeMenu();
                }}
              >
                {locale === "zh" ? "打开所在目录" : "Open containing folder"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="card-context-menu__item card-context-menu__item--danger"
                onClick={() => {
                  void (async () => {
                    const ok =
                      locale === "zh"
                        ? window.confirm(
                            "从侧栏列表移除此 Agent？\n内置 Agent 可在「设置」中恢复显示。",
                          )
                        : window.confirm(
                            "Remove this agent from the sidebar?\nYou can restore built-in agents in Settings.",
                          );
                    if (!ok) return;
                    const r = await removeAgentFromSidebar(menu.agent.id);
                    if ("error" in r) {
                      window.alert(r.error);
                    } else {
                      invalidateCachedAgentGlobalInventory(menu.agent.id);
                      window.dispatchEvent(new Event("aicontrols-agents-changed"));
                      setListNonce((n) => n + 1);
                    }
                    closeMenu();
                  })();
                }}
              >
                {locale === "zh" ? "从列表移除" : "Remove from list"}
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
