import { useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

type AssetKind = "skill" | "mcp" | "rule";

type MockItem = {
  id: string;
  title: string;
  desc: string;
  kind: AssetKind;
  ecosystem: "cursor" | "claude";
  tags: string[];
  active: boolean;
};

const MOCK_ITEMS: MockItem[] = [
  {
    id: "1",
    title: "代码搜索与分析",
    desc: "在仓库内按语义查找实现位置，并简述各文件职责。",
    kind: "skill",
    ecosystem: "cursor",
    tags: ["skill", "Cursor"],
    active: true,
  },
  {
    id: "2",
    title: "composition-patterns",
    desc: "React 复合组件与可扩展 API 的写法参考。",
    kind: "skill",
    ecosystem: "claude",
    tags: ["skill", "Claude"],
    active: true,
  },
  {
    id: "3",
    title: "GitHub 检索",
    desc: "通过 MCP 在 GitHub 上搜索代码与 Issue。",
    kind: "mcp",
    ecosystem: "cursor",
    tags: ["mcp", "Cursor"],
    active: false,
  },
  {
    id: "4",
    title: "前端性能清单",
    desc: "发布前自检：包体、列表渲染与数据请求。",
    kind: "rule",
    ecosystem: "claude",
    tags: ["rule", "Claude"],
    active: true,
  },
  {
    id: "5",
    title: "API 设计约定",
    desc: "REST 路径、错误码与版本策略的统一说明。",
    kind: "rule",
    ecosystem: "cursor",
    tags: ["rule", "Cursor"],
    active: true,
  },
  {
    id: "6",
    title: "MasterGo DSL",
    desc: "从设计稿链接拉取结构并生成组件说明。",
    kind: "mcp",
    ecosystem: "claude",
    tags: ["mcp", "Claude"],
    active: false,
  },
];

/** 示例项目页：同结构、不同文案的占位数据 */
const MOCK_PROJECT_ITEMS: MockItem[] = [
  {
    id: "p1",
    title: "design-system",
    desc: "组件库与主题 token，供业务线复用。",
    kind: "skill",
    ecosystem: "cursor",
    tags: ["skill", "Cursor"],
    active: true,
  },
  {
    id: "p2",
    title: "mobile-app",
    desc: "Expo 客户端，含离线同步与推送。",
    kind: "skill",
    ecosystem: "claude",
    tags: ["skill", "Claude"],
    active: true,
  },
  {
    id: "p3",
    title: "data-pipeline",
    desc: "MCP 拉数与指标看板导出的批处理。",
    kind: "mcp",
    ecosystem: "cursor",
    tags: ["mcp", "Cursor"],
    active: false,
  },
  {
    id: "p4",
    title: "release-checklist",
    desc: "发版前检查：变更说明、回滚与灰度。",
    kind: "rule",
    ecosystem: "claude",
    tags: ["rule", "Claude"],
    active: true,
  },
  {
    id: "p5",
    title: "api-gateway",
    desc: "BFF 与限流、鉴权规则说明。",
    kind: "rule",
    ecosystem: "cursor",
    tags: ["rule", "Cursor"],
    active: true,
  },
  {
    id: "p6",
    title: "figma-bridge",
    desc: "设计稿与代码侧 token 对齐的 MCP 工具。",
    kind: "mcp",
    ecosystem: "claude",
    tags: ["mcp", "Claude"],
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

type Props = {
  title: string;
  /** 与侧栏 Agent 一致时，只展示该生态的占位数据 */
  ecosystem?: "cursor" | "claude";
  /** 使用哪套占位列表：默认 Skills 列表；`project` 为示例项目 */
  dataSet?: "skills" | "project";
  /** 页标题下方一行说明（例如来自 ?path=） */
  subtitle?: string;
};

export default function SkillBrowseShell({
  title,
  ecosystem,
  dataSet = "skills",
  subtitle,
}: Props) {
  const searchFieldId = useId();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    const k = searchParams.get("kind");
    if (k === "skill" || k === "mcp" || k === "rule") {
      setFilter(k);
    }
  }, [searchParams]);

  const items = useMemo(() => {
    const base =
      dataSet === "project" ? MOCK_PROJECT_ITEMS : MOCK_ITEMS;
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
  }, [dataSet, ecosystem, filter, query]);

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
              placeholder="搜索标题或描述…"
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

      {items.length === 0 ? (
        <p className="muted" style={{ marginTop: "1rem" }}>
          没有符合当前筛选条件的条目（占位数据）。
        </p>
      ) : null}
    </>
  );
}
