import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getGiteeSyncStatus, type GiteeSyncStatus } from "../api/gitee";

function formatCountdown(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export default function HomeGiteeSyncHud() {
  const [st, setSt] = useState<GiteeSyncStatus | null>(null);

  useEffect(() => {
    const load = () => {
      void getGiteeSyncStatus().then(setSt);
    };
    load();
    const id = window.setInterval(load, 4000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSt((prev) => (prev ? { ...prev } : prev));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (st === null) {
    return (
      <div
        className="home-gitee-sync home-gitee-sync--muted"
        aria-live="polite"
      >
        <div className="home-gitee-sync__title">Gitee 云备份</div>
        <p className="home-gitee-sync__status">在桌面端打开以查看同步状态</p>
      </div>
    );
  }

  const remainSec = (st.nextAutoCheckMs - Date.now()) / 1000;
  const overdue = remainSec < -5;
  const countdownLabel = overdue ? "检查中…" : formatCountdown(remainSec);

  let statusLine = "尚无备份记录";
  if (st.lastMessage) {
    const ok = st.lastOk === true;
    const skip = st.lastMessage.includes("无变化");
    const label = ok ? (skip ? "已跳过" : "成功") : "失败";
    statusLine = `${label} · ${truncate(st.lastMessage, 80)}`;
  }

  const lastAt =
    st.lastBackupMs != null
      ? new Date(st.lastBackupMs).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : null;

  return (
    <div
      className={`home-gitee-sync${st.connected ? "" : " home-gitee-sync--muted"}`}
      aria-live="polite"
    >
      <div className="home-gitee-sync__head">
        <span className="home-gitee-sync__title">Gitee 云备份</span>
        <Link to="/settings" className="home-gitee-sync__link">
          设置
        </Link>
      </div>
      <div className="home-gitee-sync__countdown">
        <span className="home-gitee-sync__label">距下次自动检查</span>
        <span className="home-gitee-sync__time">{countdownLabel}</span>
      </div>
      <p
        className="home-gitee-sync__status"
        title={st.lastMessage ?? undefined}
      >
        {st.connected ? statusLine : "未连接，请在设置中完成授权"}
      </p>
      {lastAt ? (
        <p className="home-gitee-sync__meta">上次操作 {lastAt}</p>
      ) : null}
    </div>
  );
}
