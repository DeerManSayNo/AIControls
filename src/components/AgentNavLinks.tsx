import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { listDetectedAgents, type AgentScanResult } from "../api/agents";
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
  const { t } = useI18n();
  const [agents, setAgents] = useState<AgentScanResult[] | null>(null);

  useEffect(() => {
    listDetectedAgents().then(setAgents);
  }, []);

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
        title="安装 Cursor、Claude Code、Trae、Qoder、Kiro 或生成对应用户目录后重新打开"
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
            onPointerDown={() => onPendingActivePath?.(to)}
            onClick={() => onPendingActivePath?.(to)}
          >
            <span className="side-nav-link__icon">
              {NavIconForAgent(a.id)}
            </span>
            <span className="side-nav-link__label">{a.label}</span>
          </NavLink>
        );
      })}
    </>
  );
}
