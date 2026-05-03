import type { ReactNode } from "react";
import { NavLink, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import ShellPage from "./views/ShellPage";
import SkillBrowseShell from "./views/SkillBrowseShell";

function navClass(active: boolean) {
  return `side-nav-link${active ? " active" : ""}`;
}

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="side-nav" aria-label="主导航">
        <div className="side-nav-brand">AIControls</div>
        <NavLink to="/" end className={({ isActive }) => navClass(isActive)}>
          首页
        </NavLink>
        <NavLink to="/assets" className={({ isActive }) => navClass(isActive)}>
          全部 Skills
        </NavLink>

        <div className="side-nav-section-label">Agent</div>
        <NavLink
          to="/agent/cursor"
          className={({ isActive }) => navClass(isActive)}
        >
          Cursor
        </NavLink>
        <NavLink
          to="/agent/claude"
          className={({ isActive }) => navClass(isActive)}
        >
          Claude Code
        </NavLink>

        <div className="side-nav-section-label">全部项目</div>
        <NavLink
          to="/project"
          className={({ isActive }) => navClass(isActive)}
          title="示例"
        >
          示例项目
        </NavLink>
        <NavLink
          to="/projects"
          className={({ isActive }) =>
            `side-nav-link side-nav-action${isActive ? " active" : ""}`
          }
          title="添加/管理项目路径"
        >
          + 添加项目
        </NavLink>

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

function AgentRoute() {
  const { ecosystem } = useParams();
  const eco =
    ecosystem === "claude"
      ? "claude"
      : ecosystem === "cursor"
        ? "cursor"
        : undefined;
  const title =
    ecosystem === "claude"
      ? "Claude Code"
      : ecosystem === "cursor"
        ? "Cursor"
        : `Agent：${ecosystem ?? "—"}`;
  return <SkillBrowseShell title={title} ecosystem={eco} />;
}

function ProjectRoute() {
  const [sp] = useSearchParams();
  const path = sp.get("path");
  return (
    <SkillBrowseShell
      title="示例项目"
      dataSet="project"
      subtitle={path ? `路径：${path}` : undefined}
    />
  );
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ShellPage title="首页" />} />
        <Route path="/assets" element={<SkillBrowseShell title="全部 Skills" />} />
        <Route path="/projects" element={<ShellPage title="项目管理" />} />
        <Route path="/settings" element={<ShellPage title="设置" />} />
        <Route path="/agent/:ecosystem" element={<AgentRoute />} />
        <Route path="/project" element={<ProjectRoute />} />
      </Routes>
    </Layout>
  );
}
