import { useEffect, useMemo, useState } from "react";
import heroImage from "../../首页头图.png";
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

export default function ShellPage({ subtitle }: Props) {
  const projectPaths = useProjectPaths();
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
        {metrics.map((item) => (
          <article key={item.label} className={`home-board-metric home-board-metric--${item.key}`}>
            <p className="home-board-metric__label">
              <span className="home-board-metric__icon" aria-hidden>
                {renderMetricIcon(item.key)}
              </span>
              {item.label}
            </p>
            <p className="home-board-metric__value">{item.value}</p>
          </article>
        ))}
      </section>

      <section className="home-board-projects" aria-label="最近项目">
        <div className="home-board-section-head">
          <h2>最近项目</h2>
        </div>
        <div className="home-board-project-grid">
          {recentProjects.map((project) => (
            <article className="home-board-project-card" key={project.name}>
              <div className="home-board-project-card__head">
                <div>
                  <h3>{project.name}</h3>
                  <p>{project.path}</p>
                </div>
                <button type="button" className="home-board-project-card__menu" aria-label="更多操作">
                  ⋮
                </button>
              </div>
              <div className="home-board-project-card__stats">
                <span>● {project.assets}</span>
                <span>✦ {project.mcp}</span>
                <span>◈ {project.rules}</span>
              </div>
              <div className="home-board-project-card__foot">
                <span className="home-board-chip">{project.agent}</span>
                <span>{project.updated}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
