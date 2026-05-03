import { useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getAgentGlobalInventory,
  scanProjectDirectory,
  type AgentInventory,
  type AssetEntry,
} from "../api/agents";

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
};

const MOCK_ITEMS: BrowseRow[] = [
  {
    id: "1",
    title: "代码搜索与分析",
    desc: "在仓库内按语义查找实现位置，并简述各文件职责。",
    kind: "skill",
    ecosystem: "cursor",
    tags: ["Skill", "Cursor"],
    active: true,
  },
  {
    id: "2",
    title: "composition-patterns",
    desc: "React 复合组件与可扩展 API 的写法参考。",
    kind: "skill",
    ecosystem: "claude",
    tags: ["Skill", "Claude Code"],
    active: true,
  },
  {
    id: "3",
    title: "GitHub 检索",
    desc: "通过 MCP 在 GitHub 上搜索代码与 Issue。",
    kind: "mcp",
    ecosystem: "cursor",
    tags: ["MCP", "Cursor"],
    active: false,
  },
  {
    id: "4",
    title: "前端性能清单",
    desc: "发布前自检：包体、列表渲染与数据请求。",
    kind: "rule",
    ecosystem: "claude",
    tags: ["Rules", "Claude Code"],
    active: true,
  },
  {
    id: "5",
    title: "API 设计约定",
    desc: "REST 路径、错误码与版本策略的统一说明。",
    kind: "rule",
    ecosystem: "cursor",
    tags: ["Rules", "Cursor"],
    active: true,
  },
  {
    id: "6",
    title: "MasterGo DSL",
    desc: "从设计稿链接拉取结构并生成组件说明。",
    kind: "mcp",
    ecosystem: "claude",
    tags: ["MCP", "Claude Code"],
    active: false,
  },
];

type FilterKey = "all" | AssetKind;

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "全部",
  skill: "Skill",
  mcp: "MCP",
  rule: "Rules",
};

const SEGMENT_KEYS: FilterKey[] = ["all", "skill", "mcp", "rule"];

function kindLabel(k: AssetKind): string {
  return FILTER_LABEL[k];
}

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
  /** 默认占位列表；`project` 为所选目录的扫描结果 */
  dataSet?: "skills" | "project";
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
  const [filter, setFilter] = useState<FilterKey>("all");
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

  useEffect(() => {
    const k = searchParams.get("kind");
    if (k === "skill" || k === "mcp" || k === "rule") {
      setFilter(k);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!ecosystem || dataSet === "project") {
      setLiveInv(undefined);
      setLiveFailed(false);
      setLiveLoading(false);
      return;
    }
    let cancelled = false;
    setLiveLoading(true);
    setLiveFailed(false);
    getAgentGlobalInventory(ecosystem).then((data) => {
      if (cancelled) return;
      setLiveLoading(false);
      if (data === null) {
        setLiveInv(null);
        setLiveFailed(true);
        return;
      }
      setLiveInv(data);
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
    scanProjectDirectory(projectRoot).then((data) => {
      if (cancelled) return;
      setProjectLoading(false);
      if (data === null) {
        setProjectInv(null);
        setProjectFailed(true);
        return;
      }
      setProjectInv(data);
    });
    return () => {
      cancelled = true;
    };
  }, [dataSet, projectRoot]);

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
        return rows;
      }
      return [];
    }

    if (ecosystem && dataSet !== "project") {
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
        return rows;
      }
    }

    const base = MOCK_ITEMS;
    let rows = [...base];
    if (ecosystem) {
      rows = rows.filter((r) => r.ecosystem === ecosystem);
    }
    if (filter !== "all") {
      rows = rows.filter((r) => r.kind === filter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [
    dataSet,
    ecosystem,
    filter,
    query,
    liveInv,
    liveFailed,
    liveLoading,
    title,
    projectRoot,
    projectInv,
    projectFailed,
    projectLoading,
  ]);

  const showLiveSubtitle =
    ecosystem &&
    dataSet !== "project" &&
    liveInv &&
    !liveFailed &&
    !liveLoading;

  const showProjectHint =
    dataSet === "project" &&
    projectRoot &&
    projectInv &&
    !projectFailed &&
    !projectLoading;

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
        {ecosystem && dataSet !== "project" ? (
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
        {dataSet === "project" ? (
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
            {!projectRoot
              ? null
              : projectLoading
                ? "正在扫描所选目录下的 SKILL.md、MCP（JSON）与规则文件…"
                : projectFailed
                  ? "无法扫描该目录：请在 AIControls 桌面端运行，或检查路径与权限。"
                  : showProjectHint
                    ? "以下为该目录树内的 Skills（SKILL.md）、MCP 与 Rules（.md / .mdc），已忽略 node_modules 等常见无关目录。"
                    : null}
          </p>
        ) : null}
      </div>

      <div className="toolbar">
        <div className="toolbar__left">
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
      </div>

      <div className="skill-grid">
        {items.map((item) => (
          <article key={item.id} className="skill-card">
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
            <div className="skill-card__meta">
              <span className="skill-tag">{kindLabel(item.kind)}</span>
              {item.tags.map((t) => (
                <span key={t} className="skill-tag skill-tag--muted">
                  {t}
                </span>
              ))}
              <span
                className={`skill-status${item.active ? " on" : " off"}`}
              >
                {item.active ? "启用" : "未启用"}
              </span>
            </div>
          </article>
        ))}
      </div>

      {items.length === 0 &&
      !(ecosystem && dataSet !== "project" && (liveLoading || liveFailed)) &&
      !(dataSet === "project" && projectLoading) ? (
        <p className="muted" style={{ marginTop: "1rem" }}>
          {dataSet === "project"
            ? !projectRoot
              ? "请先通过侧栏「添加项目」选择文件夹。"
              : projectFailed
                ? null
                : "所选目录下未发现条目，或没有符合当前筛选的结果。"
            : ecosystem && dataSet !== "project"
              ? "没有符合条件的全局条目。"
              : "没有符合当前筛选条件的条目（占位数据）。"}
        </p>
      ) : null}
    </>
  );
}
