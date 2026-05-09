import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import { listDetectedAgents, type AgentScanResult } from "../api/agents";
import { revealPathInFolder } from "../api/reveal";
import { useI18n } from "../i18n/provider";
import { NavIconForAgent } from "./navIcons";

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
  const [agents, setAgents] = useState<AgentScanResult[] | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    agent: AgentScanResult;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listDetectedAgents().then(setAgents);
  }, []);

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
      <p
        className="side-nav-sub-label"
        title="安装 Cursor、Claude Code、Codex、Hermes、OpenClaw、Trae、Qoder、Kiro 或生成对应用户目录后重新打开"
      >
        {t("nav.noAgents")}
      </p>
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
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
