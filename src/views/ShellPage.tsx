import { NavLink } from "react-router-dom";

type Props = {
  title: string;
  subtitle?: string;
};

export default function ShellPage({ title, subtitle }: Props) {
  return (
    <div className="home-landing">
      <header className="home-hero">
        <div>
          <h1 className="home-hello">{title}</h1>
          {subtitle ? (
            <p className="home-lead" style={{ marginTop: "0.5rem" }}>
              {subtitle}
            </p>
          ) : (
            <p className="home-lead">
              在单一工作台中浏览各 AI Agent 的 Skills、MCP 与 Rules，统一检索、分类与打开本地文件。
            </p>
          )}
        </div>
      </header>

      <section aria-label="快捷入口">
        <h2 className="settings-section-title">开始</h2>
        <div className="home-quick-grid">
          <NavLink className="home-quick-card" to="/assets">
            <span className="home-quick-card__label">全部资产</span>
            <p className="home-quick-card__hint">
              汇总所有已识别 Agent 的全局配置与侧栏项目扫描结果。
            </p>
            <span className="home-quick-card__arrow">浏览 →</span>
          </NavLink>
          <NavLink className="home-quick-card" to="/settings">
            <span className="home-quick-card__label">设置</span>
            <p className="home-quick-card__hint">
              配置 DeepSeek API，用于为条目自动补全场景分类标签。
            </p>
            <span className="home-quick-card__arrow">前往 →</span>
          </NavLink>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 0 }}>
        <h2 style={{ marginTop: 0, marginBottom: "0.65rem" }}>关于此版本</h2>
        <p className="muted" style={{ margin: 0 }}>
          本应用已精简为界面壳层，扫描、配置与 AI 等业务逻辑已移除。
        </p>
      </section>
    </div>
  );
}
