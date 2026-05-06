import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import {
  deepseekClassifyInventory,
  deepseekResummarizeAsset,
  deepseekSummarizeInventory,
  getDeepseekSettings,
} from "../api/deepseek";
import {
  getAgentGlobalInventoryCached,
  invalidateCachedAgentGlobalInventory,
  invalidateCachedProjectInventory,
  scanProjectDirectoryCached,
} from "../api/agentInventoryCache";
import {
  copySkillPackage,
  deleteSkillAtPath,
  listDetectedAgents,
  type AgentInventory,
  type AssetEntry,
} from "../api/agents";
import {
  addSkillToMyLibrary,
  getMySkillsLibrary,
  removeMySkill,
  type MySkillsLibraryFile,
} from "../api/mySkills";
import { useProjectPaths } from "../projectPathsStorage";
import { PageRefreshButton } from "../components/PageRefreshButton";
import { SkillCopyDestinationDialog } from "../components/SkillCopyDestinationDialog";
import { SkillDetailPanel, type DetailEntry } from "../components/SkillDetailPanel";
import {
  getScenarioHint,
  getScenarioLabel,
  rowMatchesScenarioChip,
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
import { buildCopySkillMenuSections } from "../skillCopyTargets";
import { useI18n } from "../i18n/provider";
import { open } from "@tauri-apps/plugin-dialog";

type AssetKind = "skill" | "mcp" | "rule";

type BrowseRow = {
  id: string;
  sourceId: string;
  title: string;
  desc: string;
  descSource: "ai" | "source";
  kind: AssetKind;
  ecosystem: string;
  tags: string[];
  active: boolean;
  /** 本机路径或占位 id */
  sourcePath?: string;
  /** 技能包内除主 SKILL.md 外的文件（与 AssetEntry.skill_extra_files 一致） */
  skillExtraFiles?: string[];
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
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "Project";
}

/** 列表里技能包为目录路径；散装 `SKILL.md` 以文件名结尾，只支持复制、不提供「删除文件夹」 */
function skillBrowsePathIsDeletableFolder(sourcePath: string): boolean {
  const t = sourcePath.trim().replace(/\\/g, "/");
  return !/\/SKILL\.md$/i.test(t);
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

function briefMapFromInventory(inv: AgentInventory, locale: "zh" | "en"): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of [...inv.skills, ...inv.mcp, ...inv.rules]) {
    const brief = (locale === "zh" ? e.brief_zh : e.brief_en)?.trim();
    if (brief) m.set(e.id, brief);
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

function patchAgentInventoryBrief(
  inv: AgentInventory,
  locale: "zh" | "en",
  map: Map<string, string>,
): AgentInventory {
  const patch = (e: AssetEntry): AssetEntry => ({
    ...e,
    brief_zh: locale === "zh" ? map.get(e.id) ?? e.brief_zh ?? null : e.brief_zh ?? null,
    brief_en: locale === "en" ? map.get(e.id) ?? e.brief_en ?? null : e.brief_en ?? null,
  });
  return {
    skills: inv.skills.map(patch),
    mcp: inv.mcp.map(patch),
    rules: inv.rules.map(patch),
  };
}

function patchAggregateSnapshotBrief(
  snap: AggregateSnapshot,
  locale: "zh" | "en",
  map: Map<string, string>,
): AggregateSnapshot {
  return {
    agents: snap.agents.map((a) => ({
      ...a,
      inv: a.inv ? patchAgentInventoryBrief(a.inv, locale, map) : null,
    })),
    projects: snap.projects.map((p) => ({
      ...p,
      inv: p.inv ? patchAgentInventoryBrief(p.inv, locale, map) : null,
    })),
    anyInventoryFailed: snap.anyInventoryFailed,
  };
}

function patchEntryBriefInInventory(
  inv: AgentInventory,
  sourceId: string,
  locale: "zh" | "en",
  brief: string,
): AgentInventory {
  const patch = (e: AssetEntry): AssetEntry =>
    e.id === sourceId
      ? {
          ...e,
          brief_zh: locale === "zh" ? brief : e.brief_zh ?? null,
          brief_en: locale === "en" ? brief : e.brief_en ?? null,
        }
      : e;
  return {
    skills: inv.skills.map(patch),
    mcp: inv.mcp.map(patch),
    rules: inv.rules.map(patch),
  };
}

type FilterKey = "all" | AssetKind;

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "All",
  skill: "Skill",
  mcp: "MCP",
  rule: "Rule",
};

const SEGMENT_KEYS: FilterKey[] = ["all", "skill", "mcp", "rule"];

function inventoryToRows(
  inv: AgentInventory,
  ecosystem: string,
  agentTitle: string,
  locale: "zh" | "en",
): BrowseRow[] {
  const rows: BrowseRow[] = [];
  const push = (e: AssetEntry, kind: AssetKind) => {
    const brief = (locale === "zh" ? e.brief_zh : e.brief_en)?.trim();
    rows.push({
      id: e.id,
      sourceId: e.id,
      title: e.title,
      desc: brief || e.description,
      descSource: brief ? "ai" : "source",
      kind,
      ecosystem,
      tags: [FILTER_LABEL[kind], agentTitle],
      active: e.active,
      sourcePath: e.path,
      skillExtraFiles: e.skill_extra_files ?? undefined,
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

function stringSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
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
  const { locale } = useI18n();
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
  const [aiBriefBusy, setAiBriefBusy] = useState(false);
  const [cardContextMenu, setCardContextMenu] = useState<{
    x: number;
    y: number;
    row: BrowseRow;
  } | null>(null);
  const cardContextMenuRef = useRef<HTMLDivElement>(null);
  const [skillCopyTargetModalRow, setSkillCopyTargetModalRow] =
    useState<BrowseRow | null>(null);
  /** 底部/顶部操作反馈吐司；`at` 变化时重置自动消失计时 */
  const [shellToast, setShellToast] = useState<{
    at: number;
    message: string;
  } | null>(null);
  /** 递增以使数据 useEffect 重新拉取（与手动刷新配合） */
  const [refreshKey, setRefreshKey] = useState(0);
  /** 「全部」资产页：汇总 vs 我的技能库 */
  const [aggregateAssetsTab, setAggregateAssetsTab] = useState<"all" | "mine">(
    "all",
  );
  const [mySkillsLib, setMySkillsLib] = useState<MySkillsLibraryFile | null>(
    null,
  );
  const [mySkillsLoading, setMySkillsLoading] = useState(false);
  const [mySkillsImportBusy, setMySkillsImportBusy] = useState(false);

  const onRefreshInventory = useCallback(() => {
    if (dataSet === "aggregate") {
      invalidateCachedAgentGlobalInventory();
      invalidateCachedProjectInventory();
    } else if (dataSet === "project" && projectRoot?.trim()) {
      invalidateCachedProjectInventory(projectRoot);
    } else if (dataSet === "skills" && ecosystem) {
      invalidateCachedAgentGlobalInventory(ecosystem);
      invalidateCachedProjectInventory();
    }
    setRefreshKey((k) => k + 1);
  }, [dataSet, ecosystem, projectRoot]);

  const refreshBusy =
    (dataSet === "skills" &&
      !!ecosystem &&
      (liveLoading || aiScenarioBusy || aiBriefBusy)) ||
    (dataSet === "project" &&
      !!projectRoot?.trim() &&
      (projectLoading || aiScenarioBusy || aiBriefBusy)) ||
    (dataSet === "aggregate" &&
      aggregateAssetsTab === "mine" &&
      mySkillsLoading) ||
    (dataSet === "aggregate" &&
      aggregateAssetsTab === "all" &&
      (aggregateLoading || aiScenarioBusy || aiBriefBusy));

  useEffect(() => {
    const k = searchParams.get("kind");
    if (k === "skill" || k === "mcp" || k === "rule") {
      setFilter(k);
    } else {
      setFilter("all");
    }
  }, [searchParams]);

  useEffect(() => {
    setCardContextMenu(null);
    setSkillCopyTargetModalRow(null);
    setShellToast(null);
  }, [dataSet, ecosystem, projectRoot]);

  useEffect(() => {
    if (dataSet !== "aggregate") setAggregateAssetsTab("all");
  }, [dataSet]);

  useEffect(() => {
    if (dataSet === "aggregate" && aggregateAssetsTab === "mine") {
      setFilter("all");
      setScenario("all");
    }
  }, [dataSet, aggregateAssetsTab]);

  useEffect(() => {
    if (dataSet !== "aggregate" || aggregateAssetsTab !== "mine") return;
    let cancelled = false;
    setMySkillsLoading(true);
    void getMySkillsLibrary()
      .then((lib) => {
        if (!cancelled) setMySkillsLib(lib);
      })
      .catch(() => {
        if (!cancelled) setMySkillsLib(null);
      })
      .finally(() => {
        if (!cancelled) setMySkillsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataSet, aggregateAssetsTab, refreshKey]);

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
    if (!skillCopyTargetModalRow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSkillCopyTargetModalRow(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [skillCopyTargetModalRow]);

  useEffect(() => {
    if (shellToast === null) return;
    const t = window.setTimeout(() => setShellToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [shellToast?.at]);

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

      const baseForSummary = classified ?? merged;
      setAiBriefBusy(true);
      const summarized = await deepseekSummarizeInventory(baseForSummary, locale);
      if (cancelled || !summarized) {
        if (!cancelled) setAiBriefBusy(false);
        return;
      }
      const briefMap = briefMapFromInventory(summarized, locale);
      setLiveInv((prev) => (prev ? patchAgentInventoryBrief(prev, locale, briefMap) : prev));
      setAgentProjectScans((prev) =>
        prev.map((item) => ({
          ...item,
          inv: item.inv ? patchAgentInventoryBrief(item.inv, locale, briefMap) : null,
        })),
      );
      if (!cancelled) setAiBriefBusy(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [ecosystem, dataSet, projectPaths, refreshKey, locale]);

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
      const baseForSummary = next ?? data;
      setAiBriefBusy(true);
      const summarized = await deepseekSummarizeInventory(baseForSummary, locale);
      if (!cancelled && summarized) setProjectInv(summarized);
      if (!cancelled) setAiBriefBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dataSet, projectRoot, refreshKey, locale]);

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

      const baseForSummary = classified ?? merged;
      setAiBriefBusy(true);
      const summarized = await deepseekSummarizeInventory(baseForSummary, locale);
      if (!cancelled && summarized) {
        const briefMap = briefMapFromInventory(summarized, locale);
        setAggregateSnapshot((prev) =>
          prev ? patchAggregateSnapshotBrief(prev, locale, briefMap) : prev,
        );
      }
      if (!cancelled) setAiBriefBusy(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [dataSet, projectPaths, refreshKey, locale]);

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

    if (dataSet === "aggregate" && aggregateAssetsTab === "mine") {
      const mineRows: BrowseRow[] = (mySkillsLib?.items ?? []).map((it) => ({
        id: `mine:${it.id}`,
        sourceId: it.id,
        title: it.title,
        desc: it.description,
        descSource: "source",
        kind: "skill",
        ecosystem: "cursor",
        tags: [locale === "zh" ? "我的技能库" : "My skills"],
        active: true,
        sourcePath: it.path,
        scenario: null,
      }));
      const scenarioCounts = scenarioCountsFromRows(mineRows);
      const filtered = applyScenarioFilter(applyKindAndQuery(mineRows));
      return {
        sections: [{ key: "mine-grid", title: "", rows: filtered }],
        scenarioCounts,
      };
    }

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
            ? locale === "zh"
              ? "其他"
              : "Other"
            : AGENT_LABEL_BY_ID[agentId] ?? agentId;
        let rows = inventoryToRows(inv, agentId, agentTitle, locale).map((r) => ({
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
          ...inventoryToRows(a.inv, a.id, a.title, locale).map((r) => ({
            ...r,
            id: `g:${a.id}:${r.id}`,
            tags: [a.title, locale === "zh" ? "用户全局" : "Global"],
          })),
        );
      }
      for (const p of aggregateSnapshot.projects) {
        if (!p.inv) continue;
        const bn = folderBasename(p.path);
        rows.push(
          ...inventoryToRows(p.inv, "project", bn, locale).map((r) => {
            const aid = inferAgentIdFromAssetPath(r.sourcePath ?? "");
            const agentLbl = aid
              ? (AGENT_LABEL_BY_ID[aid] ?? aid)
              : locale === "zh"
                ? "其他"
                : "Other";
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
          inventoryToRows(liveInv, ecosystem, title, locale).map((r) => ({
            ...r,
            id: `g:${ecosystem}:${r.id}`,
          })),
        );
      }
      const globalSection: BrowseSection = {
        key: globalKey,
        title: locale === "zh" ? "用户全局目录" : "Global user directory",
        rows: globalRows,
      };

      const projectSections: BrowseSection[] = [];
      for (const { path, inv } of agentProjectScans) {
        if (!inv) continue;
        const scoped = filterInventoryForAgent(ecosystem, inv);
        if (inventoryAssetCount(scoped) === 0) continue;
        const bn = folderBasename(path);
        let rows = inventoryToRows(scoped, "project", bn, locale).map((r) => ({
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
    locale,
    aggregateAssetsTab,
    mySkillsLib,
  ]);

  useEffect(() => {
    if (dataSet !== "skills" && dataSet !== "project") {
      setExpandedSectionKeys(new Set());
      return;
    }
    const titled = sections.filter((s) => s.title);
    const validKeys = new Set(titled.map((s) => s.key));

    setExpandedSectionKeys((prev) => {
      if (titled.length === 0) {
        const next = new Set<string>();
        return prev.size === 0 ? prev : next;
      }
      if (titled.length === 1) {
        const only = titled[0]!.key;
        return prev.size === 1 && prev.has(only)
          ? prev
          : new Set([only]);
      }
      const next = new Set<string>();
      for (const k of prev) {
        if (validKeys.has(k)) next.add(k);
      }
      return stringSetsEqual(prev, next) ? prev : next;
    });
  }, [dataSet, sections]);

  const copyMenuSections = useMemo(
    () =>
      buildCopySkillMenuSections({
        dataSet,
        ecosystem,
        projectRoot,
        projectPaths,
        agentProjectScanPaths: agentProjectScans.map((s) => s.path),
      }),
    [dataSet, ecosystem, projectRoot, projectPaths, agentProjectScans],
  );

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
      skillExtraFiles: item.skillExtraFiles,
    });
  };

  const onCardContextMenu = (e: MouseEvent, item: BrowseRow) => {
    const p = item.sourcePath?.trim();
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    const pad = 8;
    const approxW = 240;
    const skillPath = item.sourcePath?.trim() ?? "";
    const isMineRow = item.id.startsWith("mine:");
    const skillHasDelete =
      item.kind === "skill" &&
      !!skillPath &&
      skillBrowsePathIsDeletableFolder(skillPath) &&
      !isMineRow;
    const approxH =
      item.kind === "skill"
        ? isMineRow
          ? 132
          : skillHasDelete
            ? 176
            : 132
        : 48;
    const vw = typeof window !== "undefined" ? window.innerWidth : e.clientX;
    const vh = typeof window !== "undefined" ? window.innerHeight : e.clientY;
    const x = Math.min(Math.max(pad, e.clientX), Math.max(pad, vw - approxW - pad));
    const y = Math.min(Math.max(pad, e.clientY), Math.max(pad, vh - approxH - pad));
    setCardContextMenu({ x, y, row: item });
  };

  function cardHoverTitle(item: BrowseRow): string | undefined {
    const d = item.desc.trim();
    return d.length > 0 ? d : undefined;
  }

  function renderBrowseCard(item: BrowseRow) {
    return (
      <article
        key={item.id}
        className="skill-card"
        title={cardHoverTitle(item)}
        onClick={() => openDetail(item)}
        onContextMenu={
          item.sourcePath?.trim()
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
          <span
            className={`skill-card__radio skill-card__radio--${item.descSource}`}
            aria-hidden
            title={item.descSource === "ai" ? (locale === "zh" ? "AI 缩略介绍" : "AI brief") : (locale === "zh" ? "原始描述" : "Source description")}
          />
          <span className="skill-card__title">{item.title}</span>
          <span
            className={`skill-card__kind skill-card__kind--${item.kind}`}
            aria-label={`${locale === "zh" ? "类型" : "Type"}: ${FILTER_LABEL[item.kind]}`}
          >
            {FILTER_LABEL[item.kind]}
          </span>
        </div>
        <p className="skill-card__desc">{item.desc}</p>
        {dataSet === "aggregate" && item.tags.length > 0 ? (
          <div className="skill-card__tags" aria-label={locale === "zh" ? "来源标签" : "Source tags"}>
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
        <div className="page-header__title-bar">
          <div className="page-title__row">
            <h2>{title}</h2>
            {dataSet === "aggregate" ? (
              <>
                <span className="count-badge">{listedTotal}</span>
                <div
                  className="seg page-header__assets-seg"
                  role="tablist"
                  aria-label={
                    locale === "zh" ? "资产范围" : "Asset scope"
                  }
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={aggregateAssetsTab === "all"}
                    className={`seg__item${aggregateAssetsTab === "all" ? " active" : ""}`}
                    onClick={() => setAggregateAssetsTab("all")}
                  >
                    {locale === "zh" ? "全部" : "All"}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={aggregateAssetsTab === "mine"}
                    className={`seg__item${aggregateAssetsTab === "mine" ? " active" : ""}`}
                    onClick={() => setAggregateAssetsTab("mine")}
                  >
                    {locale === "zh" ? "我的" : "Mine"}
                    <span className="skill-copy-dialog__tab-badge">
                      {mySkillsLib?.items.length ?? 0}
                    </span>
                  </button>
                </div>
              </>
            ) : (
              <span className="count-badge">{listedTotal}</span>
            )}
            {dataSet === "aggregate" && aggregateAssetsTab === "mine" ? (
              <button
                type="button"
                className="page-header__my-import"
                disabled={mySkillsImportBusy || refreshBusy}
                onClick={() => {
                  void (async () => {
                    setMySkillsImportBusy(true);
                    try {
                      const picked = await open({
                        directory: true,
                        multiple: false,
                      });
                      const dir =
                        typeof picked === "string"
                          ? picked
                          : Array.isArray(picked)
                            ? picked[0] ?? null
                            : null;
                      if (!dir?.trim()) return;
                      await addSkillToMyLibrary(dir.trim());
                      setRefreshKey((k) => k + 1);
                      setShellToast({
                        at: Date.now(),
                        message:
                          locale === "zh"
                            ? "已导入到「我的」"
                            : "Imported to My skills",
                      });
                    } catch (e) {
                      window.alert(
                        `${locale === "zh" ? "导入失败" : "Import failed"}: ${String(e)}`,
                      );
                    } finally {
                      setMySkillsImportBusy(false);
                    }
                  })();
                }}
              >
                {locale === "zh" ? "导入技能文件夹…" : "Import skill folder…"}
              </button>
            ) : null}
          </div>
          <PageRefreshButton
            onClick={onRefreshInventory}
            disabled={refreshBusy}
            spinning={refreshBusy}
            label={locale === "zh" ? "重新扫描并加载" : "Rescan and reload"}
          />
        </div>
        {subtitle ? (
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.88rem" }}>
            {subtitle}
          </p>
        ) : null}
        {ecosystem && dataSet === "skills" && (liveLoading || liveFailed) ? (
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
            {liveLoading
              ? locale === "zh"
                ? "正在读取该 Agent 的用户级全局目录与侧栏已添加项目…"
                : "Loading this agent's global directory and added projects…"
              : locale === "zh"
                ? "无法读取用户级全局目录：仍可查看侧栏项目中归属该 Agent 的配置；请在桌面端运行或检查权限。"
                : "Failed to read global directory. You can still view project-scoped entries."}
          </p>
        ) : null}
        {dataSet === "project" &&
        projectRoot &&
        (projectLoading || projectFailed) ? (
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
            {projectLoading
              ? locale === "zh"
                ? "正在扫描所选目录下各 Agent skills 目录、MCP（JSON）与规则文件…"
                : "Scanning agent skills, MCP JSON and rules in selected directory…"
              : locale === "zh"
                ? "无法扫描该目录：请在 AIControls 桌面端运行，或检查路径与权限。"
                : "Failed to scan this directory. Check desktop runtime and permissions."}
          </p>
        ) : null}
        {dataSet === "aggregate" ? (
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
            {aggregateAssetsTab === "mine"
              ? locale === "zh"
                ? "「我的」技能保存在本应用数据目录。在「全部」中右键技能选「复制到…」，在「用户全局」下选「AIControls『我的』技能库」即可加入；在「我的」中右键「应用到…」可部署到各 Agent 全局或侧栏项目。"
                : "My skills live under app data. In All view, right-click → Copy to… → pick AIControls \"Mine\" under the Global tab; from Mine, Apply to deploy to agents and projects."
              : aggregateLoading || aggregateSnapshot === null
                ? locale === "zh"
                  ? "正在汇总各 Agent 用户级全局目录与侧栏已添加项目…"
                  : "Aggregating global assets and added projects…"
                : aggregateSnapshot.anyInventoryFailed
                  ? locale === "zh"
                    ? "部分目录读取失败，已展示可用结果。"
                    : "Some directories failed to load; showing available results."
                  : locale === "zh"
                    ? "包含所有已识别 Agent 的全局 Skills、MCP、Rules，以及「全部项目」中各目录的扫描结果。"
                    : "Includes global assets from detected agents and scanned results from all projects."}
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
                placeholder={
                  locale === "zh"
                    ? "搜索标题、描述或路径…"
                    : "Search title, description, or path…"
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
            </label>
            {dataSet === "aggregate" && aggregateAssetsTab === "mine" ? (
              <span className="muted toolbar__mine-kind-hint">
                {locale === "zh" ? "仅 Skill" : "Skills only"}
              </span>
            ) : (
              <div
                className="seg"
                role="tablist"
                aria-label={locale === "zh" ? "类型筛选" : "Type filter"}
              >
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
            )}
          </div>
          <div
            className="scenario-strip"
            role="tablist"
            aria-label={locale === "zh" ? "场景分类" : "Scenario filter"}
          >
            <button
              type="button"
              role="tab"
              aria-selected={scenario === "all"}
              title={locale === "zh" ? "展示全部 Skill、MCP 与 Rules" : "Show all Skills, MCP and Rules"}
              className={`scenario-chip${scenario === "all" ? " active" : ""}`}
              onClick={() => setScenario("all")}
            >
              {getScenarioLabel(locale, "all")} ({scenarioCounts.all})
            </button>
            {SCENARIO_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={scenario === key}
                title={getScenarioHint(locale, key)}
                className={`scenario-chip${scenario === key ? " active" : ""}`}
                onClick={() => setScenario(key)}
              >
                {getScenarioLabel(locale, key)} ({scenarioCounts[key]})
              </button>
            ))}
          </div>
          {aiScenarioBusy || aiBriefBusy ? (
            <p
              className="muted toolbar__deepseek-status"
              role="status"
              aria-live="polite"
            >
              {aiScenarioBusy
                ? locale === "zh"
                  ? "DeepSeek 正在为尚未写入本地缓存的条目补全场景分类，请稍候…"
                  : "DeepSeek is classifying uncached entries…"
                : locale === "zh"
                  ? "DeepSeek 正在逐条生成中文缩略介绍（100字以内），请稍候…"
                  : "DeepSeek is generating English briefs (<=100 chars) …"}
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

      {cardContextMenu
        ? createPortal(
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
              aria-label={locale === "zh" ? "卡片操作" : "Card actions"}
            >
              <button
                type="button"
                role="menuitem"
                className="card-context-menu__item"
                onClick={() => {
                  const p = cardContextMenu.row.sourcePath?.trim();
                  if (p) void revealPathInFolder(p);
                  setCardContextMenu(null);
                }}
              >
                {locale === "zh" ? "在所在目录中显示" : "Show in folder"}
              </button>
              {!cardContextMenu.row.id.startsWith("mine:") ? (
              <button
                type="button"
                role="menuitem"
                className="card-context-menu__item"
                onClick={() => {
                  const row = cardContextMenu.row;
                  setCardContextMenu(null);
                  void (async () => {
                    const brief = await deepseekResummarizeAsset(
                      {
                        id: row.sourceId,
                        kind: row.kind,
                        title: row.title,
                        description: row.desc,
                        path: row.sourcePath ?? "",
                        active: row.active,
                      },
                      locale,
                    );
                    if (!brief) {
                      window.alert(locale === "zh" ? "重新生成简介失败" : "Failed to regenerate brief");
                      return;
                    }
                    const srcId = row.sourceId;
                    setLiveInv((prev) =>
                      prev ? patchEntryBriefInInventory(prev, srcId, locale, brief) : prev,
                    );
                    setAgentProjectScans((prev) =>
                      prev.map((item) => ({
                        ...item,
                        inv: item.inv
                          ? patchEntryBriefInInventory(item.inv, srcId, locale, brief)
                          : null,
                      })),
                    );
                    setProjectInv((prev) =>
                      prev ? patchEntryBriefInInventory(prev, srcId, locale, brief) : prev,
                    );
                    setAggregateSnapshot((prev) =>
                      prev
                        ? {
                            ...prev,
                            agents: prev.agents.map((a) => ({
                              ...a,
                              inv: a.inv
                                ? patchEntryBriefInInventory(a.inv, srcId, locale, brief)
                                : null,
                            })),
                            projects: prev.projects.map((p) => ({
                              ...p,
                              inv: p.inv
                                ? patchEntryBriefInInventory(p.inv, srcId, locale, brief)
                                : null,
                            })),
                          }
                        : prev,
                    );
                    setShellToast({
                      at: Date.now(),
                      message: locale === "zh" ? "已重新生成简介" : "Brief regenerated",
                    });
                  })();
                }}
              >
                {locale === "zh" ? "重新生成简介" : "Regenerate brief"}
              </button>
              ) : null}
              {cardContextMenu.row.kind === "skill" &&
              cardContextMenu.row.sourcePath?.trim() ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="card-context-menu__item"
                    onClick={() => {
                      setSkillCopyTargetModalRow(cardContextMenu.row);
                      setCardContextMenu(null);
                    }}
                  >
                    {cardContextMenu.row.id.startsWith("mine:")
                      ? locale === "zh"
                        ? "应用到…"
                        : "Apply to…"
                      : locale === "zh"
                        ? "复制到…"
                        : "Copy to…"}
                  </button>
                  {cardContextMenu.row.id.startsWith("mine:") ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="card-context-menu__item card-context-menu__item--danger"
                      onClick={() => {
                        const row = cardContextMenu.row;
                        const rawId = row.sourceId?.trim();
                        setCardContextMenu(null);
                        if (!rawId) return;
                        const ok = window.confirm(
                          locale === "zh"
                            ? `从「我的」移除「${row.title}」？将删除本地副本。`
                            : `Remove "${row.title}" from My skills? The local copy will be deleted.`,
                        );
                        if (!ok) return;
                        void (async () => {
                          try {
                            await removeMySkill(rawId);
                            setRefreshKey((k) => k + 1);
                            setSelectedEntry((cur) =>
                              cur?.path?.trim() === row.sourcePath?.trim()
                                ? null
                                : cur,
                            );
                            setShellToast({
                              at: Date.now(),
                              message:
                                locale === "zh" ? "已从「我的」移除" : "Removed from My skills",
                            });
                          } catch (err) {
                            window.alert(
                              `${locale === "zh" ? "移除失败" : "Remove failed"}: ${String(err)}`,
                            );
                          }
                        })();
                      }}
                    >
                      {locale === "zh" ? "从「我的」移除…" : "Remove from My skills…"}
                    </button>
                  ) : skillBrowsePathIsDeletableFolder(
                      cardContextMenu.row.sourcePath?.trim() ?? "",
                    ) ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="card-context-menu__item card-context-menu__item--danger"
                      onClick={() => {
                        const row = cardContextMenu.row;
                        const p = row.sourcePath?.trim();
                        if (!p) return;
                        const ok = window.confirm(
                          locale === "zh"
                            ? `确定要删除技能文件夹「${row.title}」吗？将删除整个文件夹及其中的文件，且无法撤销。`
                            : `Delete skill folder "${row.title}"? This removes all files and cannot be undone.`,
                        );
                        setCardContextMenu(null);
                        if (!ok) return;
                        void (async () => {
                          const r = await deleteSkillAtPath(p);
                          if ("error" in r) {
                            window.alert(`${locale === "zh" ? "删除失败" : "Delete failed"}: ${r.error}`);
                            return;
                          }
                          setSelectedEntry((cur) =>
                            cur?.path?.trim() === p ? null : cur,
                          );
                          setShellToast({ at: Date.now(), message: locale === "zh" ? "已删除" : "Deleted" });
                          onRefreshInventory();
                        })();
                      }}
                    >
                      {locale === "zh" ? "删除…" : "Delete…"}
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}

      {skillCopyTargetModalRow
        ? createPortal(
            <SkillCopyDestinationDialog
              row={skillCopyTargetModalRow}
              sections={copyMenuSections}
              dialogTitle={
                skillCopyTargetModalRow.id.startsWith("mine:")
                  ? locale === "zh"
                    ? "应用到…"
                    : "Apply to…"
                  : undefined
              }
              onClose={() => setSkillCopyTargetModalRow(null)}
              onChoose={(payload) => {
                const row = skillCopyTargetModalRow;
                const src = row.sourcePath?.trim();
                if (!src) return;
                void (async () => {
                  setSkillCopyTargetModalRow(null);
                  if (payload.destKind === "myLibrary") {
                    try {
                      await addSkillToMyLibrary(src);
                      setRefreshKey((k) => k + 1);
                      setShellToast({
                        at: Date.now(),
                        message:
                          locale === "zh"
                            ? "已复制到「我的」"
                            : "Copied to My skills",
                      });
                    } catch (err) {
                      window.alert(
                        `${locale === "zh" ? "复制到我的失败" : "Copy to My skills failed"}: ${String(err)}`,
                      );
                    }
                    return;
                  }

                  const r = await copySkillPackage({
                    sourcePath: src,
                    destKind: payload.destKind,
                    agentId: payload.agentId,
                    bucketIndex: payload.bucketIndex,
                    projectRoot:
                      payload.destKind === "project"
                        ? payload.projectRoot
                        : undefined,
                    onConflict: "suffix",
                  });
                  if ("error" in r) {
                    window.alert(`${locale === "zh" ? "复制失败" : "Copy failed"}: ${r.error}`);
                    return;
                  }
                  const applied = row.id.startsWith("mine:");
                  setShellToast({
                    at: Date.now(),
                    message: applied
                      ? locale === "zh"
                        ? "已应用"
                        : "Applied"
                      : locale === "zh"
                        ? "复制成功"
                        : "Copied",
                  });
                })();
              }}
            />,
            document.body,
          )
        : null}

      {shellToast
        ? createPortal(
            <div className="toast-stack" role="status" aria-live="polite">
              <div className="toast toast--success">
                <span className="toast__symbol" aria-hidden>
                  ✓
                </span>
                <span className="toast__text">{shellToast.message}</span>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* Skill 详情面板 */}
      <SkillDetailPanel
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
      />

      {listedTotal === 0 &&
      !(ecosystem && dataSet === "skills" && (liveLoading || liveFailed)) &&
      !(dataSet === "project" && projectLoading) &&
      !(
        dataSet === "aggregate" &&
        aggregateAssetsTab === "all" &&
        (aggregateLoading || aggregateSnapshot === null)
      ) &&
      !(dataSet === "aggregate" && aggregateAssetsTab === "mine" && mySkillsLoading) ? (
        <p className="muted" style={{ marginTop: "1rem" }}>
          {dataSet === "project"
            ? !projectRoot
              ? locale === "zh"
                ? "请先通过侧栏「添加项目」选择文件夹。"
                : "Please add a project folder from the sidebar first."
              : projectFailed
                ? null
                : locale === "zh"
                  ? "所选目录下未发现条目，或没有符合当前筛选的结果。"
                  : "No entries found in selected directory, or no matches for current filters."
            : dataSet === "aggregate"
              ? aggregateAssetsTab === "mine"
                ? locale === "zh"
                  ? "「我的」中暂无技能。可使用上方「导入技能文件夹」，或在「全部」中右键「复制到…」→「用户全局」下选「AIControls『我的』技能库」。"
                  : 'No skills in Mine yet. Use "Import skill folder", or in All view right-click → Copy to… → pick AIControls "Mine" under the Global tab.'
                : locale === "zh"
                  ? "未发现任何条目，或没有符合当前筛选的结果。"
                  : "No entries found, or no matches for current filters."
              : ecosystem && dataSet === "skills"
                ? locale === "zh"
                  ? "没有符合条件的全局条目。"
                  : "No matching global entries."
                : locale === "zh"
                  ? "没有符合当前筛选条件的条目。"
                  : "No entries match current filters."}
        </p>
      ) : null}
    </>
  );
}
