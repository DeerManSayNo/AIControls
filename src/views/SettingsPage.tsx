import { useEffect, useState } from "react";
import { PageRefreshButton } from "../components/PageRefreshButton";
import {
  getDeepseekSettings,
  saveDeepseekSettings,
  testDeepseekConnection,
} from "../api/deepseek";
import {
  getGiteeSettings,
  saveGiteeApp,
  giteeOauthLogin,
  giteeBackupNow,
  giteeDisconnect,
  giteeRestoreFromRepoUrl,
} from "../api/gitee";

export default function SettingsPage() {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [configured, setConfigured] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [testHint, setTestHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsRefreshKey, setSettingsRefreshKey] = useState(0);
  const [settingsReloading, setSettingsReloading] = useState(false);

  const [giteeClientId, setGiteeClientId] = useState("");
  const [giteeSecret, setGiteeSecret] = useState("");
  const [giteeRepo, setGiteeRepo] = useState("");
  const [giteeRepoUrlInput, setGiteeRepoUrlInput] = useState("");
  const [giteePublic, setGiteePublic] = useState<Awaited<
    ReturnType<typeof getGiteeSettings>
  > | null>(null);
  const [giteeHint, setGiteeHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSettingsReloading(true);
    Promise.all([getDeepseekSettings(), getGiteeSettings()])
      .then(([ds, gs]) => {
        if (cancelled) return;
        setSettingsReloading(false);
        if (!ds) {
          setLoadErr("无法读取设置（请在 AIControls 桌面端运行）。");
          return;
        }
        setConfigured(ds.apiKeyConfigured);
        setLoadErr(null);

        setGiteePublic(gs);
        if (gs) {
          setGiteeClientId(gs.clientIdSaved ?? "");
          setGiteeRepo(gs.savedRepoName ?? "");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSettingsReloading(false);
        setLoadErr("无法读取设置（请在 AIControls 桌面端运行）。");
      });
    return () => {
      cancelled = true;
    };
  }, [settingsRefreshKey]);

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

  async function onGiteeSave() {
    setGiteeHint(null);
    setBusy(true);
    const r = await saveGiteeApp(giteeClientId, giteeSecret, giteeRepo);
    setBusy(false);
    setGiteeHint(r.ok ? r.message : r.message);
    if (r.ok) {
      setGiteeSecret("");
      setSettingsRefreshKey((k) => k + 1);
    }
  }

  async function onGiteeAuth() {
    setGiteeHint(null);
    setBusy(true);
    const r = await giteeOauthLogin();
    setBusy(false);
    setGiteeHint(r.ok ? r.message : r.message);
    if (r.ok) {
      setSettingsRefreshKey((k) => k + 1);
    }
  }

  async function onGiteeBackup() {
    setGiteeHint(null);
    setBusy(true);
    const r = await giteeBackupNow();
    setBusy(false);
    setGiteeHint(r.ok ? r.message : r.message);
  }

  async function onGiteeDisconnect() {
    setGiteeHint(null);
    setBusy(true);
    const r = await giteeDisconnect();
    setBusy(false);
    setGiteeHint(r.ok ? r.message : r.message);
    if (r.ok) {
      setSettingsRefreshKey((k) => k + 1);
    }
  }

  async function onGiteeRestore() {
    setGiteeHint(null);
    setBusy(true);
    const r = await giteeRestoreFromRepoUrl(giteeRepoUrlInput);
    setBusy(false);
    setGiteeHint(r.ok ? r.message : r.message);
  }

  return (
    <div className="card settings-page">
      <div className="page-header__title-bar">
        <h2>设置</h2>
        <PageRefreshButton
          onClick={() => setSettingsRefreshKey((k) => k + 1)}
          disabled={busy || settingsReloading}
          spinning={settingsReloading}
          label="重新读取设置"
        />
      </div>

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

      <section style={{ marginTop: "2rem" }}>
        <h3 className="settings-block-title">Gitee 云备份</h3>
        <p className="muted" style={{ margin: "0 0 1rem" }}>
          在{" "}
          <a href="https://gitee.com/oauth/applications" target="_blank" rel="noreferrer">
            Gitee 第三方应用
          </a>{" "}
          创建应用，将下方「回调地址」原样填入应用设置，并勾选与仓库相关的权限（如
          projects）。保存本页的 Client ID 与 Secret 后，点击「在 Gitee
          授权」完成登录；应用会创建或复用指定仓库，并将提示词库与资源库 JSON
          同步到仓库目录{" "}
          <code style={{ fontSize: "0.85em" }}>aicontrols-data/</code>
          。授权成功后会立即备份一次；之后在应用运行期间每 5
          分钟检查一次本地文件，仅在内容有变化时才再次上传。
        </p>

        {giteePublic ? (
          <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
            状态：
            {giteePublic.connected
              ? `已授权（${giteePublic.ownerLogin ?? "?"} / ${giteePublic.repoName ?? "?"})`
              : giteePublic.appConfigured
                ? "已保存应用凭据，尚未授权"
                : "未配置"}
          </p>
        ) : null}

        <label
          htmlFor="gitee-callback"
          style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.85rem" }}
        >
          回调地址（须与 Gitee 应用配置一致）
        </label>
        <input
          id="gitee-callback"
          readOnly
          className="settings-input"
          style={{ marginBottom: "0.85rem" }}
          value={giteePublic?.oauthCallbackUrl ?? "http://127.0.0.1:19876/oauth/gitee/callback"}
          onFocus={(e) => e.currentTarget.select()}
        />

        <label
          htmlFor="gitee-client-id"
          style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.85rem" }}
        >
          Client ID
        </label>
        <input
          id="gitee-client-id"
          className="settings-input"
          autoComplete="off"
          placeholder="OAuth 应用 Client ID"
          value={giteeClientId}
          onChange={(e) => setGiteeClientId(e.target.value)}
        />

        <label
          htmlFor="gitee-secret"
          style={{ display: "block", margin: "0.75rem 0 0.35rem", fontSize: "0.85rem" }}
        >
          Client Secret
        </label>
        <input
          id="gitee-secret"
          type="password"
          className="settings-input"
          autoComplete="off"
          placeholder={
            giteePublic?.appConfigured
              ? "留空则保留已保存的 Secret；修改时请填写新值"
              : "OAuth 应用密钥"
          }
          value={giteeSecret}
          onChange={(e) => setGiteeSecret(e.target.value)}
        />

        <label
          htmlFor="gitee-repo"
          style={{ display: "block", margin: "0.75rem 0 0.35rem", fontSize: "0.85rem" }}
        >
          备份仓库名
        </label>
        <input
          id="gitee-repo"
          className="settings-input"
          autoComplete="off"
          placeholder="默认 aicontrols-backup（仅小写字母、数字、-、_）"
          value={giteeRepo}
          onChange={(e) => setGiteeRepo(e.target.value)}
        />

        <label
          htmlFor="gitee-restore-url"
          style={{ display: "block", margin: "0.75rem 0 0.35rem", fontSize: "0.85rem" }}
        >
          载入仓库地址（恢复）
        </label>
        <input
          id="gitee-restore-url"
          className="settings-input"
          autoComplete="off"
          placeholder="https://gitee.com/<owner>/<repo> 或 .../tree/<branch>/aicontrols-data"
          value={giteeRepoUrlInput}
          onChange={(e) => setGiteeRepoUrlInput(e.target.value)}
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
            onClick={onGiteeSave}
          >
            保存 Gitee 配置
          </button>
          <button
            type="button"
            className="btn-icon"
            disabled={busy || !giteePublic?.appConfigured}
            onClick={onGiteeAuth}
          >
            在 Gitee 授权
          </button>
          <button
            type="button"
            className="btn-icon"
            disabled={busy || !giteePublic?.connected}
            onClick={onGiteeBackup}
          >
            立即备份
          </button>
          <button
            type="button"
            className="btn-icon"
            disabled={busy || !giteePublic?.connected}
            onClick={onGiteeDisconnect}
          >
            解除授权
          </button>
          <button
            type="button"
            className="btn-icon"
            disabled={busy || !giteePublic?.connected || giteeRepoUrlInput.trim().length === 0}
            onClick={onGiteeRestore}
          >
            从仓库载入
          </button>
        </div>

        {giteeHint ? (
          <p className="muted" style={{ marginTop: "0.55rem", fontSize: "0.85rem" }}>
            {giteeHint}
          </p>
        ) : null}
      </section>
    </div>
  );
}
