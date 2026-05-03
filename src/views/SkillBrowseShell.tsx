import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  deepseekClassifyInventory,
  getDeepseekSettings,
} from "../api/deepseek";
import {
  getAgentGlobalInventoryCached,
  scanProjectDirectoryCached,
} from "../api/agentInventoryCache";
import {
  listDetectedAgents,
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
import {
  bucketInventoryByAgent,
  filterInventoryForAgent,
  inferAgentIdFromAssetPath,
  inventoryAssetCount,
} from "../agentAssetGrouping";
import { revealPathInFolder } from "../api/reveal";

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

type BrowseSection = {
  key: string;
  /** 空字符串：不展示分组标题（如「全部」汇总） */
  title: string;
  rows: BrowseRow[];
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

/** HTML `id` 安全片段（来自路径等分组 key） */
function sectionIdSafeFragment(sectionKey: string): string {
  const s = sectionKey.replace(/\W/g, "_");
  return s.length > 0 ? s : "sec";
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

function zeroScenarioCounts(): Record<ScenarioKey, number> {
  return {
    all: 0,
    dev: 0,
    office: 0,
    creative: 0,
    data: 0,
    network: 0,
    ops: 0,
    collab: 0,
  };
}

/** 在当前类型与搜索筛选下，各场景匹配条数（与点击场景芯片的判定一致） */
function scenarioCountsFromRows(rows: BrowseRow[]): Record<ScenarioKey, number> {
  const counts = zeroScenarioCounts();
  counts.all = rows.length;
  for (const row of rows) {
    for (const key of SCENARIO_ORDER) {
      if (rowMatchesScenarioChip(row, key)) counts[key]++;
    }
  }
  return counts;
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
  const browseSectionDomPrefix = useId().replace(/\W/g, "");
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [scenario, setScenario] = useState<ScenarioKey>("all");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedEntry, setSelectedEntry] = useState<DetailEntry | null>(null);
  /** 展开中的分组 key；Agent/项目页由列表分组数量同步（仅 1 个标题时默认展开） */
  const [expandedSectionKeys, setExpandedSectionKeys] = useState<
    Set<string>
  >(() => new Set());
  const [liveInv, setLiveInv] = useState<AgentInventory | null | undefined>(
    undefined,
  );
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveFailed, setLiveFailed] = useState(false);
  const [agentProjectScans, setAgentProjectScans] = useState<
    { path: string; inv: AgentInventory | null }[]
  >([]);
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
  const [cardContextMenu, setCardContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
  } | null>(null);
  const cardContextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const k = searchParams.get("kind");
    if (k === "skill" || k === "mcp" || k === "rule") {
      setFilter(k);
    }
  }, [searchParams]);

  useEffect(() => {
    setCardContextMenu(null);
  }, [dataSet, ecosystem, projectRoot]);

  useEffect(() => {
    if (!cardContextMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (cardContextMenuRef.current?.contains(e.target as Node)) return;
      setCardContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCardContextMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [cardContextMenu]);

  useEffect(() => {
    if (!ecosystem || dataSet !== "skills") {
      setLiveInv(undefined);
      setLiveFailed(false);
      setLiveLoading(false);
      setAgentProjectScans([]);
      return;
    }
    let cancelled = false;
    setLiveLoading(true);
    setLiveFailed(false);
    setLiveInv(undefined);
    setAgentProjectScans([]);

    (async () => {
      const globalInv = await getAgentGlobalInventoryCached(ecosystem);
      const projList = await Promise.all(
        projectPaths.map((path) => scanProjectDirectoryCached(path)),
      );
      if (cancelled) return;

      setLiveLoading(false);
      setLiveFailed(globalInv === null);
      setLiveInv(globalInv);
      setAgentProjectScans(
        projectPaths.map((path, i) => ({
          path,
          inv: projList[i],
        })),
      );

      const parts: AgentInventory[] = [];
      if (globalInv) parts.push(globalInv);
      for (const raw of projList) {
        if (raw) parts.push(filterInventoryForAgent(ecosystem, raw));
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
      if (cancelled || !classified) {
        if (!cancelled) setAiScenarioBusy(false);
        return;
      }
      const map = scenarioMapFromInventory(classified);
      if (globalInv) setLiveInv(patchAgentInventory(globalInv, map));
      setAgentProjectScans(
        projectPaths.map((path, i) => {
          const raw = projList[i];
          if (!raw) return { path, inv: null };
          const filtered = filterInventoryForAgent(ecosystem, raw);
          return {
            path,
            inv: patchAgentInventory(filtered, map),
          };
        }),
      );
      if (!cancelled) setAiScenarioBusy(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [ecosystem, dataSet, projectPaths]);

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
    scanProjectDirectoryCached(projectRoot).then(async (data) => {
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
          inv: await getAgentGlobalInventoryCached(spec.id),
        })),
      );

      const projectResults = await Promise.all(
        projectPaths.map(async (path) => ({
          path,
          inv: await scanProjectDirectoryCached(path),
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

  const { sections, scenarioCounts } = useMemo((): {
    sections: BrowseSection[];
    scenarioCounts: Record<ScenarioKey, number>;
  } => {
    const empty = zeroScenarioCounts();

    const applyKindAndQuery = (rows: BrowseRow[]): BrowseRow[] => {
      let r = rows;
      if (filter !== "all") {
        r = r.filter((row) => row.kind === filter);
      }
      const q = query.trim().toLowerCase();
      if (q) {
        r = r.filter(
          (row) =>
            row.title.toLowerCase().includes(q) ||
            row.desc.toLowerCase().includes(q) ||
            (row.sourcePath?.toLowerCase().includes(q) ?? false),
        );
      }
      return r;
    };

    const applyScenarioFilter = (rows: BrowseRow[]): BrowseRow[] => {
      if (scenario === "all") return rows;
      return rows.filter((row) => rowMatchesScenarioChip(row, scenario));
    };

    if (dataSet === "project") {
      if (!projectRoot) {
        return { sections: [], scenarioCounts: empty };
      }
      if (projectLoading && projectInv === undefined) {
        return { sections: [], scenarioCounts: empty };
      }
      if (projectFailed) {
        return { sections: [], scenarioCounts: empty };
      }
      if (!projectInv) {
        return { sections: [], scenarioCounts: empty };
      }
      const buckets = bucketInventoryByAgent(projectInv);
      const out: BrowseSection[] = [];
      for (const { agentId, inv } of buckets) {
        const agentTitle =
          agentId === "__other__"
            ? "其他"
            : AGENT_LABEL_BY_ID[agentId] ?? agentId;
        let rows = inventoryToRows(inv, agentId, agentTitle).map((r) => ({
          ...r,
          id: `proj:${agentId}:${r.id}`,
        }));
        rows = applyKindAndQuery(rows);
        out.push({ key: agentId, title: agentTitle, rows });
      }
      out.sort((a, b) => b.rows.length - a.rows.length);
      const scenarioCounts = scenarioCountsFromRows(out.flatMap((s) => s.rows));
      const filtered = out
        .map((s) => ({ ...s, rows: applyScenarioFilter(s.rows) }))
        .filter((s) => s.rows.length > 0);
      return { sections: filtered, scenarioCounts };
    }

    if (dataSet === "aggregate") {
      if (aggregateLoading || aggregateSnapshot === null) {
        return { sections: [], scenarioCounts: empty };
      }
      let rows: BrowseRow[] = [];
      for (const a of aggregateSnapshot.agents) {
        if (!a.inv) continue;
        rows.push(
          ...inventoryToRows(a.inv, a.id, a.title).map((r) => ({
            ...r,
            id: `g:${a.id}:${r.id}`,
            tags: [a.title, "用户全局"],
          })),
        );
      }
      for (const p of aggregateSnapshot.projects) {
        if (!p.inv) continue;
        const bn = folderBasename(p.path);
        rows.push(
          ...inventoryToRows(p.inv, "project", bn).map((r) => {
            const aid = inferAgentIdFromAssetPath(r.sourcePath ?? "");
            const agentLbl = aid
              ? (AGENT_LABEL_BY_ID[aid] ?? aid)
              : "其他";
            return {
              ...r,
              id: `p:${p.path}:${r.id}`,
              tags: [agentLbl, bn],
            };
          }),
        );
      }
      rows = applyKindAndQuery(rows);
      const scenarioCounts = scenarioCountsFromRows(rows);
      rows = applyScenarioFilter(rows);
      return { sections: [{ key: "aggregate", title: "", rows }], scenarioCounts };
    }

    if (ecosystem && dataSet === "skills") {
      if (liveLoading && liveInv === undefined) {
        return { sections: [], scenarioCounts: empty };
      }

      const globalKey = `global:${ecosystem}`;
      let globalRows: BrowseRow[] = [];
      if (liveInv) {
        globalRows = applyKindAndQuery(
          inventoryToRows(liveInv, ecosystem, title).map((r) => ({
            ...r,
            id: `g:${ecosystem}:${r.id}`,
          })),
        );
      }
      const globalSection: BrowseSection = {
        key: globalKey,
        title: "用户全局目录",
        rows: globalRows,
      };

      const projectSections: BrowseSection[] = [];
      for (const { path, inv } of agentProjectScans) {
        if (!inv) continue;
        const scoped = filterInventoryForAgent(ecosystem, inv);
        if (inventoryAssetCount(scoped) === 0) continue;
        const bn = folderBasename(path);
        let rows = inventoryToRows(scoped, "project", bn).map((r) => ({
          ...r,
          id: `a:${ecosystem}:${path}:${r.id}`,
        }));
        rows = applyKindAndQuery(rows);
        projectSections.push({ key: path, title: bn, rows });
      }
      projectSections.sort((a, b) => b.rows.length - a.rows.length);
      const allForCounts = [globalSection, ...projectSections];
      const scenarioCounts = scenarioCountsFromRows(
        allForCounts.flatMap((s) => s.rows),
      );
      const globalSectionFiltered: BrowseSection = {
        ...globalSection,
        rows: applyScenarioFilter(globalSection.rows),
      };
      const projectSectionsNonEmpty = projectSections
        .map((s) => ({ ...s, rows: applyScenarioFilter(s.rows) }))
        .filter((s) => s.rows.length > 0);

      return {
        sections: [globalSectionFiltered, ...projectSectionsNonEmpty],
        scenarioCounts,
      };
    }

    return { sections: [], scenarioCounts: empty };
  }, [
    dataSet,
    ecosystem,
    filter,
    scenario,
    query,
    liveInv,
    liveLoading,
    title,
    projectRoot,
    projectInv,
    projectFailed,
    projectLoading,
    aggregateSnapshot,
    aggregateLoading,
    agentProjectScans,
  ]);

  useEffect(() => {
    if (dataSet !== "skills" && dataSet !== "project") {
      setExpandedSectionKeys(new Set());
      return;
    }
    const titled = sections.filter((s) => s.title);
    if (titled.length === 1) {
      setExpandedSectionKeys(new Set([titled[0]!.key]));
    } else {
      setExpandedSectionKeys(new Set());
    }
  }, [dataSet, sections]);

  const listedTotal = sections.reduce((n, s) => n + s.rows.length, 0);

  const toggleSectionExpanded = (sectionKey: string) => {
    setExpandedSectionKeys((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  };

  const openDetail = (item: BrowseRow) => {
    setSelectedEntry({
      id: item.id,
      kind: item.kind,
      title: item.title,
      description: item.desc,
      path: item.sourcePath,
    });
  };

  const onCardContextMenu = (e: MouseEvent, item: BrowseRow) => {
    if (dataSet !== "skills" && dataSet !== "project") return;
    e.preventDefault();
    e.stopPropagation();
    const p = item.sourcePath?.trim();
    if (!p) return;
    const pad = 8;
    const approxW = 220;
    const approxH = 44;
    const vw = typeof window !== "undefined" ? window.innerWidth : e.clientX;
    const vh = typeof window !== "undefined" ? window.innerHeight : e.clientY;
    const x = Math.min(Math.max(pad, e.clientX), Math.max(pad, vw - approxW - pad));
    const y = Math.min(Math.max(pad, e.clientY), Math.max(pad, vh - approxH - pad));
    setCardContextMenu({ x, y, path: p });
  };

  function renderBrowseCard(item: BrowseRow) {
    return (
      <article
        key={item.id}
        className="skill-card"
        title={
          dataSet === "skills" || dataSet === "project"
            ? "右键菜单：在所在目录中显示"
            : undefined
        }
        onClick={() => openDetail(item)}
        onContextMenu={
          dataSet === "skills" || dataSet === "project"
            ? (e) => onCardContextMenu(e, item)
            : undefined
        }
        style={{ cursor: "pointer" }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openDetail(item);
          }
        }}
      >
        <div className="skill-card__title-row">
          <span className="skill-card__radio" aria-hidden />
          <span className="skill-card__title">{item.title}</span>
          <span
            className={`skill-card__kind skill-card__kind--${item.kind}`}
            aria-label={`类型：${FILTER_LABEL[item.kind]}`}
          >
            {FILTER_LABEL[item.kind]}
          </span>
        </div>
        <p className="skill-card__desc">{item.desc}</p>
        {dataSet === "aggregate" && item.tags.length > 0 ? (
          <div className="skill-card__tags" aria-label="来源标签">
            {item.tags.map((t, i) => (
              <span key={`${item.id}-tag-${i}`} className="skill-card__tag">
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title__row">
          <h2>{title}</h2>
          <span className="count-badge">{listedTotal}</span>
        </div>
        {subtitle ? (
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.88rem" }}>
            {subtitle}
          </p>
        ) : null}
        {ecosystem && dataSet === "skills" && (liveLoading || liveFailed) ? (
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
            {liveLoading
              ? "正在读取该 Agent 的用户级全局目录与侧栏已添加项目…"
              : "无法读取用户级全局目录：仍可查看侧栏项目中归属该 Agent 的配置；请在桌面端运行或检查权限。"}
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
              {SCENARIO_LABEL.all}（{scenarioCounts.all}）
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
                {SCENARIO_LABEL[key]}（{scenarioCounts[key]}）
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

      {sections.map((sec) => {
        if (!sec.title) {
          return (
            <div key={sec.key} className="skill-grid">
              {sec.rows.map((item) => renderBrowseCard(item))}
            </div>
          );
        }

        const expanded = expandedSectionKeys.has(sec.key);
        const frag = sectionIdSafeFragment(sec.key);
        const headerId = `${browseSectionDomPrefix}-h-${frag}`;
        const panelId = `${browseSectionDomPrefix}-p-${frag}`;

        return (
          <section key={sec.key} className="browse-section">
            <div className="browse-section__header">
              <button
                type="button"
                id={headerId}
                className="browse-section__toggle"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggleSectionExpanded(sec.key)}
              >
                <span className="browse-section__chevron" aria-hidden>
                  ▾
                </span>
                <span className="browse-section__title">{sec.title}</span>
                <span className="count-badge">{sec.rows.length}</span>
              </button>
            </div>
            {expanded ? (
              <div
                id={panelId}
                className="skill-grid"
                role="region"
                aria-labelledby={headerId}
              >
                {sec.rows.map((item) => renderBrowseCard(item))}
              </div>
            ) : null}
          </section>
        );
      })}

      {cardContextMenu ? (
        <div
          ref={cardContextMenuRef}
          className="card-context-menu"
          style={{
            position: "fixed",
            left: cardContextMenu.x,
            top: cardContextMenu.y,
            zIndex: 10_000,
          }}
          role="menu"
          aria-label="卡片操作"
        >
          <button
            type="button"
            role="menuitem"
            className="card-context-menu__item"
            onClick={() => {
              void revealPathInFolder(cardContextMenu.path);
              setCardContextMenu(null);
            }}
          >
            在所在目录中显示
          </button>
        </div>
      ) : null}

      {/* Skill 详情面板 */}
      <SkillDetailPanel
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
      />

      {listedTotal === 0 &&
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
