import { useEffect, useState } from "react";
import { PageRefreshButton } from "../components/PageRefreshButton";
import { useI18n } from "../i18n/provider";
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

function InfoTooltip({ label, content }: { label: string; content: string }) {
  return (
    <span className="settings-info" aria-label={label}>
      <span className="settings-info__icon" aria-hidden="true">
        i
      </span>
      <span className="settings-info__tip" role="tooltip">
        {content}
      </span>
    </span>
  );
}

export default function SettingsPage() {
  const { t, locale, preference, setPreference } = useI18n();
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
        <h2>{t("settings.title")}</h2>
        <PageRefreshButton
          onClick={() => setSettingsRefreshKey((k) => k + 1)}
          disabled={busy || settingsReloading}
          spinning={settingsReloading}
          label={t("settings.reload")}
        />
      </div>

      <section style={{ marginTop: "1.25rem" }}>
        <div className="settings-block-head">
          <h3 className="settings-block-title">{t("settings.lang")}</h3>
        </div>
        <div className="seg" role="tablist" aria-label={t("settings.lang")}>
          <button
            type="button"
            role="tab"
            aria-selected={preference === "system"}
            className={`seg__item${preference === "system" ? " active" : ""}`}
            onClick={() => setPreference("system")}
          >
            {t("settings.lang.follow")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={preference === "zh"}
            className={`seg__item${preference === "zh" ? " active" : ""}`}
            onClick={() => setPreference("zh")}
          >
            {t("settings.lang.zh")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={preference === "en"}
            className={`seg__item${preference === "en" ? " active" : ""}`}
            onClick={() => setPreference("en")}
          >
            {t("settings.lang.en")}
          </button>
        </div>
      </section>

      <section style={{ marginTop: "1.25rem" }}>
        <div className="settings-block-head">
          <h3 className="settings-block-title">DeepSeek</h3>
          <InfoTooltip
            label={locale === "zh" ? "DeepSeek 说明" : "About DeepSeek"}
            content={
              locale === "zh"
                ? "填写 DeepSeek API Key。密钥仅保存在本机，不上传到 AIControls 服务端。扫描 Agent / 项目 / 全部时，应用会为未缓存的 Skill、MCP、Rules 生成场景分类并写入本地；后续优先读取缓存，仅在有新条目时再请求模型。"
                : "Enter DeepSeek API key. The key is stored locally only. When scanning agents/projects/assets, uncached Skill/MCP/Rule entries are classified and cached locally."
            }
          />
        </div>
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
            configured
              ? locale === "zh"
                ? "密钥已保存；输入新密钥可覆盖"
                : "Key saved; enter a new key to replace"
              : locale === "zh"
                ? "例如 sk-…"
                : "e.g. sk-…"
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
            {locale === "zh" ? "保存" : "Save"}
          </button>
          <button
            type="button"
            className="btn-icon"
            disabled={busy}
            onClick={onTest}
          >
            {locale === "zh" ? "测试连接" : "Test connection"}
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
        <div className="settings-block-head">
          <h3 className="settings-block-title">{locale === "zh" ? "Gitee 云备份" : "Gitee Cloud Backup"}</h3>
          <InfoTooltip
            label={locale === "zh" ? "Gitee 云备份说明" : "About Gitee backup"}
            content={
              locale === "zh"
                ? "先在 Gitee 第三方应用页面创建应用，把下方回调地址原样填入并勾选仓库相关权限（如 projects）。保存 Client ID 与 Secret 后，点击在 Gitee 授权完成登录。应用会创建或复用指定仓库，并将提示词库与资源库 JSON 同步到 aicontrols-data/。授权后会立即备份一次；运行期间每 5 分钟检查本地文件，仅在变更时上传。"
                : "Create a Gitee OAuth app, use the callback URL below, then save Client ID/Secret and authorize. The app syncs prompt/resource JSON into repository folder aicontrols-data/."
            }
          />
        </div>
        <p className="muted" style={{ margin: "0 0 1rem" }}>
          {locale === "zh" ? "在" : "Create and authorize in "}
          <a href="https://gitee.com/oauth/applications" target="_blank" rel="noreferrer">
            {locale === "zh" ? "Gitee 第三方应用" : "Gitee OAuth Applications"}
          </a>{" "}
          {locale === "zh"
            ? "创建应用并完成授权后即可自动备份。"
            : "to enable automatic backup."}
        </p>

        {giteePublic ? (
          <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
            {locale === "zh" ? "状态：" : "Status: "}
            {giteePublic.connected
              ? locale === "zh"
                ? `已授权（${giteePublic.ownerLogin ?? "?"} / ${giteePublic.repoName ?? "?"})`
                : `Authorized (${giteePublic.ownerLogin ?? "?"} / ${giteePublic.repoName ?? "?"})`
              : giteePublic.appConfigured
                ? locale === "zh"
                  ? "已保存应用凭据，尚未授权"
                  : "App credentials saved, not authorized"
                : locale === "zh"
                  ? "未配置"
                  : "Not configured"}
          </p>
        ) : null}

        <label
          htmlFor="gitee-callback"
          style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.85rem" }}
        >
          {locale === "zh"
            ? "回调地址（须与 Gitee 应用配置一致）"
            : "Callback URL (must match Gitee app config)"}
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
          placeholder={locale === "zh" ? "OAuth 应用 Client ID" : "OAuth Client ID"}
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
              ? locale === "zh"
                ? "留空则保留已保存的 Secret；修改时请填写新值"
                : "Leave empty to keep existing secret"
              : locale === "zh"
                ? "OAuth 应用密钥"
                : "OAuth app secret"
          }
          value={giteeSecret}
          onChange={(e) => setGiteeSecret(e.target.value)}
        />

        <label
          htmlFor="gitee-repo"
          style={{ display: "block", margin: "0.75rem 0 0.35rem", fontSize: "0.85rem" }}
        >
          {locale === "zh" ? "备份仓库名" : "Backup repository"}
        </label>
        <input
          id="gitee-repo"
          className="settings-input"
          autoComplete="off"
          placeholder={
            locale === "zh"
              ? "默认 aicontrols-backup（仅小写字母、数字、-、_）"
              : "Default aicontrols-backup (a-z, 0-9, -, _)"
          }
          value={giteeRepo}
          onChange={(e) => setGiteeRepo(e.target.value)}
        />

        <label
          htmlFor="gitee-restore-url"
          style={{ display: "block", margin: "0.75rem 0 0.35rem", fontSize: "0.85rem" }}
        >
          {locale === "zh" ? "载入仓库地址（恢复）" : "Repository URL (restore)"}
        </label>
        <input
          id="gitee-restore-url"
          className="settings-input"
          autoComplete="off"
          placeholder={
            locale === "zh"
              ? "https://gitee.com/<owner>/<repo> 或 .../tree/<branch>/aicontrols-data"
              : "https://gitee.com/<owner>/<repo> or .../tree/<branch>/aicontrols-data"
          }
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
            {locale === "zh" ? "保存 Gitee 配置" : "Save Gitee config"}
          </button>
          <button
            type="button"
            className="btn-icon"
            disabled={busy || !giteePublic?.appConfigured}
            onClick={onGiteeAuth}
          >
            {locale === "zh" ? "在 Gitee 授权" : "Authorize on Gitee"}
          </button>
          <button
            type="button"
            className="btn-icon"
            disabled={busy || !giteePublic?.connected}
            onClick={onGiteeBackup}
          >
            {locale === "zh" ? "立即备份" : "Backup now"}
          </button>
          <button
            type="button"
            className="btn-icon"
            disabled={busy || !giteePublic?.connected}
            onClick={onGiteeDisconnect}
          >
            {locale === "zh" ? "解除授权" : "Disconnect"}
          </button>
          <button
            type="button"
            className="btn-icon"
            disabled={busy || !giteePublic?.connected || giteeRepoUrlInput.trim().length === 0}
            onClick={onGiteeRestore}
          >
            {locale === "zh" ? "从仓库载入" : "Restore from repo"}
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
