import type { MouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  NavLink,
  Route,
  Routes,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import AddProjectNavButton from "./components/AddProjectNavButton";
import BrandLogo from "./components/BrandLogo";
import AgentNavLinks from "./components/AgentNavLinks";
import ProjectNavItem from "./components/ProjectNavItem";
import {
  NavIconHome,
  NavIconLayers,
  NavIconFolder,
  NavIconPrompt,
  NavIconSettings,
} from "./components/navIcons";
import {
  appendProjectPath,
  pathsReferToSameDir,
  useProjectPaths,
} from "./projectPathsStorage";
import ShellPage from "./views/ShellPage";
import SettingsPage from "./views/SettingsPage";
import SkillBrowseShell from "./views/SkillBrowseShell";
import PromptLibraryPage from "./views/PromptLibraryPage";
import ResourceLibraryPage from "./views/ResourceLibraryPage";

function navClass(active: boolean) {
  return `side-nav-link${active ? " active" : ""}`;
}

function folderBasename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "项目";
}

function readBoolFromLocalStorage(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    if (v === "1") return true;
    if (v === "0") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function Layout({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const pathFromUrl = searchParams.get("path");
  const projectPaths = useProjectPaths();
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [agentsCollapsed, setAgentsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return readBoolFromLocalStorage("aicontrols-nav-collapse-agents", false);
  });
  const [projectsCollapsed, setProjectsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return readBoolFromLocalStorage("aicontrols-nav-collapse-projects", false);
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedTheme = window.localStorage.getItem("aicontrols-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
      return;
    }
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(prefersDark ? "dark" : "light");
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("aicontrols-theme", theme);

    // Sync native Tauri title bar appearance with the web theme.
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme))
      .catch((err) => {
        // Running in browser/dev preview without Tauri window API or missing permission.
        console.warn("[theme] failed to sync native window theme", err);
      });
  }, [theme]);

  useEffect(() => {
    if (pathFromUrl) {
      appendProjectPath(pathFromUrl);
    }
  }, [pathFromUrl]);

  const activeProjectPath =
    pathname === "/project" ? searchParams.get("path") : null;

  function onThemeToggleClick(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }

  return (
    <div className="app-shell">
      <aside className="side-nav" aria-label="主导航">
        <div className="side-nav__primary">
          <div className="side-nav-brand">
            <div className="side-nav-brand__mark" aria-hidden>
              <BrandLogo />
            </div>
            <div className="side-nav-brand__text">
              <span className="side-nav-brand__name">AIControls</span>
              <span className="side-nav-brand__tag">控制台</span>
            </div>
          </div>
          <NavLink to="/" end className={({ isActive }) => navClass(isActive)}>
            <span className="side-nav-link__icon">
              <NavIconHome />
            </span>
            <span className="side-nav-link__label side-nav-link__label--cjk-optical">
              首页
            </span>
          </NavLink>
          <NavLink to="/assets" className={({ isActive }) => navClass(isActive)}>
            <span className="side-nav-link__icon">
              <NavIconLayers />
            </span>
            <span className="side-nav-link__label side-nav-link__label--cjk-optical">
              全部
            </span>
          </NavLink>
          <NavLink to="/prompts" className={({ isActive }) => navClass(isActive)}>
            <span className="side-nav-link__icon">
              <NavIconPrompt />
            </span>
            <span className="side-nav-link__label side-nav-link__label--cjk-optical">
              Prompt 库
            </span>
          </NavLink>
          <NavLink
            to="/resources"
            className={({ isActive }) => navClass(isActive)}
          >
            <span className="side-nav-link__icon">
              <NavIconFolder />
            </span>
            <span className="side-nav-link__label side-nav-link__label--cjk-optical">
              资源库
            </span>
          </NavLink>

          <button
            type="button"
            className="side-nav-section-toggle"
            aria-expanded={!agentsCollapsed}
            aria-controls="side-nav-agents"
            onClick={() => {
              setAgentsCollapsed((prev) => {
                const next = !prev;
                try {
                  window.localStorage.setItem(
                    "aicontrols-nav-collapse-agents",
                    next ? "1" : "0",
                  );
                } catch {
                  // ignore
                }
                return next;
              });
            }}
          >
            <span>Agent</span>
            <span className="side-nav-section-toggle__chevron" aria-hidden>
              ▾
            </span>
          </button>
          <div id="side-nav-agents" hidden={agentsCollapsed}>
            <AgentNavLinks />
          </div>
        </div>

        <div
          className={`side-nav__projects-scroll${projectsCollapsed ? " side-nav__projects-scroll--collapsed" : ""}`}
          aria-label="项目列表"
        >
          <button
            type="button"
            className="side-nav-section-toggle"
            aria-expanded={!projectsCollapsed}
            aria-controls="side-nav-projects"
            onClick={() => {
              setProjectsCollapsed((prev) => {
                const next = !prev;
                try {
                  window.localStorage.setItem(
                    "aicontrols-nav-collapse-projects",
                    next ? "1" : "0",
                  );
                } catch {
                  // ignore
                }
                return next;
              });
            }}
          >
            <span>全部项目</span>
            <span className="side-nav-section-toggle__chevron" aria-hidden>
              ▾
            </span>
          </button>
          <div id="side-nav-projects" hidden={projectsCollapsed}>
            {projectPaths.map((p) => {
              const isCurrent =
                activeProjectPath !== null &&
                pathsReferToSameDir(activeProjectPath, p);
              return (
                <ProjectNavItem key={p} projectPath={p} isCurrent={isCurrent} />
              );
            })}
            <AddProjectNavButton />
          </div>
        </div>

        <div className="side-nav-footer">
          <NavLink
            to="/settings"
            className={({ isActive }) => navClass(isActive)}
            title="设置"
          >
            <span className="side-nav-link__icon">
              <NavIconSettings />
            </span>
            <span className="side-nav-link__label side-nav-link__label--cjk-optical">
              设置
            </span>
            <button
              type="button"
              className="side-nav-theme-toggle"
              aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
              title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
              onClick={onThemeToggleClick}
            >
              <span className="side-nav-theme-toggle__sun">
                <svg viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="2.4" />
                  <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3" />
                </svg>
              </span>
              <span className="side-nav-theme-toggle__thumb">
                <svg
                  className="side-nav-theme-toggle__thumb-sun"
                  viewBox="0 0 16 16"
                  fill="none"
                >
                  <circle cx="8" cy="8" r="2.5" />
                  <path d="M8 1.8v1.5M8 12.7v1.5M1.8 8h1.5M12.7 8h1.5M3.7 3.7l1 1M11.3 11.3l1 1M12.3 3.7l-1 1M4.7 11.3l-1 1" />
                </svg>
                <svg
                  className="side-nav-theme-toggle__thumb-moon"
                  viewBox="0 0 16 16"
                  fill="none"
                >
                  <path d="M10.7 2.4A5.6 5.6 0 1 0 13.4 13a4.8 4.8 0 0 1-2.7-10.6Z" />
                </svg>
              </span>
              <span className="side-nav-theme-toggle__moon">
                <svg viewBox="0 0 16 16" fill="none">
                  <path d="M10.9 2.3a5.8 5.8 0 1 0 2.8 10.9A5 5 0 0 1 10.9 2.3Z" />
                </svg>
              </span>
            </button>
          </NavLink>
        </div>
      </aside>
      <div className="main-wrap">
        <main>{children}</main>
      </div>
    </div>
  );
}

const AGENT_TITLES: Record<string, string> = {
  cursor: "Cursor",
  claude: "Claude Code",
  trae: "Trae",
  qoder: "Qoder",
  kiro: "Kiro",
};

function AgentRoute() {
  const { ecosystem } = useParams();
  const eco = ecosystem && AGENT_TITLES[ecosystem] ? ecosystem : undefined;
  const title =
    ecosystem && AGENT_TITLES[ecosystem]
      ? AGENT_TITLES[ecosystem]
      : `Agent：${ecosystem ?? "—"}`;
  return <SkillBrowseShell title={title} ecosystem={eco} />;
}

function ProjectRoute() {
  const [sp] = useSearchParams();
  const path = sp.get("path");
  const folderTitle =
    path != null && path.length > 0 ? folderBasename(path) : "项目";

  return (
    <SkillBrowseShell
      title={folderTitle}
      dataSet="project"
      projectRoot={path ?? undefined}
      subtitle={
        path ? `路径：${path}` : "请点击侧栏「添加项目」选择本地文件夹。"
      }
    />
  );
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ShellPage title="首页" />} />
        <Route
          path="/assets"
          element={<SkillBrowseShell title="全部" dataSet="aggregate" />}
        />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/prompts" element={<PromptLibraryPage />} />
        <Route path="/resources" element={<ResourceLibraryPage />} />
        <Route path="/agent/:ecosystem" element={<AgentRoute />} />
        <Route path="/project" element={<ProjectRoute />} />
      </Routes>
    </Layout>
  );
}
