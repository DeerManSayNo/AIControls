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
import AgentNavLinks from "./components/AgentNavLinks";
import {
  appendProjectPath,
  pathsReferToSameDir,
  useProjectPaths,
} from "./projectPathsStorage";
import ShellPage from "./views/ShellPage";
import SkillBrowseShell from "./views/SkillBrowseShell";

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
        <div className="side-nav-brand">AIControls</div>
        <NavLink to="/" end className={({ isActive }) => navClass(isActive)}>
          首页
        </NavLink>
        <NavLink to="/assets" className={({ isActive }) => navClass(isActive)}>
          全部
        </NavLink>

        <div className="side-nav-section-label">Agent</div>
        <AgentNavLinks />

        <div className="side-nav-section-label">全部项目</div>
        {projectPaths.map((p) => {
          const to = `/project?path=${encodeURIComponent(p)}`;
          const isCurrent =
            activeProjectPath !== null &&
            pathsReferToSameDir(activeProjectPath, p);
          return (
            <NavLink
              key={p}
              to={to}
              className={() => navClass(isCurrent)}
              title={p}
            >
              {folderBasename(p)}
            </NavLink>
          );
        })}
        <AddProjectNavButton />

        <div className="side-nav-footer">
          <NavLink
            to="/settings"
            className={({ isActive }) => navClass(isActive)}
            title="设置"
          >
            设置
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
        <Route path="/settings" element={<ShellPage title="设置" />} />
        <Route path="/agent/:ecosystem" element={<AgentRoute />} />
        <Route path="/project" element={<ProjectRoute />} />
      </Routes>
    </Layout>
  );
}
