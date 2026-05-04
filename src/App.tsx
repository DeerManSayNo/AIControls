import type { ReactNode } from "react";
import { useEffect } from "react";
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

function Layout({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const pathFromUrl = searchParams.get("path");
  const projectPaths = useProjectPaths();

  useEffect(() => {
    if (pathFromUrl) {
      appendProjectPath(pathFromUrl);
    }
  }, [pathFromUrl]);

  const activeProjectPath =
    pathname === "/project" ? searchParams.get("path") : null;

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

          <div className="side-nav-section-label">Agent</div>
          <AgentNavLinks />
        </div>

        <div
          className="side-nav__projects-scroll"
          aria-label="项目列表"
        >
          <div className="side-nav-section-label">全部项目</div>
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
