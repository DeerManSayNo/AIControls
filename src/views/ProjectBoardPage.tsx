import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useId, useRef } from "react";
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
import { openProjectPath } from "../api/openProject";
import { revealPathInFolder } from "../api/reveal";
import {
  getOpenAppForProject,
  setOpenAppForProject,
  useProjectOpenAppsMap,
} from "../projectOpenAppStorage";

type ActivityLevel = "high" | "very-high" | "medium" | "low";

function commitsToActivity(count: number): ActivityLevel {
  if (count >= 40) return "very-high";
  if (count >= 11) return "high";
  if (count >= 1) return "medium";
  return "low";
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const BOARD_METRIC_TIMEOUT_MS = 20_000;

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

async function pickApplicationForProject(projectPath: string): Promise<void> {
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
}

function CardContextMenu({
  anchor,
  onClose,
  onOpenDetail,
  onPull,
}: {
  anchor: { x: number; y: number; path: string };
  onClose: () => void;
  onOpenDetail: () => void;
  onPull: () => void;
}) {
  useProjectOpenAppsMap();
  const customApp = getOpenAppForProject(anchor.path);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
          onClick={() => {
            onClose();
            onOpenDetail();
          }}
        >
          打开卡片详情
        </button>
      </li>
      <li>
        <button
          type="button"
          className="card-context-menu__item"
          onClick={() => {
            onClose();
            void pickApplicationForProject(anchor.path);
          }}
        >
          选择默认打开应用…
        </button>
      </li>
      <li>
        <button
          type="button"
          className="card-context-menu__item"
          onClick={() => {
            void revealPathInFolder(anchor.path, { alertOnError: true });
            onClose();
          }}
        >
          打开所在目录
        </button>
      </li>
      <li>
        <button
          type="button"
          className="card-context-menu__item"
          onClick={() => {
            onPull();
            onClose();
          }}
        >
          拉取最新代码
        </button>
      </li>
    </ul>
  );
}

type BoardToastVariant = "error" | "success" | "info";

type BoardLiveStatus = {
  state: "idle" | "scanning" | "syncing" | "done" | "error";
  message: string;
  detail?: string;
  completed: number;
  total: number;
  updatedAt: number | null;
};

const idleLiveStatus: BoardLiveStatus = {
  state: "idle",
  message: "等待刷新",
  completed: 0,
  total: 0,
  updatedAt: null,
};

function BoardLiveProgress({ status }: { status: BoardLiveStatus }) {
  const progress =
    status.total > 0
      ? Math.min(100, Math.round((status.completed / status.total) * 100))
      : status.state === "done"
        ? 100
        : 0;
  const updatedAt = status.updatedAt
    ? new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(status.updatedAt)
    : "未开始";

  return (
    <div
      className={`board-live-progress board-live-progress--${status.state}`}
      role="status"
      aria-live="polite"
      aria-label={`实时进展：${status.message}`}
    >
      <span className="board-live-progress__pulse" aria-hidden />
      <span className="board-live-progress__body">
        <strong>{status.message}</strong>
        {status.detail ? <em>{status.detail}</em> : null}
      </span>
      <span className="board-live-progress__meta">
        {status.total > 0 ? `${status.completed}/${status.total}` : updatedAt}
      </span>
      <span className="board-live-progress__bar" aria-hidden>
        <span style={{ width: `${progress}%` }} />
      </span>
    </div>
  );
}

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
  const triggerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ left: 0, top: 0 });

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const syncMenuPosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const maxW = 280;
    let left = r.left - 8;
    left = Math.min(left, window.innerWidth - maxW - 8);
    left = Math.max(8, left);
    setMenuPos({ left, top: r.bottom + 6 });
  }, []);

  const openMenu = useCallback(() => {
    clearHideTimer();
    syncMenuPosition();
    setMenuOpen(true);
  }, [clearHideTimer, syncMenuPosition]);

  const scheduleCloseMenu = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setMenuOpen(false), 100);
  }, [clearHideTimer]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    syncMenuPosition();
  }, [menuOpen, syncMenuPosition]);

  useEffect(() => {
    if (!menuOpen) return;
    const onScrollOrResize = () => syncMenuPosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [menuOpen, syncMenuPosition]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (count === 0 || !contributors || contributors.length === 0) {
    return (
      <div className="project-card__members">
        <span>{count > 0 ? `${count} 位成员` : "无成员信息"}</span>
      </div>
    );
  }
  return (
    <>
      <div
        ref={triggerRef}
        className="project-card__members project-card__members--hoverable"
        tabIndex={0}
        aria-expanded={menuOpen}
        aria-haspopup="true"
        onMouseEnter={openMenu}
        onMouseLeave={scheduleCloseMenu}
        onFocus={openMenu}
        onBlur={() => {
          requestAnimationFrame(() => {
            const ae = document.activeElement;
            if (triggerRef.current?.contains(ae) || popupRef.current?.contains(ae)) return;
            setMenuOpen(false);
          });
        }}
      >
        <div className="project-card__avatar-stack" aria-hidden>
          {Array.from({ length: Math.min(count, 3) }, (_, index) => (
            <span key={index} className={`project-card__avatar project-card__avatar--${index + 1}`} />
          ))}
        </div>
        <span>{count} 位成员</span>
      </div>
      {menuOpen &&
        createPortal(
          <div
            ref={popupRef}
            className="project-card__members-popup project-card__members-popup--portal"
            style={{ left: menuPos.left, top: menuPos.top }}
            onMouseEnter={clearHideTimer}
            onMouseLeave={scheduleCloseMenu}
          >
            <ul>
              {contributors.map((c) => (
                <li key={c.email || c.name}>
                  <strong>{c.name}</strong>
                  {c.commits > 0 && <em>{c.commits} 次提交</em>}
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
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
  const openProjectWithSavedApp = () => {
    const customApp = getOpenAppForProject(project.path);
    void openProjectPath(project.path, {
      applicationPath: customApp ?? null,
      alertOnError: true,
    });
  };

  return (
    <>
      <article
        className={`project-card project-card--${project.stage} project-card--clickable`}
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
          <button
            type="button"
            className="project-card__name-open"
            title="用默认应用打开项目"
            onClick={(e) => {
              e.stopPropagation();
              openProjectWithSavedApp();
            }}
          >
            <h3>{project.name}</h3>
          </button>
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
        onOpenDetail={onClick}
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
  const [liveStatus, setLiveStatus] = useState<BoardLiveStatus>(idleLiveStatus);
  const [boardToast, setBoardToast] = useState<{
    message: string;
    variant: BoardToastVariant;
  } | null>(null);

  const handlePull = useCallback(async (projectPath: string) => {
    const projectName = folderBasename(projectPath);
    setPullingPaths((prev) => new Set(prev).add(projectPath));
    setLiveStatus({
      state: "syncing",
      message: "正在检查本地修改",
      detail: projectName,
      completed: 0,
      total: 2,
      updatedAt: Date.now(),
    });
    try {
      const status = await gitCheckLocalChanges(projectPath);
      if (status?.has_changes) {
        const ok = window.confirm(
          `检测到本地有修改（${status.details}），拉取最新代码可能会导致冲突。\n\n是否继续拉取？`,
        );
        if (!ok) {
          setPullingPaths((prev) => { const n = new Set(prev); n.delete(projectPath); return n; });
          setLiveStatus({
            state: "idle",
            message: "已取消拉取",
            detail: projectName,
            completed: 0,
            total: 0,
            updatedAt: Date.now(),
          });
          return;
        }
      }
      setLiveStatus({
        state: "syncing",
        message: "正在拉取最新代码",
        detail: projectName,
        completed: 1,
        total: 2,
        updatedAt: Date.now(),
      });
      const output = await gitPull(projectPath);
      const { message, variant } = messageFromPullOutput(output);
      setBoardToast({ message, variant });
      setLiveStatus({
        state: "done",
        message,
        detail: projectName,
        completed: 2,
        total: 2,
        updatedAt: Date.now(),
      });
      setRefreshEpoch((n) => n + 1);
    } catch (e) {
      setBoardToast({
        message: typeof e === "string" ? e : "拉取失败",
        variant: "error",
      });
      setLiveStatus({
        state: "error",
        message: "拉取失败",
        detail: projectName,
        completed: 0,
        total: 0,
        updatedAt: Date.now(),
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
    if (projectPaths.length === 0) {
      setLiveStatus({
        state: "idle",
        message: "暂无项目",
        completed: 0,
        total: 0,
        updatedAt: Date.now(),
      });
      return;
    }

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
      setLiveStatus({
        state: "done",
        message: "已载入缓存",
        detail: `${projectPaths.length} 个项目`,
        completed: projectPaths.length,
        total: projectPaths.length,
        updatedAt: boardCache.timestamp,
      });
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
    const totalTasks = totalPaths * 6 + mvpPaths.length;
    let pending = totalTasks;
    let completed = 0;
    const timeoutIds: number[] = [];

    const updateLiveStatus = (
      state: BoardLiveStatus["state"],
      message: string,
      path?: string,
    ) => {
      if (cancelled) return;
      setLiveStatus({
        state,
        message,
        detail: path ? folderBasename(path) : `${totalPaths} 个项目`,
        completed,
        total: totalTasks,
        updatedAt: Date.now(),
      });
    };

    const finishTask = (path: string, label: string) => {
      completed += 1;
      pending -= 1;
      updateLiveStatus("scanning", `已完成${label}`, path);
      commit();
    };

    updateLiveStatus("scanning", "准备扫描项目指标");

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
        setLiveStatus({
          state: "done",
          message: "看板已更新",
          detail: `${totalPaths} 个项目`,
          completed: totalTasks,
          total: totalTasks,
          updatedAt: snapshot.timestamp,
        });
      }
    };

    const runMetric = <T,>({
      path,
      startMessage,
      doneLabel,
      task,
      onResult,
      timeoutMs = BOARD_METRIC_TIMEOUT_MS,
    }: {
      path: string;
      startMessage: string;
      doneLabel: string;
      task: () => Promise<T>;
      onResult: (result: T) => void;
      timeoutMs?: number;
    }) => {
      let settled = false;
      updateLiveStatus("scanning", startMessage, path);
      const timeoutId = window.setTimeout(() => {
        if (settled || cancelled) return;
        settled = true;
        finishTask(path, `${doneLabel}（超时跳过）`);
      }, timeoutMs);
      timeoutIds.push(timeoutId);

      void task()
        .then((result) => {
          if (settled || cancelled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          onResult(result);
          finishTask(path, doneLabel);
        })
        .catch(() => {
          if (settled || cancelled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          finishTask(path, `${doneLabel}（失败跳过）`);
        });
    };

    for (const path of projectPaths) {
      runMetric({
        path,
        startMessage: "正在读取代码行数",
        doneLabel: "代码行数",
        task: () => countProjectCodeLines(path),
        onResult: (result) => {
          if (result) codeResults.set(path, result);
        },
      });
      runMetric({
        path,
        startMessage: "正在读取版本信息",
        doneLabel: "版本信息",
        task: () => readPackageVersion(path),
        onResult: (version) => {
          if (version) versionResults.set(path, version);
        },
      });
      runMetric({
        path,
        startMessage: "正在统计近 30 天提交",
        doneLabel: "活跃度",
        task: () => gitCommitCountLastNDays(path, 30),
        onResult: (count) => {
          activityResults.set(path, commitsToActivity(count));
        },
      });
      runMetric({
        path,
        startMessage: "正在生成活跃曲线",
        doneLabel: "活跃曲线",
        task: () => gitWeeklyCommitCounts(path),
        onResult: (counts) => {
          sparklineResults.set(path, counts);
        },
      });
      runMetric({
        path,
        startMessage: "正在读取成员贡献",
        doneLabel: "成员贡献",
        task: () => gitContributors(path),
        onResult: (list) => {
          if (list.length > 0) membersResults.set(path, list);
        },
      });
      runMetric({
        path,
        startMessage: "正在检查最新提交",
        doneLabel: "最新提交",
        task: () => detectProjectGitInfo(path),
        onResult: (info) => {
          if (info?.last_commit_date) updatedResults.set(path, info.last_commit_date);
        },
      });
    }

    for (const path of mvpPaths) {
      runMetric({
        path,
        startMessage: "正在估算 MVP 进度",
        doneLabel: "MVP 进度",
        task: () => estimateProjectProgress(path),
        onResult: (result) => {
          if (result) progressResults.set(path, result.progress);
        },
      });
    }

    return () => {
      cancelled = true;
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
    };
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
        <div className="project-board__header-actions">
          {(liveStatus.state === "scanning" || liveStatus.state === "syncing") && (
            <BoardLiveProgress status={liveStatus} />
          )}
          <PageRefreshButton
            onClick={() => setRefreshEpoch((n) => n + 1)}
            spinning={boardLoading}
            label="重新加载项目看板"
          />
        </div>
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
        meta={
          selectedPath ? (
            <button
              type="button"
              className="detail-sheet-open-folder"
              onClick={() => {
                void revealPathInFolder(selectedPath, { alertOnError: true });
              }}
            >
              打开所在目录
            </button>
          ) : null
        }
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
