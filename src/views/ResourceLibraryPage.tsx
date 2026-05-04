import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { deepseekEnrichResourceUrl } from "../api/deepseek";
import {
  getResourceLibrary,
  saveResourceLibrary,
  type ResourceItem,
  type ResourceLibraryFile,
} from "../api/resources";

type Toast = { message: string; kind: "success" | "error" };

function emptyLibrary(): ResourceLibraryFile {
  return { version: 1, items: [] };
}

function parseTagsInput(raw: string): string[] {
  const parts = raw.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

function openHref(url: string): string {
  const t = url.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("//")) return `https:${t}`;
  return `https://${t}`;
}

function stripTrailingUrlPunct(s: string): string {
  return s.replace(/[.,;:!?)\]}>'"`]+$/u, "");
}

/** 从粘贴的正文中取出首个可识别的 http(s) 或裸域名链接。 */
function extractFirstUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const https = text.match(/https?:\/\/[^\s<>"')]+/i);
  if (https) return stripTrailingUrlPunct(https[0]);

  const www = text.match(/\bwww\.[^\s<>"')]+/i);
  if (www) return stripTrailingUrlPunct(`https://${www[0]}`);

  const words = text.split(/\s+/);
  if (words.length === 1) {
    const w = words[0];
    if (/^[\w.-]+\.[a-z]{2,}(?:\/[\w\-./?#&=%~]*)?$/i.test(w)) {
      return stripTrailingUrlPunct(w);
    }
  }

  return null;
}

function normalizeStoredUrl(url: string): string {
  const t = url.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("//")) return `https:${t}`;
  return `https://${t}`;
}

export default function ResourceLibraryPage() {
  const location = useLocation();
  const [library, setLibrary] = useState<ResourceLibraryFile>(emptyLibrary());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [search, setSearch] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    title: "",
    url: "",
    tagsInput: "",
    note: "",
    pinned: false,
  });
  const [cardContextMenu, setCardContextMenu] = useState<{
    x: number;
    y: number;
    item: ResourceItem;
  } | null>(null);
  const cardContextMenuRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const quickPasteInputRef = useRef<HTMLInputElement>(null);
  const [quickPasteBusy, setQuickPasteBusy] = useState(false);
  const libraryRef = useRef(library);
  libraryRef.current = library;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        const lib = await getResourceLibrary();
        if (!cancelled) setLibrary(lib);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 进入资源库页（含从其它路由切回）且列表加载完成后，焦点落到快速添加输入框 */
  useEffect(() => {
    if (loading || showEditor) return;
    const id = window.requestAnimationFrame(() => {
      quickPasteInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [loading, showEditor, location.key]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!cardContextMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (cardContextMenuRef.current?.contains(e.target as Node)) return;
      setCardContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCardContextMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [cardContextMenu]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = library.items.filter((item) => {
      if (!q) return true;
      const tagStr = item.tags.join(" ").toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        (item.url ?? "").toLowerCase().includes(q) ||
        tagStr.includes(q) ||
        (item.note ?? "").toLowerCase().includes(q)
      );
    });
    return list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  }, [library.items, search]);

  async function persist(next: ResourceLibraryFile) {
    try {
      setSaving(true);
      await saveResourceLibrary(next);
      setLibrary(next);
      setErr(null);
    } catch (e) {
      setErr(String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }

  function resetDraft() {
    setDraft({
      title: "",
      url: "",
      tagsInput: "",
      note: "",
      pinned: false,
    });
  }

  function closeEditor() {
    setShowEditor(false);
    setEditingItemId(null);
    resetDraft();
  }

  function openCreate() {
    setCardContextMenu(null);
    setEditingItemId(null);
    resetDraft();
    setShowEditor(true);
  }

  function openEdit(item: ResourceItem) {
    setCardContextMenu(null);
    setEditingItemId(item.id);
    setDraft({
      title: item.title,
      url: item.url ?? "",
      tagsInput: item.tags.join(", "),
      note: item.note ?? "",
      pinned: item.pinned,
    });
    setShowEditor(true);
  }

  useEffect(() => {
    if (!showEditor) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeEditor();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [showEditor]);

  useEffect(() => {
    if (!showEditor) return;
    const id = window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [showEditor]);

  async function addResourceFromUrlEnriched(urlNorm: string) {
    const enriched = await deepseekEnrichResourceUrl(urlNorm);
    const now = Date.now();
    const item: ResourceItem = {
      id: crypto.randomUUID(),
      title: enriched.title.trim() || urlNorm,
      url: urlNorm,
      tags: enriched.tags ?? [],
      note: enriched.note ?? "",
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    const base = libraryRef.current;
    const next = { ...base, items: [item, ...base.items] };
    await persist(next);
    setToast({ kind: "success", message: "已从链接添加资源" });
  }

  async function tryQuickAddFromText(raw: string) {
    const urlRaw = extractFirstUrl(raw);
    if (!urlRaw) {
      setToast({
        kind: "error",
        message: "未识别为链接，请粘贴 http(s) 地址或可解析的域名",
      });
      return;
    }
    const urlNorm = normalizeStoredUrl(urlRaw);
    try {
      setQuickPasteBusy(true);
      await addResourceFromUrlEnriched(urlNorm);
      if (quickPasteInputRef.current) quickPasteInputRef.current.value = "";
    } catch (e) {
      setToast({ kind: "error", message: String(e) });
    } finally {
      setQuickPasteBusy(false);
    }
  }

  async function onSubmitEditor() {
    const title = draft.title.trim();
    const urlRaw = draft.url.trim();
    const tags = parseTagsInput(draft.tagsInput);
    const note = draft.note.trim();
    if (!title) {
      setToast({ kind: "error", message: "请填写标题" });
      return;
    }
    const now = Date.now();
    const url = urlRaw.length > 0 ? urlRaw : null;

    if (editingItemId !== null) {
      const prev = library.items.find((x) => x.id === editingItemId);
      if (!prev) {
        setToast({ kind: "error", message: "条目不存在或已删除" });
        closeEditor();
        return;
      }
      const updated: ResourceItem = {
        ...prev,
        title,
        url,
        tags,
        note,
        pinned: draft.pinned,
        updatedAt: now,
      };
      const next = {
        ...library,
        items: library.items.map((x) => (x.id === editingItemId ? updated : x)),
      };
      await persist(next);
      closeEditor();
      setToast({ kind: "success", message: "已保存修改" });
      return;
    }

    const item: ResourceItem = {
      id: crypto.randomUUID(),
      title,
      url,
      tags,
      note,
      pinned: draft.pinned,
      createdAt: now,
      updatedAt: now,
    };
    const next = { ...library, items: [item, ...library.items] };
    await persist(next);
    closeEditor();
    setToast({ kind: "success", message: "已保存" });
  }

  async function onDeleteItem(id: string) {
    const next = { ...library, items: library.items.filter((x) => x.id !== id) };
    await persist(next);
    setToast({ kind: "success", message: "已删除" });
  }

  async function togglePin(item: ResourceItem) {
    const now = Date.now();
    const next = {
      ...library,
      items: library.items.map((x) =>
        x.id === item.id ? { ...x, pinned: !x.pinned, updatedAt: now } : x,
      ),
    };
    await persist(next);
    setToast({
      kind: "success",
      message: item.pinned ? "已取消置顶" : "已置顶",
    });
  }

  async function copyText(text: string, okMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ kind: "success", message: okMsg });
    } catch {
      setToast({ kind: "error", message: "复制失败" });
    }
  }

  function copyCardContents(item: ResourceItem) {
    const url = (item.url ?? "").trim();
    const hasUrl = url.length > 0;
    const toCopy = hasUrl ? url : item.title;
    void copyText(toCopy, hasUrl ? "已复制链接" : "已复制标题");
  }

  function onCardContextMenu(e: React.MouseEvent, item: ResourceItem) {
    e.preventDefault();
    e.stopPropagation();
    const pad = 8;
    const approxW = 200;
    const approxH = 180;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = Math.min(Math.max(pad, e.clientX), Math.max(pad, vw - approxW - pad));
    const y = Math.min(Math.max(pad, e.clientY), Math.max(pad, vh - approxH - pad));
    setCardContextMenu({ x, y, item });
  }

  if (loading) return <p className="muted">正在加载资源库…</p>;

  return (
    <div className="resource-lib">
      <div className="page-header">
        <div className="page-header__title-bar">
          <div className="page-title__row">
            <h2>资源库</h2>
            <span className="count-badge">{library.items.length}</span>
          </div>
          <button type="button" onClick={openCreate} disabled={saving}>
            + 新建资源
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar__left">
          <label className="search">
            <span className="search__icon" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM16.5 16.5L21 21"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <input
              className="search__input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索标题、链接、标签、备注"
            />
          </label>
        </div>
      </div>

      <section className="resource-lib__list-wrap" aria-label="资源列表">
        {filteredItems.length === 0 ? (
          <p className="muted">
            {library.items.length === 0 ? "暂无资源，点击「新建资源」添加。" : "没有符合搜索条件的资源。"}
          </p>
        ) : (
          <ul className="resource-lib__list">
            {filteredItems.map((item) => (
              <li key={item.id}>
                <article
                  className={`resource-lib__card${item.pinned ? " resource-lib__card--pinned" : ""}`}
                  title="点击复制链接（无链接时复制标题）"
                  onClick={() => copyCardContents(item)}
                  onContextMenu={(e) => onCardContextMenu(e, item)}
                >
                  <div className="resource-lib__card-top">
                    <div className="resource-lib__card-title-row">
                      {item.pinned ? (
                        <span className="resource-lib__pin-badge" title="已置顶" aria-label="已置顶">
                          <PinIcon filled />
                        </span>
                      ) : null}
                      <h3 className="resource-lib__card-title" title={item.title}>
                        {item.title}
                      </h3>
                    </div>
                    <button
                      type="button"
                      className={`resource-lib__pin-btn${item.pinned ? " is-active" : ""}`}
                      title={item.pinned ? "取消置顶" : "置顶"}
                      aria-pressed={item.pinned}
                      disabled={saving}
                      onClick={(e) => {
                        e.stopPropagation();
                        void togglePin(item);
                      }}
                    >
                      <PinIcon filled={item.pinned} />
                    </button>
                  </div>
                  {item.url ? (
                    <span className="resource-lib__url resource-lib__url--text">{item.url}</span>
                  ) : (
                    <p className="resource-lib__no-url muted">未填写链接</p>
                  )}
                  {item.tags.length > 0 ? (
                    <ul className="resource-lib__tags" aria-label="标签">
                      {item.tags.map((t) => (
                        <li key={t}>
                          <span className="resource-lib__tag">{t}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {item.note ? (
                    <p className="resource-lib__note">{item.note}</p>
                  ) : null}
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showEditor
        ? createPortal(
            <div className="prompt-create-modal-root">
              <div
                className="prompt-create-modal-backdrop"
                onClick={() => closeEditor()}
                aria-hidden
              />
              <div
                className="prompt-create-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="resource-editor-title"
              >
                <header className="prompt-create-modal__header">
                  <div className="prompt-create-modal__header-text">
                    <h2 id="resource-editor-title" className="prompt-create-modal__title">
                      {editingItemId ? "编辑资源" : "新建资源"}
                    </h2>
                    <p className="prompt-create-modal__subtitle">
                      标题必填；链接可空（仅占位）；标签用逗号、顿号或空格分隔；支持置顶与备注。
                    </p>
                  </div>
                  <button
                    type="button"
                    className="prompt-create-modal__close"
                    onClick={() => closeEditor()}
                    aria-label="关闭"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                      <path
                        d="M6 6l12 12M18 6L6 18"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </header>

                <form
                  className="prompt-create-modal__form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void onSubmitEditor();
                  }}
                >
                  <div className="prompt-create-modal__body">
                    <label className="prompt-create-modal__field" htmlFor="res-title">
                      <span className="prompt-create-modal__label">标题</span>
                      <input
                        ref={titleInputRef}
                        id="res-title"
                        className="prompt-create-modal__input"
                        value={draft.title}
                        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                        placeholder="如：某组件库、某 GitHub 仓库"
                        autoComplete="off"
                      />
                    </label>

                    <label className="prompt-create-modal__field" htmlFor="res-url">
                      <span className="prompt-create-modal__label">
                        链接 <span className="prompt-create-modal__label-optional">选填</span>
                      </span>
                      <input
                        id="res-url"
                        className="prompt-create-modal__input"
                        value={draft.url}
                        onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
                        placeholder="https:// 或 github.com/…"
                        inputMode="url"
                        autoComplete="off"
                      />
                    </label>

                    <label className="prompt-create-modal__field" htmlFor="res-tags">
                      <span className="prompt-create-modal__label">
                        标签 <span className="prompt-create-modal__label-optional">选填</span>
                      </span>
                      <input
                        id="res-tags"
                        className="prompt-create-modal__input"
                        value={draft.tagsInput}
                        onChange={(e) => setDraft((d) => ({ ...d, tagsInput: e.target.value }))}
                        placeholder="react, 组件库, admin"
                        autoComplete="off"
                      />
                    </label>

                    <label className="prompt-create-modal__field" htmlFor="res-note">
                      <span className="prompt-create-modal__label">
                        备注 <span className="prompt-create-modal__label-optional">选填</span>
                      </span>
                      <textarea
                        id="res-note"
                        className="prompt-create-modal__textarea"
                        rows={4}
                        value={draft.note}
                        onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                        placeholder="用途、账号提示、踩坑记录等"
                        spellCheck={false}
                      />
                    </label>

                    <label className="prompt-create-modal__field prompt-create-modal__field--row-check">
                      <input
                        type="checkbox"
                        className="resource-lib__checkbox"
                        checked={draft.pinned}
                        onChange={(e) => setDraft((d) => ({ ...d, pinned: e.target.checked }))}
                      />
                      <span className="prompt-create-modal__label resource-lib__check-label">
                        置顶（置顶项排在列表最前，同组内按创建时间从新到旧）
                      </span>
                    </label>
                  </div>

                  <footer className="prompt-create-modal__footer">
                    <span className="prompt-create-modal__kbd-hint">Esc 关闭</span>
                    <div className="prompt-create-modal__actions">
                      <button
                        type="button"
                        className="prompt-create-modal__cancel"
                        onClick={() => closeEditor()}
                        disabled={saving}
                      >
                        取消
                      </button>
                      <button type="submit" className="prompt-create-modal__submit" disabled={saving}>
                        保存
                      </button>
                    </div>
                  </footer>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}

      {cardContextMenu
        ? createPortal(
            <div
              ref={cardContextMenuRef}
              className="card-context-menu"
              style={{
                position: "fixed",
                left: cardContextMenu.x,
                top: cardContextMenu.y,
                zIndex: 10_000,
              }}
              role="menu"
              aria-label="资源操作"
            >
              <button
                type="button"
                role="menuitem"
                className="card-context-menu__item"
                disabled={saving}
                onClick={() => {
                  const it = cardContextMenu.item;
                  setCardContextMenu(null);
                  openEdit(it);
                }}
              >
                编辑
              </button>
              {cardContextMenu.item.url?.trim() ? (
                <button
                  type="button"
                  role="menuitem"
                  className="card-context-menu__item"
                  disabled={saving}
                  onClick={() => {
                    const u = cardContextMenu.item.url ?? "";
                    setCardContextMenu(null);
                    window.open(openHref(u), "_blank", "noopener,noreferrer");
                  }}
                >
                  在浏览器打开
                </button>
              ) : null}
              {cardContextMenu.item.url?.trim() ? (
                <button
                  type="button"
                  role="menuitem"
                  className="card-context-menu__item"
                  disabled={saving}
                  onClick={() => {
                    const u = cardContextMenu.item.url ?? "";
                    setCardContextMenu(null);
                    void copyText(u, "已复制链接");
                  }}
                >
                  复制链接
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="card-context-menu__item"
                disabled={saving}
                onClick={() => {
                  const it = cardContextMenu.item;
                  setCardContextMenu(null);
                  void togglePin(it);
                }}
              >
                {cardContextMenu.item.pinned ? "取消置顶" : "置顶"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="card-context-menu__item card-context-menu__item--danger"
                disabled={saving}
                onClick={() => {
                  const id = cardContextMenu.item.id;
                  setCardContextMenu(null);
                  void onDeleteItem(id);
                }}
              >
                删除
              </button>
            </div>,
            document.body,
          )
        : null}

      <div className="resource-lib__quickadd" aria-label="快速粘贴链接">
        <span className="resource-lib__quickadd-label">快速添加</span>
        <div className="resource-lib__quickadd-row">
          <input
            ref={quickPasteInputRef}
            type="text"
            className="resource-lib__quickadd-input"
            placeholder="粘贴链接，自动识别"
            disabled={quickPasteBusy || saving}
            spellCheck={false}
            onPaste={(e) => {
              const t = e.clipboardData.getData("text/plain");
              if (extractFirstUrl(t)) {
                e.preventDefault();
                void tryQuickAddFromText(t);
              }
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const v = e.currentTarget.value;
              void tryQuickAddFromText(v);
            }}
          />
          {quickPasteBusy ? (
            <span className="resource-lib__quickadd-status" aria-live="polite">
              AI 分析中…
            </span>
          ) : null}
        </div>
      </div>

      {err ? <p className="error">{err}</p> : null}
      {toast ? (
        <div className="toast-stack">
          <div className={`toast ${toast.kind === "error" ? "toast--error" : "toast--success"}`}>
            <span className="toast__text">{toast.message}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 17v5M5 3h14v2a4 4 0 01-4 4h-6a4 4 0 01-4-4V3zM9 9v8l3 2 3-2V9"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={filled ? "currentColor" : "none"}
        fillOpacity={filled ? 0.2 : 0}
      />
    </svg>
  );
}
