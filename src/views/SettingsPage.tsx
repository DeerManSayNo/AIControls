import { useEffect, useState } from "react";
import {
  getDeepseekSettings,
  saveDeepseekSettings,
  testDeepseekConnection,
} from "../api/deepseek";

export default function SettingsPage() {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [configured, setConfigured] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [testHint, setTestHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getDeepseekSettings().then((s) => {
      if (!s) {
        setLoadErr("无法读取设置（请在 AIControls 桌面端运行）。");
        return;
      }
      setConfigured(s.apiKeyConfigured);
      setLoadErr(null);
    });
  }, []);

  async function onSave() {
    setSaveHint(null);
    setBusy(true);
    const ok = await saveDeepseekSettings(apiKeyInput);
    setBusy(false);
    if (!ok) {
      setSaveHint("保存失败：请在桌面端运行并检查写入权限。");
      return;
    }
    setSaveHint("已保存到本机应用数据目录。");
    setConfigured(apiKeyInput.trim().length > 0);
    setApiKeyInput("");
  }

  async function onTest() {
    setTestHint(null);
    setBusy(true);
    const r = await testDeepseekConnection();
    setBusy(false);
    setTestHint(
      r.ok ? `连接成功：${r.message}` : `连接失败：${r.message}`,
    );
  }

  return (
    <div className="card settings-page">
      <h2 style={{ marginTop: 0 }}>设置</h2>

      <section style={{ marginTop: "1.25rem" }}>
        <h3 className="settings-block-title">DeepSeek</h3>
        <p className="muted" style={{ margin: "0 0 1rem" }}>
          在此填写 DeepSeek API Key，保存在本应用本地数据目录（不会上传到 AIControls 服务端）。
          进入 Agent / 项目 /「全部」浏览页并完成扫描后，应用会为尚未写入本地缓存的
          Skill、MCP、Rules 调用 DeepSeek 打上场景分类（开发 / 办公 / 创作等），结果写入磁盘；
          下次扫描会直接读出缓存，仅在出现新条目时再请求模型。
        </p>
        {loadErr ? (
          <p className="muted" style={{ margin: "0 0 0.75rem" }}>
            {loadErr}
          </p>
        ) : null}

        <label
          htmlFor="deepseek-api-key"
          style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.85rem" }}
        >
          API Key
        </label>
        <input
          id="deepseek-api-key"
          type="password"
          autoComplete="off"
          className="settings-input"
          placeholder={
            configured ? "密钥已保存；输入新密钥可覆盖" : "例如 sk-…"
          }
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
        />

        <div
          style={{
            display: "flex",
            gap: "0.55rem",
            flexWrap: "wrap",
            marginTop: "0.85rem",
          }}
        >
          <button
            type="button"
            className="btn-icon"
            disabled={busy}
            onClick={onSave}
          >
            保存
          </button>
          <button
            type="button"
            className="btn-icon"
            disabled={busy}
            onClick={onTest}
          >
            测试连接
          </button>
        </div>

        {saveHint ? (
          <p className="muted" style={{ marginTop: "0.55rem", fontSize: "0.85rem" }}>
            {saveHint}
          </p>
        ) : null}
        {testHint ? (
          <p className="muted" style={{ marginTop: "0.55rem", fontSize: "0.85rem" }}>
            {testHint}
          </p>
        ) : null}
      </section>
    </div>
  );
}
