type Props = {
  title: string;
  subtitle?: string;
};

export default function ShellPage({ title, subtitle }: Props) {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {subtitle ? (
        <p className="muted" style={{ marginTop: "0.25rem" }}>
          {subtitle}
        </p>
      ) : null}
      <p className="muted" style={{ marginTop: "0.75rem" }}>
        本应用已精简为界面壳层，扫描、配置与 AI 等业务逻辑已移除。
      </p>
    </div>
  );
}
