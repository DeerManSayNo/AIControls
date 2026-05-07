import { useMemo, useState, useId } from "react";
import { PageRefreshButton } from "../components/PageRefreshButton";
import { DetailSheet } from "../components/DetailSheet";
import { useProjectPaths } from "../projectPathsStorage";
import {
  type StageKey,
  getStageForProject,
  setStageForProject,
  useProjectStagesMap,
} from "../projectStageStorage";

type ActivityLevel = "high" | "very-high" | "medium" | "low";

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

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden>
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </svg>
  );
}

function MemberAvatars({ count }: { count: number }) {
  return (
    <div className="project-card__members">
      <div className="project-card__avatar-stack" aria-hidden>
        {Array.from({ length: Math.min(count, 3) }, (_, index) => (
          <span key={index} className={`project-card__avatar project-card__avatar--${index + 1}`} />
        ))}
      </div>
      <span>{count} 位成员</span>
    </div>
  );
}

function ProjectCard({
  project,
  onClick,
}: {
  project: BoardProject;
  onClick: () => void;
}) {
  const cfg = stageConfig[project.stage];
  return (
    <article
      className={`project-card project-card--${project.stage} project-card--clickable`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
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

      <footer className="project-card__foot">
        <MemberAvatars count={project.members} />
        <span>{project.updated}</span>
      </footer>
    </article>
  );
}

function StageSection({
  stage,
  projects: projectList,
  onProjectClick,
}: {
  stage: StageKey;
  projects: BoardProject[];
  onProjectClick: (path: string) => void;
}) {
  const cfg = stageConfig[stage];
  return (
    <section className="project-stage">
      <header className="project-stage__head">
        <div className="project-stage__title">
          <span className={`project-stage__dot project-stage__dot--${cfg.tone}`} />
          <h2>{cfg.title}</h2>
        </div>
        <span className="project-stage__all">
          {projectList.length} 个项目
        </span>
      </header>
      <div className="project-stage__row">
        {projectList.map((project) => (
          <ProjectCard
            key={project.path}
            project={project}
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

export default function ProjectBoardPage() {
  const searchId = useId();
  const projectPaths = useProjectPaths();
  const stagesMap = useProjectStagesMap();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const projects = useMemo<BoardProject[]>(() => {
    return projectPaths.map((path) => {
      let stage: StageKey = "mvp";
      for (const [k, v] of stagesMap) {
        if (k === path) { stage = v; break; }
      }
      return {
        path,
        name: folderBasename(path),
        description: "项目开发中",
        stage,
        progress: stage === "mvp" ? 42 : undefined,
        version: stage !== "mvp" ? "v1.0.0" : undefined,
        codeLines: "—",
        activity: "medium" as ActivityLevel,
        members: 1,
        updated: "最近更新",
        sparkline: [30, 40, 35, 50, 45, 55, 38, 42, 48, 36, 44, 52],
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPaths, stagesMap, refreshKey]);

  const grouped = useMemo(() => {
    const mvp = projects.filter((p) => p.stage === "mvp");
    const rapid = projects.filter((p) => p.stage === "rapid");
    const stable = projects.filter((p) => p.stage === "stable");
    return { mvp, rapid, stable };
  }, [projects]);

  const totalCount = projects.length;
  const selectedStage = selectedPath ? getStageForProject(selectedPath) : null;
  const selectedName = selectedPath ? folderBasename(selectedPath) : null;

  const handleStageChange = (stage: StageKey) => {
    if (!selectedPath) return;
    setStageForProject(selectedPath, stage);
    setSelectedPath(null);
  };

  const emptyState = totalCount === 0;

  return (
    <div className="project-board">
      <header className="project-board__header">
        <div>
          <h1>项目看板</h1>
          <p>全局视角，掌握所有项目的进展与健康状态</p>
        </div>
        <PageRefreshButton
          onClick={() => setRefreshKey((k) => k + 1)}
          label="重新加载项目看板"
        />
      </header>

      <div className="project-board__actions">
        <label className="project-board-search" htmlFor={searchId}>
          <SearchIcon />
          <input id={searchId} type="search" placeholder="搜索项目..." />
        </label>
        <button type="button" className="project-board-filter">
          <FilterIcon />
          <span>筛选</span>
        </button>
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
                <strong>— <em>行</em></strong>
              </div>
              <div className="project-summary__metric project-summary__metric--activity">
                <span>平均活跃度</span>
                <div>
                  <Sparkline values={[22, 35, 61, 42, 37, 51, 39, 72, 58, 34]} tone="overview" />
                  <strong>中等</strong>
                </div>
              </div>
              <div className="project-summary__metric">
                <span>本周更新</span>
                <strong>— <em>次</em></strong>
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

          <StageSection stage="mvp" projects={grouped.mvp} onProjectClick={setSelectedPath} />
          <StageSection stage="rapid" projects={grouped.rapid} onProjectClick={setSelectedPath} />
          <StageSection stage="stable" projects={grouped.stable} onProjectClick={setSelectedPath} />
        </>
      )}

      <DetailSheet
        open={selectedPath !== null}
        title={selectedName ?? ""}
        description={selectedPath ?? ""}
        onClose={() => setSelectedPath(null)}
      >
        <div className="stage-picker-section">
          <h3 className="stage-picker-section__title">项目阶段</h3>
          <p className="stage-picker-section__hint">选择项目当前所处的开发阶段</p>
          {selectedStage !== null && (
            <StagePicker value={selectedStage} onChange={handleStageChange} />
          )}
        </div>
      </DetailSheet>
    </div>
  );
}
