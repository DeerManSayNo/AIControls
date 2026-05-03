import { useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  deepseekClassifyInventory,
  getDeepseekSettings,
} from "../api/deepseek";
import {
  getAgentGlobalInventory,
  listDetectedAgents,
  scanProjectDirectory,
  type AgentInventory,
  type AssetEntry,
} from "../api/agents";
import { useProjectPaths } from "../projectPathsStorage";
import { SkillDetailPanel, type DetailEntry } from "../components/SkillDetailPanel";
import {
  rowMatchesScenarioChip,
  SCENARIO_HINT,
  SCENARIO_LABEL,
  SCENARIO_ORDER,
  type ScenarioKey,
} from "../skillScenarioCategories";

type AssetKind = "skill" | "mcp" | "rule";

type BrowseRow = {
  id: string;
  title: string;
  desc: string;
  kind: AssetKind;
  ecosystem: string;
  tags: string[];
  active: boolean;
  /** 本机路径或占位 id */
  sourcePath?: string;
  /** DeepSeek 分类 slug；未命中时用关键词兜底 */
  scenario?: string | null;
};

/** 与 App 侧栏 Agent 名称一致；在「全部」汇总页用于兜底扫描 */
const AGENT_LABEL_BY_ID: Record<string, string> = {
  cursor: "Cursor",
  claude: "Claude Code",
  trae: "Trae",
  qoder: "Qoder",
  kiro: "Kiro",
};

const FALLBACK_AGENT_IDS = ["cursor", "claude", "trae", "qoder", "kiro"] as const;

function folderBasename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "项目";
}

type AggregateSnapshot = {
  agents: { id: string; title: string; inv: AgentInventory | null }[];
  projects: { path: string; inv: AgentInventory | null }[];
  anyInventoryFailed: boolean;
};

function dedupeMergeInventories(parts: AgentInventory[]): AgentInventory {
  const seen = new Set<string>();
  const skills: AssetEntry[] = [];
  const mcp: AssetEntry[] = [];
  const rules: AssetEntry[] = [];
  const pushUnique = (bucket: AssetEntry[], e: AssetEntry) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    bucket.push(e);
  };
  for (const inv of parts) {
    for (const e of inv.skills) pushUnique(skills, e);
    for (const e of inv.mcp) pushUnique(mcp, e);
    for (const e of inv.rules) pushUnique(rules, e);
  }
  return { skills, mcp, rules };
}

function scenarioMapFromInventory(inv: AgentInventory): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of [...inv.skills, ...inv.mcp, ...inv.rules]) {
    if (e.scenario) m.set(e.id, e.scenario);
  }
  return m;
}

function patchAgentInventory(
  inv: AgentInventory,
  map: Map<string, string>,
): AgentInventory {
  const patch = (e: AssetEntry): AssetEntry => ({
    ...e,
    scenario: map.get(e.id) ?? e.scenario ?? null,
  });
  return {
    skills: inv.skills.map(patch),
    mcp: inv.mcp.map(patch),
    rules: inv.rules.map(patch),
  };
}

function patchAggregateSnapshot(
  snap: AggregateSnapshot,
  map: Map<string, string>,
): AggregateSnapshot {
  return {
    agents: snap.agents.map((a) => ({
      ...a,
      inv: a.inv ? patchAgentInventory(a.inv, map) : null,
    })),
    projects: snap.projects.map((p) => ({
      ...p,
      inv: p.inv ? patchAgentInventory(p.inv, map) : null,
    })),
    anyInventoryFailed: snap.anyInventoryFailed,
  };
}

function inventoryAssetCount(inv: AgentInventory): number {
  return inv.skills.length + inv.mcp.length + inv.rules.length;
}

type FilterKey = "all" | AssetKind;

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "全部",
  skill: "Skill",
  mcp: "MCP",
  rule: "Rules",
};

const SEGMENT_KEYS: FilterKey[] = ["all", "skill", "mcp", "rule"];

function inventoryToRows(
  inv: AgentInventory,
  ecosystem: string,
  agentTitle: string,
): BrowseRow[] {
  const rows: BrowseRow[] = [];
  const push = (e: AssetEntry, kind: AssetKind) => {
    rows.push({
      id: e.id,
      title: e.title,
      desc: e.description,
      kind,
      ecosystem,
      tags: [FILTER_LABEL[kind], agentTitle],
      active: e.active,
      sourcePath: e.path,
      scenario: e.scenario ?? null,
    });
  };
  for (const e of inv.skills) push(e, "skill");
  for (const e of inv.mcp) push(e, "mcp");
  for (const e of inv.rules) push(e, "rule");
  return rows;
}

type Props = {
  title: string;
  /** 与侧栏 Agent 一致时展示该生态；支持扫描到的全部 id */
  ecosystem?: string;
  /** `project` 为所选目录；`aggregate` 汇总全部 Agent 全局配置与侧栏全部项目 */
  dataSet?: "skills" | "project" | "aggregate";
  /** 页标题下方一行说明（例如来自 ?path=） */
  subtitle?: string;
  /** 项目根目录（仅 `dataSet="project"`），由 ?path= 传入 */
  projectRoot?: string;
};

export default function SkillBrowseShell({
  title,
  ecosystem,
  dataSet = "skills",
  subtitle,
  projectRoot,
}: Props) {
  const searchFieldId = useId();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [scenario, setScenario] = useState<ScenarioKey>("all");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedEntry, setSelectedEntry] = useState<DetailEntry | null>(null);
  const [liveInv, setLiveInv] = useState<AgentInventory | null | undefined>(
    undefined,
  );
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveFailed, setLiveFailed] = useState(false);
  const [projectInv, setProjectInv] = useState<AgentInventory | null | undefined>(
    undefined,
  );
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectFailed, setProjectFailed] = useState(false);

  const projectPaths = useProjectPaths();
  const [aggregateSnapshot, setAggregateSnapshot] =
    useState<AggregateSnapshot | null>(null);
  const [aggregateLoading, setAggregateLoading] = useState(
    () => dataSet === "aggregate",
  );
  const [aiScenarioBusy, setAiScenarioBusy] = useState(false);

  useEffect(() => {
    const k = searchParams.get("kind");
    if (k === "skill" || k === "mcp" || k === "rule") {
      setFilter(k);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!ecosystem || dataSet !== "skills") {
      setLiveInv(undefined);
      setLiveFailed(false);
      setLiveLoading(false);
      return;
    }
    let cancelled = false;
    setLiveLoading(true);
    setLiveFailed(false);
    getAgentGlobalInventory(ecosystem).then(async (data) => {
      if (cancelled) return;
      setLiveLoading(false);
      if (data === null) {
        setLiveInv(null);
        setLiveFailed(true);
        return;
      }
      setLiveFailed(false);
      setLiveInv(data);
      const cfg = await getDeepseekSettings();
      if (cancelled || !cfg?.apiKeyConfigured) return;
      setAiScenarioBusy(true);
      const next = await deepseekClassifyInventory(data);
      if (!cancelled && next) setLiveInv(next);
      if (!cancelled) setAiScenarioBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [ecosystem, dataSet]);

  useEffect(() => {
    if (dataSet !== "project") {
      setProjectInv(undefined);
      setProjectFailed(false);
      setProjectLoading(false);
      return;
    }
    if (!projectRoot) {
      setProjectInv(undefined);
      setProjectFailed(false);
      setProjectLoading(false);
      return;
    }
    let cancelled = false;
    setProjectLoading(true);
    setProjectFailed(false);
    scanProjectDirectory(projectRoot).then(async (data) => {
      if (cancelled) return;
      setProjectLoading(false);
      if (data === null) {
        setProjectInv(null);
        setProjectFailed(true);
        return;
      }
      setProjectFailed(false);
      setProjectInv(data);
      const cfg = await getDeepseekSettings();
      if (cancelled || !cfg?.apiKeyConfigured) return;
      setAiScenarioBusy(true);
      const next = await deepseekClassifyInventory(data);
      if (!cancelled && next) setProjectInv(next);
      if (!cancelled) setAiScenarioBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dataSet, projectRoot]);

  useEffect(() => {
    if (dataSet !== "aggregate") {
      setAggregateLoading(false);
      return;
    }
    let cancelled = false;
    setAggregateLoading(true);
    setAggregateSnapshot(null);

    (async () => {
      const detected = await listDetectedAgents();
      const specs =
        detected && detected.length > 0
          ? detected.map((a) => ({
              id: a.id,
              title: AGENT_LABEL_BY_ID[a.id] ?? a.label ?? a.id,
            }))
          : FALLBACK_AGENT_IDS.map((id) => ({
              id,
              title: AGENT_LABEL_BY_ID[id] ?? id,
            }));

      const agentResults = await Promise.all(
        specs.map(async (spec) => ({
          id: spec.id,
          title: spec.title,
          inv: await getAgentGlobalInventory(spec.id),
        })),
      );

      const projectResults = await Promise.all(
        projectPaths.map(async (path) => ({
          path,
          inv: await scanProjectDirectory(path),
        })),
      );

      if (cancelled) return;

      const anyInventoryFailed =
        agentResults.some((r) => r.inv === null) ||
        projectResults.some((r) => r.inv === null);

      const snapshot: AggregateSnapshot = {
        agents: agentResults,
        projects: projectResults,
        anyInventoryFailed,
      };
      setAggregateSnapshot(snapshot);
      setAggregateLoading(false);

      const parts: AgentInventory[] = [];
      for (const a of agentResults) {
        if (a.inv) parts.push(a.inv);
      }
      for (const p of projectResults) {
        if (p.inv) parts.push(p.inv);
      }
      const merged = dedupeMergeInventories(parts);
      const cfg = await getDeepseekSettings();
      if (
        cancelled ||
        !cfg?.apiKeyConfigured ||
        inventoryAssetCount(merged) === 0
      ) {
        return;
      }
      setAiScenarioBusy(true);
      const classified = await deepseekClassifyInventory(merged);
      if (!cancelled && classified) {
        const map = scenarioMapFromInventory(classified);
        setAggregateSnapshot((prev) =>
          prev ? patchAggregateSnapshot(prev, map) : prev,
        );
      }
      if (!cancelled) setAiScenarioBusy(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [dataSet, projectPaths]);

  const items = useMemo(() => {
    if (dataSet === "project") {
      if (!projectRoot) {
        return [];
      }
      if (projectLoading && projectInv === undefined) {
        return [];
      }
      if (projectFailed) {
        return [];
      }
      if (projectInv) {
        let rows = inventoryToRows(projectInv, "project", title);
        if (filter !== "all") {
          rows = rows.filter((r) => r.kind === filter);
        }
        const q = query.trim().toLowerCase();
        if (q) {
          rows = rows.filter(
            (r) =>
              r.title.toLowerCase().includes(q) ||
              r.desc.toLowerCase().includes(q) ||
              (r.sourcePath?.toLowerCase().includes(q) ?? false),
          );
        }
        if (scenario !== "all") {
          rows = rows.filter((r) => rowMatchesScenarioChip(r, scenario));
        }
        return rows;
      }
      return [];
    }

    if (dataSet === "aggregate") {
      if (aggregateLoading || aggregateSnapshot === null) {
        return [];
      }
      let rows: BrowseRow[] = [];
      for (const a of aggregateSnapshot.agents) {
        if (!a.inv) continue;
        rows.push(
          ...inventoryToRows(a.inv, a.id, a.title).map((r) => ({
            ...r,
            id: `g:${a.id}:${r.id}`,
          })),
        );
      }
      for (const p of aggregateSnapshot.projects) {
        if (!p.inv) continue;
        const bn = folderBasename(p.path);
        rows.push(
          ...inventoryToRows(p.inv, "project", bn).map((r) => ({
            ...r,
            id: `p:${p.path}:${r.id}`,
          })),
        );
      }
      if (filter !== "all") {
        rows = rows.filter((r) => r.kind === filter);
      }
      const q = query.trim().toLowerCase();
      if (q) {
        rows = rows.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.desc.toLowerCase().includes(q) ||
            (r.sourcePath?.toLowerCase().includes(q) ?? false),
        );
      }
      if (scenario !== "all") {
        rows = rows.filter((r) => rowMatchesScenarioChip(r, scenario));
      }
      return rows;
    }

    if (ecosystem && dataSet === "skills") {
      if (liveLoading && liveInv === undefined) {
        return [];
      }
      if (liveFailed) {
        return [];
      }
      if (liveInv) {
        let rows = inventoryToRows(liveInv, ecosystem, title);
        if (filter !== "all") {
          rows = rows.filter((r) => r.kind === filter);
        }
        const q = query.trim().toLowerCase();
        if (q) {
          rows = rows.filter(
            (r) =>
              r.title.toLowerCase().includes(q) ||
              r.desc.toLowerCase().includes(q) ||
              (r.sourcePath?.toLowerCase().includes(q) ?? false),
          );
        }
        if (scenario !== "all") {
          rows = rows.filter((r) => rowMatchesScenarioChip(r, scenario));
        }
        return rows;
      }
    }

    return [];
  }, [
    dataSet,
    ecosystem,
    filter,
    scenario,
    query,
    liveInv,
    liveFailed,
    liveLoading,
    title,
    projectRoot,
    projectInv,
    projectFailed,
    projectLoading,
    aggregateSnapshot,
    aggregateLoading,
  ]);

  const showLiveSubtitle =
    ecosystem &&
    dataSet === "skills" &&
    liveInv &&
    !liveFailed &&
    !liveLoading;

  return (
    <>
      <div className="page-header">
        <div className="page-title__row">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="count-badge">{items.length}</span>
        </div>
        {subtitle ? (
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.88rem" }}>
            {subtitle}
          </p>
        ) : null}
        {ecosystem && dataSet === "skills" ? (
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
            {liveLoading
              ? "正在读取本机全局目录（不含项目内配置）…"
              : liveFailed
                ? "无法读取本机配置：请在 AIControls 桌面端运行，或检查权限。"
                : showLiveSubtitle
                  ? "以下为该 Agent 用户级全局 Skills、MCP 与 Rules（不含 .cursor 等项目目录）。"
                  : null}
          </p>
        ) : null}
        {dataSet === "project" &&
        projectRoot &&
        (projectLoading || projectFailed) ? (
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
            {projectLoading
              ? "正在扫描所选目录下各 Agent skills 目录、MCP（JSON）与规则文件…"
              : "无法扫描该目录：请在 AIControls 桌面端运行，或检查路径与权限。"}
          </p>
        ) : null}
        {dataSet === "aggregate" ? (
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
            {aggregateLoading || aggregateSnapshot === null
              ? "正在汇总各 Agent 用户级全局目录与侧栏已添加项目…"
              : aggregateSnapshot.anyInventoryFailed
                ? "部分目录读取失败，已展示可用结果。"
                : "包含所有已识别 Agent 的全局 Skills、MCP、Rules，以及「全部项目」中各目录的扫描结果。"}
          </p>
        ) : null}
      </div>

      <div className="toolbar">
        <div className="toolbar__stack">
          <div className="toolbar__row">
            <label className="search" htmlFor={searchFieldId}>
              <span className="search__icon" aria-hidden>
                ⌕
              </span>
              <input
                id={searchFieldId}
                className="search__input"
                type="search"
                placeholder="搜索标题、描述或路径…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="seg" role="tablist" aria-label="类型筛选">
              {SEGMENT_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={filter === k}
                  className={`seg__item${filter === k ? " active" : ""}`}
                  onClick={() => setFilter(k)}
                >
                  {FILTER_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="scenario-strip" role="tablist" aria-label="场景分类">
            <button
              type="button"
              role="tab"
              aria-selected={scenario === "all"}
              title="展示全部 Skill、MCP 与 Rules"
              className={`scenario-chip${scenario === "all" ? " active" : ""}`}
              onClick={() => setScenario("all")}
            >
              {SCENARIO_LABEL.all}
            </button>
            {SCENARIO_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={scenario === key}
                title={SCENARIO_HINT[key]}
                className={`scenario-chip${scenario === key ? " active" : ""}`}
                onClick={() => setScenario(key)}
              >
                {SCENARIO_LABEL[key]}
              </button>
            ))}
          </div>
          {aiScenarioBusy ? (
            <p
              className="muted toolbar__deepseek-status"
              role="status"
              aria-live="polite"
            >
              DeepSeek 正在为尚未写入本地缓存的条目补全场景分类，请稍候…
            </p>
          ) : null}
        </div>
      </div>

      <div className="skill-grid">
        {items.map((item) => (
          <article
            key={item.id}
            className="skill-card"
            onClick={() =>
              setSelectedEntry({
                id: item.id,
                kind: item.kind,
                title: item.title,
                description: item.desc,
                path: item.sourcePath,
              })
            }
            style={{ cursor: "pointer" }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelectedEntry({
                  id: item.id,
                  kind: item.kind,
                  title: item.title,
                  description: item.desc,
                  path: item.sourcePath,
                });
              }
            }}
          >
            <div className="skill-card__title-row">
              <span className="skill-card__radio" aria-hidden />
              <span className="skill-card__title">{item.title}</span>
            </div>
            <p className="skill-card__desc">{item.desc}</p>
            {item.sourcePath ? (
              <p
                className="muted"
                style={{
                  margin: "0.35rem 0 0",
                  fontSize: "0.78rem",
                  wordBreak: "break-all",
                }}
              >
                {item.sourcePath}
              </p>
            ) : null}
          </article>
        ))}
      </div>

      {/* Skill 详情面板 */}
      <SkillDetailPanel
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
      />

      {items.length === 0 &&
      !(ecosystem && dataSet === "skills" && (liveLoading || liveFailed)) &&
      !(dataSet === "project" && projectLoading) &&
      !(dataSet === "aggregate" && (aggregateLoading || aggregateSnapshot === null)) ? (
        <p className="muted" style={{ marginTop: "1rem" }}>
          {dataSet === "project"
            ? !projectRoot
              ? "请先通过侧栏「添加项目」选择文件夹。"
              : projectFailed
                ? null
                : "所选目录下未发现条目，或没有符合当前筛选的结果。"
            : dataSet === "aggregate"
              ? "未发现任何条目，或没有符合当前筛选的结果。"
              : ecosystem && dataSet === "skills"
                ? "没有符合条件的全局条目。"
                : "没有符合当前筛选条件的条目。"}
        </p>
      ) : null}
    </>
  );
}
