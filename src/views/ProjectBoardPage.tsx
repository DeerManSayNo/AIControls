import { useCallback, useEffect, useMemo, useState, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { PageRefreshButton } from "../components/PageRefreshButton";
import { DetailSheet } from "../components/DetailSheet";
import { useProjectPaths } from "../projectPathsStorage";
import {
  type StageKey,
  getStageForProject,
  setStageForProject,
  useProjectStagesMap,
} from "../projectStageStorage";
import {
  type ProjectGitInfo,
  type BranchCommitInfo,
  detectProjectGitInfo,
  detectBranchCommitInfo,
} from "../api/projectGit";
import {
  type CodeLineResult,
  countProjectCodeLines,
  readPackageVersion,
  estimateProjectProgress,
  gitCommitCountLastNDays,
  gitWeeklyCommitCounts,
  gitContributors,
  type Contributor,
  gitCheckLocalChanges,
  gitPull,
} from "../api/codeMetrics";

type ActivityLevel = "high" | "very-high" | "medium" | "low";

function commitsToActivity(count: number): ActivityLevel {
  if (count >= 40) return "very-high";
  if (count >= 11) return "high";
  if (count >= 1) return "medium";
  return "low";
}

const CACHE_TTL_MS = 10 * 60 * 1000;

interface BoardCache {
  timestamp: number;
  codeLinesMap: Map<string, CodeLineResult>;
  versionMap: Map<string, string>;
  progressMap: Map<string, number>;
  activityMap: Map<string, ActivityLevel>;
  sparklineMap: Map<string, number[]>;
  membersMap: Map<string, Contributor[]>;
  updatedMap: Map<string, string>;
}

let boardCache: BoardCache | null = null;

function isCacheValid(): boolean {
  return boardCache !== null && Date.now() - boardCache.timestamp < CACHE_TTL_MS;
}

type BoardProject = {
  path: string;
  name: string;
  description: string;
  stage: StageKey;
  progress?: number;
  version?: string;
  codeLines: string;
  activity: ActivityLevel;
  members: number;
  updated: string;
  sparkline: number[];
};

const stageConfig: Record<
  StageKey,
  {
    title: string;
    badge: string;
    tone: "purple" | "green" | "blue";
  }
> = {
  mvp: {
    title: "MVP 阶段（未上线）",
    badge: "MVP",
    tone: "purple",
  },
  rapid: {
    title: "快速迭代阶段（已上线）",
    badge: "已上线",
    tone: "green",
  },
  stable: {
    title: "慢迭代阶段（稳定维护）",
    badge: "稳定维护",
    tone: "blue",
  },
};

const stageOptions: { key: StageKey; label: string; desc: string }[] = [
  { key: "mvp", label: "MVP 阶段", desc: "项目处于早期开发，尚未上线" },
  { key: "rapid", label: "快速迭代", desc: "项目已上线，正在快速迭代" },
  { key: "stable", label: "稳定维护", desc: "项目进入稳定期，慢迭代维护" },
];

const activityLabels: Record<ActivityLevel, string> = {
  high: "高",
  "very-high": "很高",
  medium: "中",
  low: "低",
};

function folderBasename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? path;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

function Sparkline({ values, tone }: { values: number[]; tone: StageKey | "overview" }) {
  const width = 118;
  const height = 34;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - 4 - ((value - min) / span) * (height - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className={`project-board-sparkline project-board-sparkline--${tone}`} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={points} />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

/** Animated "..." that cycles from 0 to 3 dots */
function Dots() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCount((c) => (c + 1) % 4), 400);
    return () => clearInterval(id);
  }, []);
  return <span aria-hidden>{["", ".", "..", "..."][count]}</span>;
}

function PullIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden>
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.21.68-.47v-1.65c-2.77.6-3.35-1.18-3.35-1.18-.46-1.15-1.1-1.46-1.1-1.46-.9-.62.07-.61.07-.61 1 .07 1.52 1.01 1.52 1.01.88 1.49 2.31 1.06 2.88.8.09-.63.35-1.06.63-1.3-2.21-.25-4.54-1.09-4.54-4.85 0-1.07.39-1.94 1.02-2.62-.1-.25-.44-1.27.1-2.64 0 0 .84-.26 2.75 1a9.63 9.63 0 0 1 5.02 0c1.91-1.26 2.75-1 2.75-1 .54 1.37.2 2.39.1 2.64.64.68 1.02 1.55 1.02 2.62 0 3.77-2.33 4.6-4.56 4.85.36.31.67.92.67 1.86v2.75c0 .26.18.57.69.47A10 10 0 0 0 12 2Z"
        fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function useContextMenu() {
  const [anchor, setAnchor] = useState<{ x: number; y: number; path: string } | null>(null);
  const open = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setAnchor({ x: e.clientX, y: e.clientY, path });
  };
  const close = () => setAnchor(null);
  return { anchor, open, close };
}

function CardContextMenu({
  anchor,
  onClose,
  onPull,
}: {
  anchor: { x: number; y: number };
  onClose: () => void;
  onPull: () => void;
}) {
  const menuRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  return (
    <ul
      className="card-context-menu"
      ref={menuRef}
      style={{ left: anchor.x, top: anchor.y }}
    >
      <li>
        <button
          type="button"
          className="card-context-menu__item"
          onClick={() => { onPull(); onClose(); }}
        >
          <PullIcon />
          拉取最新代码
        </button>
      </li>
    </ul>
  );
}

type BoardToastVariant = "error" | "success" | "info";

function Toast({
  message,
  variant,
  onClose,
}: {
  message: string;
  variant: BoardToastVariant;
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const tone =
    variant === "error" ? "toast--error" : variant === "info" ? "toast--info" : "toast--success";

  return createPortal(
    <div className="toast-stack" role="status" aria-live="polite">
      <div className={`toast ${tone}`}>
        <span className="toast__text">{message}</span>
      </div>
    </div>,
    document.body,
  );
}

/** Infer user-facing message from combined git pull output (stdout/stderr). */
function messageFromPullOutput(output: string): { message: string; variant: "success" | "info" } {
  const t = output.trim().toLowerCase();
  const raw = output;
  const upToDateEn = t.includes("already up to date") || t.includes("already up-to-date");
  const upToDateZh =
    raw.includes("已经是最新的") ||
    raw.includes("已是最新") ||
    raw.includes("已为最新") ||
    raw.includes("无需更新");
  if (upToDateEn || upToDateZh) {
    return { message: "当前已是最新代码", variant: "info" };
  }
  return { message: "拉取成功", variant: "success" };
}

function MemberAvatars({ count, contributors }: { count: number; contributors?: Contributor[] }) {
  if (count === 0 || !contributors || contributors.length === 0) {
    return (
      <div className="project-card__members">
        <span>{count > 0 ? `${count} 位成员` : "无成员信息"}</span>
      </div>
    );
  }
  return (
    <div className="project-card__members project-card__members--hoverable" tabIndex={0}>
      <div className="project-card__avatar-stack" aria-hidden>
        {Array.from({ length: Math.min(count, 3) }, (_, index) => (
          <span key={index} className={`project-card__avatar project-card__avatar--${index + 1}`} />
        ))}
      </div>
      <span>{count} 位成员</span>
      <div className="project-card__members-popup">
        <ul>
          {contributors.map((c) => (
            <li key={c.email || c.name}>
              <strong>{c.name}</strong>
              {c.commits > 0 && <em>{c.commits} 次提交</em>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  contributors,
  onPull,
  pulling,
  onClick,
}: {
  project: BoardProject;
  contributors?: Contributor[];
  onPull: () => void;
  pulling: boolean;
  onClick: () => void;
}) {
  const cfg = stageConfig[project.stage];
  const menu = useContextMenu();
  return (
    <>
      <article
        className={`project-card project-card--${project.stage} project-card--clickable`}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onContextMenu={(e) => menu.open(e, project.path)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        style={{ position: "relative" }}
      >
        {pulling && (
          <div className="project-card__overlay">
            <span className="project-card__overlay-text">正在拉取中<Dots /></span>
          </div>
        )}
      <div className="project-card__head">
        <div>
          <h3>{project.name}</h3>
          <p>{project.description}</p>
        </div>
        <span className={`project-card__badge project-card__badge--${cfg.tone}`}>
          {cfg.badge}
        </span>
      </div>

      {typeof project.progress === "number" ? (
        <div className="project-card__progress">
          <div className="project-card__progress-top">
            <span>进度</span>
            <strong>{project.progress}%</strong>
          </div>
          <div className="project-card__bar">
            <span style={{ width: `${project.progress}%` }} />
          </div>
        </div>
      ) : (
        <div className="project-card__version">
          <span>版本</span>
          <strong>{project.version}</strong>
        </div>
      )}

      <div className="project-card__stats">
        <div>
          <span>代码行数</span>
          <strong>{project.codeLines}</strong>
        </div>
        <div>
          <span>活跃度</span>
          <strong className={`project-card__activity project-card__activity--${project.activity}`}>
            {activityLabels[project.activity]}
          </strong>
        </div>
        <Sparkline values={project.sparkline} tone={project.stage} />
      </div>

      <footer className="project-card__foot" onClick={(e) => e.stopPropagation()}>
        <MemberAvatars count={project.members} contributors={contributors} />
        <span>{project.updated}</span>
      </footer>
    </article>
    {menu.anchor && createPortal(
      <CardContextMenu
        anchor={menu.anchor}
        onClose={menu.close}
        onPull={onPull}
      />,
      document.body,
    )}
    </>
  );
}

function StageSection({
  stage,
  projects: projectList,
  membersMap,
  pullingPaths,
  onPull,
  onProjectClick,
}: {
  stage: StageKey;
  projects: BoardProject[];
  membersMap: Map<string, Contributor[]>;
  pullingPaths: Set<string>;
  onPull: (path: string) => void;
  onProjectClick: (path: string) => void;
}) {
  const cfg = stageConfig[stage];
  const [expanded, setExpanded] = useState(false);

  return (
    <section className={`project-stage${expanded ? " project-stage--expanded" : ""}`}>
      <header
        className="project-stage__head"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((e) => !e); }
        }}
      >
        <div className="project-stage__title">
          <span className={`project-stage__dot project-stage__dot--${cfg.tone}`} />
          <h2>{cfg.title}</h2>
        </div>
        <span className="project-stage__all">
          {projectList.length} 个项目
          <svg
            className={`project-stage__chevron${expanded ? " project-stage__chevron--up" : ""}`}
            viewBox="0 0 24 24"
            width={14}
            height={14}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </header>
      <div className="project-stage__row">
        {projectList.map((project) => (
          <ProjectCard
            key={project.path}
            project={project}
            contributors={membersMap.get(project.path)}
            pulling={pullingPaths.has(project.path)}
            onPull={() => onPull(project.path)}
            onClick={() => onProjectClick(project.path)}
          />
        ))}
      </div>
    </section>
  );
}

function StagePicker({
  value,
  onChange,
}: {
  value: StageKey;
  onChange: (stage: StageKey) => void;
}) {
  return (
    <div className="stage-picker" role="radiogroup" aria-label="项目阶段">
      {stageOptions.map((opt) => {
        const cfg = stageConfig[opt.key];
        const isActive = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={isActive}
            className={`stage-picker__option${isActive ? ` stage-picker__option--active stage-picker__option--${cfg.tone}` : ""}`}
            onClick={() => onChange(opt.key)}
          >
            <span className={`stage-picker__dot stage-picker__dot--${cfg.tone}`} />
            <span className="stage-picker__text">
              <strong>{opt.label}</strong>
              <em>{opt.desc}</em>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function GitIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden>
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.21.68-.47v-1.65c-2.77.6-3.35-1.18-3.35-1.18-.46-1.15-1.1-1.46-1.1-1.46-.9-.62.07-.61.07-.61 1 .07 1.52 1.01 1.52 1.01.88 1.49 2.31 1.06 2.88.8.09-.63.35-1.06.63-1.3-2.21-.25-4.54-1.09-4.54-4.85 0-1.07.39-1.94 1.02-2.62-.1-.25-.44-1.27.1-2.64 0 0 .84-.26 2.75 1a9.63 9.63 0 0 1 5.02 0c1.91-1.26 2.75-1 2.75-1 .54 1.37.2 2.39.1 2.64.64.68 1.02 1.55 1.02 2.62 0 3.77-2.33 4.6-4.56 4.85.36.31.67.92.67 1.86v2.75c0 .26.18.57.69.47A10 10 0 0 0 12 2Z"
      />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        d="M6 3v12m12-12v6a6 6 0 0 1-6 6H6"
      />
      <circle cx="6" cy="18" r="2" fill="currentColor" />
      <circle cx="18" cy="6" r="2" fill="currentColor" />
    </svg>
  );
}

function GitInfoBlock({ git, projectPath }: { git: ProjectGitInfo; projectPath: string }) {
  const currentBranch = git.branch;
  const allBranches = git.branches;
  const defaultBranch = currentBranch ?? allBranches[0] ?? null;
  const otherBranches = allBranches.filter((b) => b !== currentBranch);

  const [viewingBranch, setViewingBranch] = useState<string | null>(null);
  const [branchCommit, setBranchCommit] = useState<BranchCommitInfo | null>(null);

  const activeBranch = viewingBranch ?? defaultBranch;

  useEffect(() => {
    if (!git.is_repo || !activeBranch || !projectPath) {
      setBranchCommit(null);
      return;
    }
    if (viewingBranch === null && currentBranch) {
      setBranchCommit({
        hash: git.last_commit_hash,
        message: git.last_commit_message,
        author: git.last_commit_author,
        date: git.last_commit_date,
      });
      return;
    }
    let cancelled = false;
    void detectBranchCommitInfo(projectPath, activeBranch).then((info) => {
      if (!cancelled) setBranchCommit(info);
    });
    return () => { cancelled = true; };
  }, [git.is_repo, viewingBranch, activeBranch, projectPath, currentBranch,
      git.last_commit_hash, git.last_commit_message, git.last_commit_author, git.last_commit_date]);

  useEffect(() => {
    setViewingBranch(null);
  }, [git.branch]);

  if (!git.is_repo) {
    return (
      <div className="git-info git-info--empty">
        <GitIcon />
        <span>未检测到 Git 仓库</span>
      </div>
    );
  }

  const handleBranchClick = (branch: string) => {
    if (branch === currentBranch && viewingBranch === null) return;
    if (branch === currentBranch) {
      setViewingBranch(null);
    } else {
      setViewingBranch(branch);
    }
  };

  return (
    <div className="git-info">
      <div className="git-info__header">
        <GitIcon />
        <span className="git-info__label">Git 仓库</span>
      </div>
      <dl className="git-info__list">
        {currentBranch && (
          <div className="git-info__row">
            <dt><BranchIcon /> 当前分支</dt>
            <dd>
              <button
                type="button"
                className={`git-info__branch-btn${currentBranch === activeBranch ? " git-info__branch-btn--active" : ""} git-info__branch-btn--head`}
                onClick={() => handleBranchClick(currentBranch)}
                title={`${currentBranch} (HEAD)`}
              >
                {currentBranch}
                <em>HEAD</em>
              </button>
            </dd>
          </div>
        )}
        {otherBranches.length > 0 && (
          <div className="git-info__row">
            <dt><BranchIcon /> 其他分支</dt>
            <dd className="git-info__branches">
              {otherBranches.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`git-info__branch-btn${b === activeBranch ? " git-info__branch-btn--active" : ""}`}
                  onClick={() => handleBranchClick(b)}
                  title={`查看 ${b}`}
                >
                  {b}
                </button>
              ))}
            </dd>
          </div>
        )}
        {git.remote_url && (
          <div className="git-info__row">
            <dt>远程地址</dt>
            <dd className="git-info__remote">{git.remote_url}</dd>
          </div>
        )}
        {branchCommit && branchCommit.hash && (
          <div className="git-info__row">
            <dt>最近提交</dt>
            <dd>
              <span className="git-info__hash">{branchCommit.hash}</span>
              {branchCommit.message && (
                <span className="git-info__msg">{branchCommit.message}</span>
              )}
            </dd>
          </div>
        )}
        {branchCommit && branchCommit.author && (
          <div className="git-info__row">
            <dt>提交者</dt>
            <dd>
              <span>{branchCommit.author}</span>
              {branchCommit.date && (
                <span className="git-info__date"> · {branchCommit.date}</span>
              )}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export default function ProjectBoardPage() {
  const searchId = useId();
  const projectPaths = useProjectPaths();
  const stagesMap = useProjectStagesMap();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [gitInfo, setGitInfo] = useState<ProjectGitInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [codeLinesMap, setCodeLinesMap] = useState<Map<string, CodeLineResult>>(
    () => boardCache?.codeLinesMap ?? new Map(),
  );
  const [versionMap, setVersionMap] = useState<Map<string, string>>(
    () => boardCache?.versionMap ?? new Map(),
  );
  const [progressMap, setProgressMap] = useState<Map<string, number>>(
    () => boardCache?.progressMap ?? new Map(),
  );
  const [activityMap, setActivityMap] = useState<Map<string, ActivityLevel>>(
    () => boardCache?.activityMap ?? new Map(),
  );
  const [sparklineMap, setSparklineMap] = useState<Map<string, number[]>>(
    () => boardCache?.sparklineMap ?? new Map(),
  );
  const [membersMap, setMembersMap] = useState<Map<string, Contributor[]>>(
    () => boardCache?.membersMap ?? new Map(),
  );
  const [updatedMap, setUpdatedMap] = useState<Map<string, string>>(
    () => boardCache?.updatedMap ?? new Map(),
  );
  // Incrementing counter: mount + cache-miss → 0, refresh button bumps to trigger re-fetch.
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [boardLoading, setBoardLoading] = useState(false);
  const [pullingPaths, setPullingPaths] = useState<Set<string>>(new Set());
  const [boardToast, setBoardToast] = useState<{
    message: string;
    variant: BoardToastVariant;
  } | null>(null);

  const handlePull = useCallback(async (projectPath: string) => {
    setPullingPaths((prev) => new Set(prev).add(projectPath));
    try {
      const status = await gitCheckLocalChanges(projectPath);
      if (status?.has_changes) {
        const ok = window.confirm(
          `检测到本地有修改（${status.details}），拉取最新代码可能会导致冲突。\n\n是否继续拉取？`,
        );
        if (!ok) {
          setPullingPaths((prev) => { const n = new Set(prev); n.delete(projectPath); return n; });
          return;
        }
      }
      const output = await gitPull(projectPath);
      const { message, variant } = messageFromPullOutput(output);
      setBoardToast({ message, variant });
      setRefreshEpoch((n) => n + 1);
    } catch (e) {
      setBoardToast({
        message: typeof e === "string" ? e : "拉取失败",
        variant: "error",
      });
    } finally {
      setPullingPaths((prev) => { const n = new Set(prev); n.delete(projectPath); return n; });
    }
  }, []);

  useEffect(() => {
    if (!selectedPath) {
      setGitInfo(null);
      return;
    }
    let cancelled = false;
    void detectProjectGitInfo(selectedPath).then((info) => {
      if (!cancelled) setGitInfo(info);
    });
    return () => { cancelled = true; };
  }, [selectedPath]);

  useEffect(() => {
    if (projectPaths.length === 0) return;

    const forced = refreshEpoch > 0;

    // Not forced and cache valid → restore and done.
    if (!forced && isCacheValid() && boardCache) {
      setCodeLinesMap(new Map(boardCache.codeLinesMap));
      setVersionMap(new Map(boardCache.versionMap));
      setProgressMap(new Map(boardCache.progressMap));
      setActivityMap(new Map(boardCache.activityMap));
      setSparklineMap(new Map(boardCache.sparklineMap));
      setMembersMap(new Map(boardCache.membersMap));
      setUpdatedMap(new Map(boardCache.updatedMap));
      setBoardLoading(false);
      return;
    }

    // Clear stale cache before fetching.
    boardCache = null;
    setBoardLoading(true);

    let cancelled = false;
    const codeResults = new Map<string, CodeLineResult>();
    const versionResults = new Map<string, string>();
    const progressResults = new Map<string, number>();
    const activityResults = new Map<string, ActivityLevel>();
    const sparklineResults = new Map<string, number[]>();
    const membersResults = new Map<string, Contributor[]>();
    const updatedResults = new Map<string, string>();
    const totalPaths = projectPaths.length;
    const mvpPaths = projectPaths.filter((p) => getStageForProject(p) === "mvp");
    let pending = totalPaths * 6 + mvpPaths.length;

    const commit = () => {
      if (pending === 0 && !cancelled) {
        const snapshot: BoardCache = {
          timestamp: Date.now(),
          codeLinesMap: new Map(codeResults),
          versionMap: new Map(versionResults),
          progressMap: new Map(progressResults),
          activityMap: new Map(activityResults),
          sparklineMap: new Map(sparklineResults),
          membersMap: new Map(membersResults),
          updatedMap: new Map(updatedResults),
        };
        boardCache = snapshot;
        setCodeLinesMap(snapshot.codeLinesMap);
        setVersionMap(snapshot.versionMap);
        setProgressMap(snapshot.progressMap);
        setActivityMap(snapshot.activityMap);
        setSparklineMap(snapshot.sparklineMap);
        setMembersMap(snapshot.membersMap);
        setUpdatedMap(snapshot.updatedMap);
        setBoardLoading(false);
      }
    };

    for (const path of projectPaths) {
      void countProjectCodeLines(path).then((result) => {
        if (cancelled) return;
        if (result) codeResults.set(path, result);
        pending -= 1;
        commit();
      });
      void readPackageVersion(path).then((version) => {
        if (cancelled) return;
        if (version) versionResults.set(path, version);
        pending -= 1;
        commit();
      });
      void gitCommitCountLastNDays(path, 30).then((count) => {
        if (cancelled) return;
        activityResults.set(path, commitsToActivity(count));
        pending -= 1;
        commit();
      });
      void gitWeeklyCommitCounts(path).then((counts) => {
        if (cancelled) return;
        sparklineResults.set(path, counts);
        pending -= 1;
        commit();
      });
      void gitContributors(path).then((list) => {
        if (cancelled) return;
        if (list.length > 0) membersResults.set(path, list);
        pending -= 1;
        commit();
      });
      void detectProjectGitInfo(path).then((info) => {
        if (cancelled) return;
        if (info?.last_commit_date) updatedResults.set(path, info.last_commit_date);
        pending -= 1;
        commit();
      });
    }

    for (const path of mvpPaths) {
      void estimateProjectProgress(path).then((result) => {
        if (cancelled) return;
        if (result) progressResults.set(path, result.progress);
        pending -= 1;
        commit();
      });
    }

    return () => { cancelled = true; };
  }, [projectPaths, stagesMap, refreshEpoch]);

  const projects = useMemo<BoardProject[]>(() => {
    return projectPaths.map((path) => {
      let stage: StageKey = "mvp";
      for (const [k, v] of stagesMap) {
        if (k === path) { stage = v; break; }
      }
      const codeResult = codeLinesMap.get(path);
      const codeLines = codeResult
        ? formatNumber(codeResult.code_lines)
        : "—";
      return {
        path,
        name: folderBasename(path),
        description: "项目开发中",
        stage,
        progress: stage === "mvp" ? (progressMap.get(path) ?? 0) : undefined,
        version: stage !== "mvp" ? (versionMap.get(path) ?? "—") : undefined,
        codeLines,
        activity: activityMap.get(path) ?? "low",
        members: (membersMap.get(path) ?? []).length,
        updated: updatedMap.get(path) ?? "—",
        sparkline: sparklineMap.get(path) ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPaths, stagesMap, codeLinesMap, versionMap, progressMap, activityMap, sparklineMap, membersMap, updatedMap]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, searchQuery]);

  const grouped = useMemo(() => {
    const mvp = filteredProjects.filter((p) => p.stage === "mvp");
    const rapid = filteredProjects.filter((p) => p.stage === "rapid");
    const stable = filteredProjects.filter((p) => p.stage === "stable");
    return { mvp, rapid, stable };
  }, [filteredProjects]);

  const totalCount = projects.length;
  const totalCodeLines = useMemo(() => {
    let sum = 0;
    for (const result of codeLinesMap.values()) {
      sum += result.code_lines;
    }
    return sum;
  }, [codeLinesMap]);

  const overviewSparkline = useMemo(() => {
    if (sparklineMap.size === 0) return Array(12).fill(0);
    const summed = Array(12).fill(0);
    for (const weeks of sparklineMap.values()) {
      for (let i = 0; i < 12; i++) {
        summed[i] += weeks[i] ?? 0;
      }
    }
    return summed;
  }, [sparklineMap]);

  const averageActivityLabel = useMemo(() => {
    if (activityMap.size === 0) return "—";
    let total = 0;
    for (const level of activityMap.values()) {
      const score = level === "very-high" ? 4 : level === "high" ? 3 : level === "medium" ? 2 : 1;
      total += score;
    }
    const avg = total / activityMap.size;
    if (avg >= 3.5) return "很高";
    if (avg >= 2.5) return "高";
    if (avg >= 1.5) return "中等";
    return "低";
  }, [activityMap]);

  const weeklyCommitsThisWeek = useMemo(() => {
    let sum = 0;
    for (const weeks of sparklineMap.values()) {
      sum += weeks[11] ?? 0;
    }
    return sum;
  }, [sparklineMap]);

  const selectedStage = selectedPath ? getStageForProject(selectedPath) : null;
  const selectedName = selectedPath ? folderBasename(selectedPath) : null;

  const handleStageChange = (stage: StageKey) => {
    if (!selectedPath) return;
    setStageForProject(selectedPath, stage);
    setSelectedPath(null);
  };

  const emptyState = totalCount === 0;
  const noSearchResults = !emptyState && filteredProjects.length === 0;

  return (
    <div className="project-board">
      <header className="project-board__header">
        <div>
          <h1>项目看板</h1>
          <p>全局视角，掌握所有项目的进展与健康状态</p>
        </div>
        <PageRefreshButton
          onClick={() => setRefreshEpoch((n) => n + 1)}
          spinning={boardLoading}
          label="重新加载项目看板"
        />
      </header>

      <div className="project-board__actions">
        <label className="project-board-search" htmlFor={searchId}>
          <SearchIcon />
          <input
            id={searchId}
            type="search"
            placeholder="搜索项目..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>
      </div>

      {emptyState ? (
        <div className="project-board__empty">
          <p>暂无项目，请在侧栏点击「添加项目」导入你的第一个项目</p>
        </div>
      ) : (
        <>
          <section className="project-summary" aria-label="项目总览">
            <div className="project-summary__metrics">
              <h2>项目总览</h2>
              <div className="project-summary__metric">
                <span>总项目数</span>
                <strong>{totalCount}</strong>
              </div>
              <div className="project-summary__metric project-summary__metric--wide">
                <span>总代码行数</span>
                <strong>{totalCodeLines > 0 ? formatNumber(totalCodeLines) : "—"} <em>行</em></strong>
              </div>
              <div className="project-summary__metric project-summary__metric--activity">
                <span>平均活跃度</span>
                <div>
                  <Sparkline values={overviewSparkline} tone="overview" />
                  <strong>{averageActivityLabel}</strong>
                </div>
              </div>
              <div className="project-summary__metric">
                <span>本周更新</span>
                <strong>{weeklyCommitsThisWeek > 0 ? weeklyCommitsThisWeek : "—"} <em>次</em></strong>
              </div>
            </div>
            <div className="project-summary__donut" aria-hidden />
            <ul className="project-summary__legend">
              <li>
                <span className="project-summary__legend-dot project-summary__legend-dot--purple" />
                MVP 阶段（未上线）
                <strong>{grouped.mvp.length} ({totalCount > 0 ? Math.round((grouped.mvp.length / totalCount) * 100) : 0}%)</strong>
              </li>
              <li>
                <span className="project-summary__legend-dot project-summary__legend-dot--green" />
                快速迭代阶段（已上线）
                <strong>{grouped.rapid.length} ({totalCount > 0 ? Math.round((grouped.rapid.length / totalCount) * 100) : 0}%)</strong>
              </li>
              <li>
                <span className="project-summary__legend-dot project-summary__legend-dot--blue" />
                慢迭代阶段（稳定维护）
                <strong>{grouped.stable.length} ({totalCount > 0 ? Math.round((grouped.stable.length / totalCount) * 100) : 0}%)</strong>
              </li>
            </ul>
          </section>

          {noSearchResults ? (
            <div className="project-board__empty">
              <p>没有找到匹配「{searchQuery}」的项目</p>
            </div>
          ) : (
            <>
              <StageSection stage="mvp" projects={grouped.mvp} membersMap={membersMap} pullingPaths={pullingPaths} onPull={handlePull} onProjectClick={setSelectedPath} />
              <StageSection stage="rapid" projects={grouped.rapid} membersMap={membersMap} pullingPaths={pullingPaths} onPull={handlePull} onProjectClick={setSelectedPath} />
              <StageSection stage="stable" projects={grouped.stable} membersMap={membersMap} pullingPaths={pullingPaths} onPull={handlePull} onProjectClick={setSelectedPath} />
            </>
          )}
        </>
      )}

      <DetailSheet
        open={selectedPath !== null}
        title={selectedName ?? ""}
        description={selectedPath ?? ""}
        onClose={() => setSelectedPath(null)}
      >
        {gitInfo && <GitInfoBlock git={gitInfo} projectPath={selectedPath!} />}
        <div className="stage-picker-section">
          <h3 className="stage-picker-section__title">项目阶段</h3>
          <p className="stage-picker-section__hint">选择项目当前所处的开发阶段</p>
          {selectedStage !== null && (
            <StagePicker value={selectedStage} onChange={handleStageChange} />
          )}
        </div>
      </DetailSheet>

      {boardToast && (
        <Toast
          message={boardToast.message}
          variant={boardToast.variant}
          onClose={() => setBoardToast(null)}
        />
      )}
    </div>
  );
}
