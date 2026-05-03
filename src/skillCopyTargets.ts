import type { CopySkillPackageInput } from "./api/agents";
import {
  normalizeProjectPath,
  pathsReferToSameDir,
} from "./projectPathsStorage";

const AGENT_ORDER = ["cursor", "claude", "trae", "qoder", "kiro"] as const;

const AGENT_UI_NAME: Record<string, string> = {
  cursor: "Cursor",
  claude: "Claude Code",
  trae: "Trae",
  qoder: "Qoder",
  kiro: "Kiro",
};

/** Relative skill roots; index = `bucketIndex` passed to the desktop command. */
const SKILL_BUCKET_REL: Record<string, readonly string[]> = {
  cursor: [".cursor/skills-cursor", ".cursor/skills"],
  claude: [".claude/skills"],
  trae: [".trae/skills"],
  qoder: [".qoder/skills", ".qoderwork/skills"],
  kiro: [".kiro/skills"],
};

export type CopySkillTargetPayload = Omit<
  CopySkillPackageInput,
  "sourcePath" | "onConflict"
>;

export type CopySkillMenuSection = {
  key: string;
  title: string;
  items: { id: string; label: string; payload: CopySkillTargetPayload }[];
};

function folderBasename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "项目";
}

/** 侧栏项目 + 当前路由项目（URL ?path=）合并去重，避免只打开单一项目页时缺少条目。 */
function mergeProjectRootsForCopy(
  projectPaths: readonly string[],
  projectRoot?: string,
): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    const t = normalizeProjectPath(raw);
    if (!t) return;
    if (out.some((p) => pathsReferToSameDir(p, t))) return;
    out.push(t);
  };
  for (const p of projectPaths) push(p);
  if (projectRoot?.trim()) push(projectRoot);
  return out;
}

function globalItems(agentId: string): CopySkillMenuSection["items"] {
  const rels = SKILL_BUCKET_REL[agentId];
  if (!rels) return [];
  const agentName = AGENT_UI_NAME[agentId] ?? agentId;
  return rels.map((rel, bucketIndex) => ({
    id: `g:${agentId}:${bucketIndex}`,
    label: `${agentName} · ${rel}`,
    payload: {
      destKind: "global" as const,
      agentId,
      bucketIndex,
    },
  }));
}

function projectItems(
  projectRoot: string,
  agentId: string,
): CopySkillMenuSection["items"] {
  const rels = SKILL_BUCKET_REL[agentId];
  if (!rels) return [];
  const agentName = AGENT_UI_NAME[agentId] ?? agentId;
  return rels.map((rel, bucketIndex) => ({
    id: `p:${projectRoot}:${agentId}:${bucketIndex}`,
    label: `${agentName} · ${rel}`,
    payload: {
      destKind: "project" as const,
      agentId,
      bucketIndex,
      projectRoot,
    },
  }));
}

/** Destinations for「复制 skill」：仅全局 Agent skills 根、或项目下各 Agent 的 skills 根（不做「无 agent 的项目路径」）。 */
export function buildCopySkillMenuSections(params: {
  dataSet: "skills" | "project" | "aggregate";
  ecosystem?: string;
  projectRoot?: string;
  projectPaths: readonly string[];
  /** Agent 页侧栏已扫过的项目路径（与全局同一生态合并展示时的项目列表） */
  agentProjectScanPaths: readonly string[];
}): CopySkillMenuSection[] {
  const {
    dataSet,
    ecosystem,
    projectRoot,
    projectPaths,
    agentProjectScanPaths,
  } = params;
  const sections: CopySkillMenuSection[] = [];

  if (dataSet === "skills" && ecosystem) {
    sections.push({
      key: "global-one",
      title: "复制到 · 用户全局",
      items: globalItems(ecosystem),
    });
    for (const p of agentProjectScanPaths) {
      sections.push({
        key: `proj:${p}`,
        title: `复制到 · 项目「${folderBasename(p)}」`,
        items: projectItems(p, ecosystem),
      });
    }
    return sections;
  }

  if (dataSet === "project") {
    sections.push({
      key: "global-all",
      title: "复制到 · 用户全局",
      items: AGENT_ORDER.flatMap((id) => globalItems(id)),
    });
    const merged = mergeProjectRootsForCopy(projectPaths, projectRoot);
    const cur = projectRoot?.trim()
      ? normalizeProjectPath(projectRoot)
      : "";
    for (const pt of merged) {
      const isCurrent = cur.length > 0 && pathsReferToSameDir(cur, pt);
      sections.push({
        key: `proj:${pt}`,
        title: isCurrent
          ? `复制到 · 当前项目「${folderBasename(pt)}」`
          : `复制到 · 项目「${folderBasename(pt)}」`,
        items: AGENT_ORDER.flatMap((id) => projectItems(pt, id)),
      });
    }
    return sections;
  }

  if (dataSet === "aggregate") {
    sections.push({
      key: "global-all",
      title: "复制到 · 用户全局",
      items: AGENT_ORDER.flatMap((id) => globalItems(id)),
    });
    for (const p of projectPaths) {
      const pt = p.trim();
      if (!pt) continue;
      sections.push({
        key: `proj:${pt}`,
        title: `复制到 · 项目「${folderBasename(pt)}」`,
        items: AGENT_ORDER.flatMap((id) => projectItems(pt, id)),
      });
    }
    return sections;
  }

  return sections;
}
