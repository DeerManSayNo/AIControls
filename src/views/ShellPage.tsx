import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import heroImage from "../../首页头图.png";
import { openProjectPath } from "../api/openProject";
import { revealPathInFolder } from "../api/reveal";
import {
  getAgentGlobalInventoryCached,
  invalidateCachedAgentGlobalInventory,
  invalidateCachedProjectInventory,
  scanProjectDirectoryCached,
} from "../api/agentInventoryCache";
import {
  listDetectedAgents,
  type AgentInventory,
  type AgentScanResult,
} from "../api/agents";
import { bucketInventoryByAgent, inventoryAssetCount } from "../agentAssetGrouping";
import { getOpenAppForProject, setOpenAppForProject } from "../projectOpenAppStorage";
import { useProjectPaths } from "../projectPathsStorage";
import { PageRefreshButton } from "../components/PageRefreshButton";

type Props = {
  title: string;
  subtitle?: string;
};

const AGENT_LABEL_BY_ID: Record<string, string> = {
  cursor: "Cursor",
  claude: "Claude Code",
  trae: "Trae",
  qoder: "Qoder",
  kiro: "Kiro",
};

function fallbackAgentLabel(agentId: string): string {
  return AGENT_LABEL_BY_ID[agentId] ?? agentId;
}

function folderBasename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? path;
}

function summarizeInventory(inv: AgentInventory) {
  return {
    skills: inv.skills.length,
    mcp: inv.mcp.length,
    rules: inv.rules.length,
  };
}

/** 首页统计卡片 →「全部」页；与 `SkillBrowseShell` 的 `?kind=` 约定一致 */
function assetsPathForHomeMetric(metricKey: string): string {
  if (metricKey === "skills") return "/assets?kind=skill";
  if (metricKey === "mcp") return "/assets?kind=mcp";
  if (metricKey === "rules") return "/assets?kind=rule";
  return "/assets";
}

function appLabelFromPath(appPath: string): string {
  const base = appPath.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? appPath;
  return base.replace(/\.(app|exe)$/i, "");
}

type ProjectMenuState = { path: string; left: number; top: number };

export default function ShellPage({ subtitle }: Props) {
  const navigate = useNavigate();
  const projectPaths = useProjectPaths();
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState | null>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const [detectedAgents, setDetectedAgents] = useState<AgentScanResult[]>([]);
  const [totals, setTotals] = useState({ skills: 0, mcp: 0, rules: 0 });
  const [projectStats, setProjectStats] = useState<
    Record<
      string,
      {
        skills: number;
        mcp: number;
        rules: number;
        status: "ok" | "error";
        topAgent: string;
      }
    >
  >({});
  const [homeRefreshKey, setHomeRefreshKey] = useState(0);
  const [homeScanBusy, setHomeScanBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listDetectedAgents().then((agents) => {
      if (cancelled) return;
      setDetectedAgents(agents ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [homeRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    const agentIds = detectedAgents.map((a) => a.id);
    const scanRoots = [...projectPaths];

    if (agentIds.length === 0 && scanRoots.length === 0) {
      setTotals({ skills: 0, mcp: 0, rules: 0 });
      setProjectStats({});
      setHomeScanBusy(false);
      return;
    }

    setHomeScanBusy(true);
    void (async () => {
      try {
        const [agentInventories, scanInventories] = await Promise.all([
          Promise.all(agentIds.map((id) => getAgentGlobalInventoryCached(id))),
          Promise.all(scanRoots.map((root) => scanProjectDirectoryCached(root))),
        ]);
        if (cancelled) return;

        const skillIds = new Set<string>();
        const mcpIds = new Set<string>();
        const ruleIds = new Set<string>();
        const addInventory = (inv: AgentInventory | null) => {
          if (!inv) return;
          for (const e of inv.skills) skillIds.add(e.id);
          for (const e of inv.mcp) mcpIds.add(e.id);
          for (const e of inv.rules) ruleIds.add(e.id);
        };

        for (const inv of agentInventories) addInventory(inv);
        for (const inv of scanInventories) addInventory(inv);

        const nextProjectStats: Record<
          string,
          {
            skills: number;
            mcp: number;
            rules: number;
            status: "ok" | "error";
            topAgent: string;
          }
        > = {};
        for (let i = 0; i < scanRoots.length; i += 1) {
          const root = scanRoots[i];
          const inv = scanInventories[i];
          if (inv) {
            const topBucket = bucketInventoryByAgent(inv).sort(
              (a, b) => inventoryAssetCount(b.inv) - inventoryAssetCount(a.inv),
            )[0];
            nextProjectStats[root] = {
              ...summarizeInventory(inv),
              status: "ok",
              topAgent: topBucket ? fallbackAgentLabel(topBucket.agentId) : "未识别",
            };
          } else {
            nextProjectStats[root] = {
              skills: 0,
              mcp: 0,
              rules: 0,
              status: "error",
              topAgent: "扫描失败",
            };
          }
        }

        setProjectStats(nextProjectStats);
        setTotals({
          skills: skillIds.size,
          mcp: mcpIds.size,
          rules: ruleIds.size,
        });
      } finally {
        if (!cancelled) setHomeScanBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detectedAgents, projectPaths, homeRefreshKey]);

  const metrics = useMemo(
    () => [
      { key: "agent", label: "Agent", value: String(detectedAgents.length) },
      { key: "project", label: "项目", value: String(projectPaths.length) },
      { key: "skills", label: "Skills", value: totals.skills.toLocaleString() },
      { key: "mcp", label: "MCP", value: totals.mcp.toLocaleString() },
      { key: "rules", label: "Rules", value: totals.rules.toLocaleString() },
    ],
    [detectedAgents.length, projectPaths.length, totals],
  );

  const recentProjects = useMemo(
    () =>
      projectPaths.slice(-4).reverse().map((path) => {
        const stat = projectStats[path];
        const assetCount = (stat?.skills ?? 0) + (stat?.mcp ?? 0) + (stat?.rules ?? 0);
        const topAgent =
          detectedAgents.length > 0 ? fallbackAgentLabel(detectedAgents[0].id) : "未识别";
        return {
          name: folderBasename(path),
          path,
          assets: assetCount,
          mcp: stat?.mcp ?? 0,
          rules: stat?.rules ?? 0,
          agent: stat?.topAgent ?? topAgent,
          updated: stat?.status === "error" ? "扫描失败" : "已扫描",
        };
      }),
    [detectedAgents, projectPaths, projectStats],
  );

  const renderMetricIcon = (key: string) => {
    switch (key) {
      case "agent":
        return (
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="7.25" r="2.6" />
            <path d="M6.25 18.2a5.75 5.75 0 0 1 11.5 0" fill="none" strokeLinecap="round" />
            <path d="M3.9 10.8h3.15m13.05 0h-3.15m-5 8.35v-2.5" fill="none" strokeLinecap="round" />
          </svg>
        );
      case "project":
        return (
          <svg viewBox="0 0 24 24" aria-hidden>
            <rect x="4.4" y="5.2" width="15.2" height="13.6" rx="2.4" />
            <path d="M4.4 9.6h15.2M9.05 5.2l1.1 4.4" fill="none" strokeLinecap="round" />
            <circle cx="15.7" cy="14.15" r="1.55" />
          </svg>
        );
      case "skills":
        return (
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M8.2 9.55 12 5.8l3.8 3.75M8.2 14.45 12 18.2l3.8-3.75" fill="none" strokeLinecap="round" />
            <path d="M5.9 12h12.2" fill="none" strokeLinecap="round" />
            <circle cx="12" cy="12" r="1.65" />
          </svg>
        );
      case "mcp":
        return (
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M6.15 6.35h4.35v4.35H6.15zM13.5 6.35h4.35v4.35H13.5zM9.8 13.7h4.4v4.4H9.8z" />
            <path d="M10.5 8.55h3m-1.5 2.15v3.05" fill="none" strokeLinecap="round" />
          </svg>
        );
      default:
        return (
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M6.45 4.9h11.1v14.2H6.45z" />
            <path d="M8.55 9.15h6.9m-6.9 3.2h6.9m-6.9 3.2h4.25" fill="none" strokeLinecap="round" />
          </svg>
        );
    }
  };

  const onRefreshHome = () => {
    invalidateCachedAgentGlobalInventory();
    invalidateCachedProjectInventory();
    setHomeRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    if (!projectMenu) return;
    const close = () => setProjectMenu(null);
    const onPointerDown = (e: PointerEvent) => {
      if (projectMenuRef.current?.contains(e.target as Node)) return;
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
  }, [projectMenu]);

  const closeProjectMenu = () => setProjectMenu(null);

  const pickApplicationForProject = async (projectPath: string) => {
    closeProjectMenu();
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        title: "选择用于打开该项目的应用程序",
      });
      if (selected === null) return;
      const appPath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof appPath === "string" && appPath.length > 0) {
        setOpenAppForProject(projectPath, appPath);
      }
    } catch {
      const manual = window.prompt(
        "请输入应用程序的完整路径（例如 /Applications/Cursor.app）：",
      );
      const trimmed = manual?.trim();
      if (trimmed) setOpenAppForProject(projectPath, trimmed);
    }
  };

  const onOpenProjectCard = (projectPath: string) => {
    const customApp = getOpenAppForProject(projectPath);
    void openProjectPath(projectPath, {
      applicationPath: customApp ?? null,
      alertOnError: true,
    });
  };

  return (
    <div className="home-board">
      <header className="home-board-hero">
        <div className="home-board-hero__toolbar">
          <PageRefreshButton
            onClick={onRefreshHome}
            disabled={homeScanBusy}
            spinning={homeScanBusy}
            label="重新扫描并加载"
          />
        </div>
        <div className="home-board-hero__content">
          <h1 className="home-board-hello">
            下午好，Controler <span aria-hidden>👋</span>
          </h1>
          <p className="home-board-lead">
            {subtitle ??
              `AIControls 已识别到 ${detectedAgents.length} 个 Agent，${projectPaths.length} 个项目`}
          </p>
          <p className="home-board-sub">
            聚合了 {totals.skills.toLocaleString()} 个 Skills，{totals.mcp.toLocaleString()} 个 MCP，{totals.rules.toLocaleString()} 条 Rules
          </p>
        </div>
        <div className="home-board-visual" aria-hidden>
          <img src={heroImage} alt="" className="home-board-visual__image" />
        </div>
      </header>

      <section className="home-board-metrics" aria-label="统计概览">
        {metrics.map((item) => {
          const to = assetsPathForHomeMetric(item.key);
          const navTitle =
            item.key === "skills" || item.key === "mcp" || item.key === "rules"
              ? `前往「全部」资产页（${item.label}）`
              : "前往「全部」资产页";
          return (
            <article
              key={item.label}
              className={`home-board-metric home-board-metric--${item.key} home-board-metric--interactive`}
              role="button"
              tabIndex={0}
              title={navTitle}
              onClick={() => navigate(to)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(to);
                }
              }}
            >
              <p className="home-board-metric__label">
                <span className="home-board-metric__icon" aria-hidden>
                  {renderMetricIcon(item.key)}
                </span>
                {item.label}
              </p>
              <p className="home-board-metric__value">{item.value}</p>
            </article>
          );
        })}
      </section>

      <section className="home-board-projects" aria-label="最近项目">
        <div className="home-board-section-head">
          <h2>最近项目</h2>
        </div>
        <div className="home-board-project-grid">
          {recentProjects.map((project) => (
            <article
              className="home-board-project-card home-board-project-card--interactive"
              key={project.path}
              role="button"
              tabIndex={0}
              onClick={() => onOpenProjectCard(project.path)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenProjectCard(project.path);
                }
              }}
            >
              <div className="home-board-project-card__head">
                <div>
                  <h3>{project.name}</h3>
                  <p title={project.path}>{project.path}</p>
                </div>
                <button
                  type="button"
                  className="home-board-project-card__menu"
                  aria-label="更多操作"
                  aria-haspopup="menu"
                  aria-expanded={projectMenu?.path === project.path}
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    const menuWidth = 200;
                    const gap = 4;
                    const maxLeft = window.innerWidth - menuWidth - 8;
                    /** 菜单左缘从 ⋮ 按钮右缘向右展开，贴右屏时向左夹紧 */
                    const left = Math.max(8, Math.min(r.right + gap, maxLeft));
                    setProjectMenu((prev) =>
                      prev?.path === project.path
                        ? null
                        : { path: project.path, left, top: r.bottom + 4 },
                    );
                  }}
                >
                  ⋮
                </button>
              </div>
              <div className="home-board-project-card__stats">
                <span>● {project.assets}</span>
                <span>✦ {project.mcp}</span>
                <span>◈ {project.rules}</span>
              </div>
              <div className="home-board-project-card__foot">
                {(() => {
                  const customApp = getOpenAppForProject(project.path);
                  const label = customApp ? appLabelFromPath(customApp) : "VS Code";
                  const title = customApp
                    ? `打开应用：${customApp}`
                    : "打开应用：默认（VS Code → Cursor → 文件夹）";
                  return (
                    <span className="home-board-chip" title={title}>
                      {label}
                    </span>
                  );
                })()}
                <span>{project.updated}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
      {projectMenu
        ? createPortal(
            <div
              ref={projectMenuRef}
              className="card-context-menu"
              style={{
                position: "fixed",
                left: projectMenu.left,
                top: projectMenu.top,
                zIndex: 10_000,
                minWidth: "11.5rem",
              }}
              role="menu"
              aria-label="项目打开方式"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                className="card-context-menu__item"
                onClick={() => pickApplicationForProject(projectMenu.path)}
              >
                选择默认打开应用…
              </button>
              <button
                type="button"
                role="menuitem"
                className="card-context-menu__item"
                onClick={() => {
                  void revealPathInFolder(projectMenu.path, { alertOnError: true });
                  closeProjectMenu();
                }}
              >
                打开所在目录
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
