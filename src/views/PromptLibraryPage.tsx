import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getPromptLibrary,
  savePromptLibrary,
  type PromptItem,
  type PromptLibraryFile,
  type PromptType,
} from "../api/prompts";

const TYPE_META: Record<PromptType, { label: string; rootName: string }> = {
  image: { label: "图片", rootName: "图片" },
  code: { label: "代码", rootName: "代码" },
  doc: { label: "文档", rootName: "文档" },
  text: { label: "纯文本", rootName: "纯文本" },
};

type Toast = { message: string; kind: "success" | "error" };

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function emptyLibrary(): PromptLibraryFile {
  return { version: 1, folders: [], items: [] };
}

function ensureRootFolders(lib: PromptLibraryFile): PromptLibraryFile {
  const next = { ...lib, folders: [...lib.folders] };
  for (const t of Object.keys(TYPE_META) as PromptType[]) {
    if (!next.folders.some((f) => f.id === t)) {
      next.folders.push({ id: t, name: TYPE_META[t].rootName, parentId: null });
    }
  }
  return next;
}

export default function PromptLibraryPage() {
  const [library, setLibrary] = useState<PromptLibraryFile>(emptyLibrary());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [activeType, setActiveType] = useState<PromptType>("image");
  const [activeFolderId, setActiveFolderId] = useState<string>("image");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  /** 非空表示在编辑已有条目，否则为新建 */
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [newItem, setNewItem] = useState({
    title: "",
    prompt: "",
    outputType: "image" as PromptType,
    outputExample: "",
    relatedLink: "",
  });
  const [newOutputImageDataUrl, setNewOutputImageDataUrl] = useState<string | null>(null);
  const [cardContextMenu, setCardContextMenu] = useState<{
    x: number;
    y: number;
    item: PromptItem;
  } | null>(null);
  const cardContextMenuRef = useRef<HTMLDivElement>(null);
  const createTitleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        const lib = ensureRootFolders(await getPromptLibrary());
        if (!cancelled) {
          setLibrary(lib);
          setActiveFolderId(activeType);
        }
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

  const folderDescendants = useMemo(() => {
    const ids = new Set<string>([activeFolderId]);
    let added = true;
    while (added) {
      added = false;
      for (const f of library.folders) {
        if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
          ids.add(f.id);
          added = true;
        }
      }
    }
    return ids;
  }, [activeFolderId, library.folders]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return library.items
      .filter((item) => item.type === activeType)
      .filter((item) => folderDescendants.has(item.folderId))
      .filter((item) => {
        if (!q) return true;
        return (
          item.title.toLowerCase().includes(q) ||
          item.prompt.toLowerCase().includes(q) ||
          (item.outputExample ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [activeType, folderDescendants, library.items, search]);

  const masonryColumns = useMemo(() => {
    const cols: [PromptItem[], PromptItem[], PromptItem[]] = [[], [], []];
    for (let i = 0; i < filteredItems.length; i += 1) {
      cols[i % 3].push(filteredItems[i]);
    }
    return cols;
  }, [filteredItems]);

  async function persist(next: PromptLibraryFile) {
    try {
      setSaving(true);
      await savePromptLibrary(next);
      setLibrary(next);
      setErr(null);
    } catch (e) {
      setErr(String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }

  function resetCreateState() {
    setNewItem({
      title: "",
      prompt: "",
      outputType: activeType,
      outputExample: "",
      relatedLink: "",
    });
    setNewOutputImageDataUrl(null);
  }

  function closeCreateModal() {
    setShowCreate(false);
    setEditingItemId(null);
    resetCreateState();
  }

  function openCreateModal() {
    setCardContextMenu(null);
    setEditingItemId(null);
    setShowCreate(true);
    resetCreateState();
  }

  function openEditModal(item: PromptItem) {
    setCardContextMenu(null);
    setEditingItemId(item.id);
    const outputType = item.outputType ?? item.type;
    setNewItem({
      title: item.title,
      prompt: item.prompt,
      outputType,
      outputExample: outputType === "image" ? "" : (item.outputExample ?? ""),
      relatedLink: item.relatedLink ?? "",
    });
    setNewOutputImageDataUrl(item.type === "image" ? (item.imageDataUrl ?? null) : null);
    setShowCreate(true);
  }

  useEffect(() => {
    if (!showCreate) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCreateModal();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [showCreate]);

  useEffect(() => {
    if (!showCreate) return;
    const id = window.requestAnimationFrame(() => {
      createTitleInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [showCreate]);

  async function onSubmitEditor() {
    const title = newItem.title.trim();
    const prompt = newItem.prompt.trim();
    const outputType = newItem.outputType;
    const outputExample = newItem.outputExample.trim();
    const relatedLink = newItem.relatedLink.trim();
    if (!title) {
      setToast({ kind: "error", message: "请填写标题" });
      return;
    }
    if (outputType !== "image" && !prompt) {
      setToast({ kind: "error", message: "请填写 Prompt" });
      return;
    }
    const prev =
      editingItemId !== null ? library.items.find((x) => x.id === editingItemId) ?? null : null;
    if (editingItemId !== null && !prev) {
      setToast({ kind: "error", message: "条目不存在或已删除" });
      closeCreateModal();
      return;
    }
    if (outputType === "image") {
      const imageUrl = newOutputImageDataUrl ?? (prev?.type === "image" ? (prev.imageDataUrl ?? null) : null);
      if (!imageUrl) {
        setToast({ kind: "error", message: "请先粘贴图片输出示例" });
        return;
      }
    }
    if (outputType !== "image" && !outputExample) {
      setToast({ kind: "error", message: "请先粘贴输出示例内容" });
      return;
    }

    const now = Date.now();
    if (editingItemId !== null && prev) {
      const imageDataUrl =
        outputType === "image"
          ? (newOutputImageDataUrl ?? (prev.imageDataUrl ?? null))
          : null;
      const updated: PromptItem = {
        ...prev,
        type: outputType,
        title,
        prompt,
        outputType,
        outputExample: outputType === "image" ? "" : outputExample,
        relatedLink: relatedLink || null,
        imageDataUrl,
        folderId: outputType,
        updatedAt: now,
      };
      const next = {
        ...library,
        items: library.items.map((x) => (x.id === editingItemId ? updated : x)),
      };
      await persist(next);
      closeCreateModal();
      setActiveType(outputType);
      setActiveFolderId(outputType);
      setToast({ kind: "success", message: "已保存修改" });
      return;
    }

    const item: PromptItem = {
      id: crypto.randomUUID(),
      type: outputType,
      title,
      prompt,
      outputType,
      outputExample: outputType === "image" ? "" : outputExample,
      relatedLink: relatedLink || null,
      imageDataUrl: outputType === "image" ? newOutputImageDataUrl : null,
      tags: [],
      note: "",
      folderId: outputType,
      createdAt: now,
      updatedAt: now,
    };
    const next = { ...library, items: [item, ...library.items] };
    await persist(next);
    closeCreateModal();
    setActiveType(outputType);
    setActiveFolderId(outputType);
    setToast({ kind: "success", message: "已保存" });
  }

  async function onDeleteItem(id: string) {
    const next = { ...library, items: library.items.filter((x) => x.id !== id) };
    await persist(next);
    setToast({ kind: "success", message: "已删除" });
  }

  async function copyPrompt(prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setToast({ kind: "success", message: "已复制 Prompt" });
    } catch {
      setToast({ kind: "error", message: "复制失败" });
    }
  }

  async function copyImageDataUrl(dataUrl: string) {
    try {
      const blob = dataUrlToBlob(dataUrl);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ClipboardItemCtor = (window as any).ClipboardItem as
        | (new (items: Record<string, Blob>) => ClipboardItem)
        | undefined;
      if (!ClipboardItemCtor || !navigator.clipboard?.write) {
        throw new Error("clipboard image write unsupported");
      }
      await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type || "image/png"]: blob })]);
      setToast({ kind: "success", message: "已复制图片" });
    } catch {
      setToast({ kind: "error", message: "复制图片失败" });
    }
  }

  async function copyOutputExample(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ kind: "success", message: "已复制输出示例" });
    } catch {
      setToast({ kind: "error", message: "复制失败" });
    }
  }

  function switchType(t: PromptType) {
    setActiveType(t);
    setActiveFolderId(t);
    setCardContextMenu(null);
  }

  function onMasonryCardContextMenu(e: React.MouseEvent, item: PromptItem) {
    e.preventDefault();
    e.stopPropagation();
    const pad = 8;
    const approxW = 200;
    const approxH = 168;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = Math.min(Math.max(pad, e.clientX), Math.max(pad, vw - approxW - pad));
    const y = Math.min(Math.max(pad, e.clientY), Math.max(pad, vh - approxH - pad));
    setCardContextMenu({ x, y, item });
  }

  function dataUrlByteLength(dataUrl: string): number {
    const idx = dataUrl.indexOf(",");
    if (idx < 0) return 0;
    const base64 = dataUrl.slice(idx + 1);
    const padding = (base64.match(/=*$/)?.[0].length ?? 0);
    return Math.max(0, (base64.length * 3) / 4 - padding);
  }

  async function loadPastedImageData(file: File) {
    const raw = await fileToDataUrl(file);
    const bytes = dataUrlByteLength(raw);
    if (bytes <= MAX_IMAGE_BYTES) {
      setNewOutputImageDataUrl(raw);
      setToast({ kind: "success", message: "图片已粘贴" });
      return;
    }
    const compressed = await compressDataUrlToMax(raw, MAX_IMAGE_BYTES);
    setNewOutputImageDataUrl(compressed);
    setToast({ kind: "success", message: "图片已压缩并粘贴" });
  }

  async function onPasteOutputExample(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (newItem.outputType !== "image") return;
    const imageItem = Array.from(e.clipboardData.items).find((x) => x.type.startsWith("image/"));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    try {
      await loadPastedImageData(file);
    } catch {
      setToast({ kind: "error", message: "图片处理失败" });
    }
  }

  if (loading) return <p className="muted">正在加载 Prompt 库…</p>;

  return (
    <div className="prompt-lib">
      <div className="page-header">
        <div className="page-header__title-bar">
          <div className="page-title__row">
            <h2>Prompt 库</h2>
            <span className="count-badge">{library.items.length}</span>
          </div>
          <button onClick={openCreateModal} disabled={saving}>
            + 新建收藏
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar__left">
          <div className="seg" role="tablist" aria-label="Prompt 类型">
            {(Object.keys(TYPE_META) as PromptType[]).map((t) => (
              <button
                key={t}
                className={`seg__item${activeType === t ? " active" : ""}`}
                onClick={() => switchType(t)}
              >
                {TYPE_META[t].label}
              </button>
            ))}
          </div>
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
              placeholder="搜索标题 / Prompt / 输出示例"
            />
          </label>
        </div>
      </div>

      <div className="prompt-lib__layout">
        <section className="prompt-lib__browse">
          {filteredItems.length === 0 ? (
            <p className="muted">当前分类暂无收藏</p>
          ) : (
            <div className="prompt-lib__masonry">
              {masonryColumns.map((columnItems, columnIndex) => (
                <div key={`col-${columnIndex}`} className="prompt-lib__masonry-col">
                  {columnItems.map((item) => (
                    <article
                      key={item.id}
                      className={`prompt-lib__masonry-card${item.type === "image" ? "" : " prompt-lib__masonry-card--text-output"}`}
                      onContextMenu={(e) => onMasonryCardContextMenu(e, item)}
                    >
                      <MasonryCardOutput item={item} />
                      <div className="prompt-lib__masonry-body">
                        <h3 className="prompt-lib__masonry-title" title={item.title}>
                          {item.title}
                        </h3>
                        <button
                          type="button"
                          className="prompt-lib__masonry-copy"
                          onClick={(e) => {
                            e.stopPropagation();
                            const p = item.prompt.trim();
                            if (item.type === "image" && !p && item.imageDataUrl) {
                              void copyImageDataUrl(item.imageDataUrl);
                              return;
                            }
                            void copyPrompt(item.prompt);
                          }}
                        >
                          {item.type === "image" && !item.prompt.trim() ? "复制图片" : "复制 Prompt"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {showCreate
        ? createPortal(
            <div className="prompt-create-modal-root">
              <div
                className="prompt-create-modal-backdrop"
                onClick={() => closeCreateModal()}
                aria-hidden
              />
              <div
                className="prompt-create-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="prompt-editor-title"
              >
                <header className="prompt-create-modal__header">
                  <div className="prompt-create-modal__header-text">
                    <h2 id="prompt-editor-title" className="prompt-create-modal__title">
                      {editingItemId ? "编辑收藏" : "新建收藏"}
                    </h2>
                    <p className="prompt-create-modal__subtitle">
                      {editingItemId
                        ? "修改标题、Prompt、输出类型或示例后保存。"
                        : "保存输出示例与相关信息，便于复制与对照。"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="prompt-create-modal__close"
                    onClick={() => closeCreateModal()}
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
                    <div className="prompt-create-modal__cluster">
                      <label className="prompt-create-modal__field" htmlFor="pcm-title">
                        <span className="prompt-create-modal__label">标题</span>
                        <input
                          ref={createTitleInputRef}
                          id="pcm-title"
                          className="prompt-create-modal__input"
                          value={newItem.title}
                          onChange={(e) => setNewItem((v) => ({ ...v, title: e.target.value }))}
                          placeholder="简要命名这条收藏"
                          autoComplete="off"
                        />
                      </label>
                      <div className="prompt-create-modal__field prompt-create-modal__field--flush">
                        <span className="prompt-create-modal__label" id="pcm-output-type-label">
                          输出类型
                        </span>
                        <div
                          className="prompt-create-modal__type-row"
                          role="radiogroup"
                          aria-labelledby="pcm-output-type-label"
                        >
                          {(Object.keys(TYPE_META) as PromptType[]).map((t) => (
                            <button
                              key={t}
                              type="button"
                              role="radio"
                              aria-checked={newItem.outputType === t}
                              className={`prompt-create-modal__type-pill${
                                newItem.outputType === t ? " is-active" : ""
                              }`}
                              onClick={() => {
                                setNewItem((v) => {
                                  if (t === "image") return { ...v, outputType: t, outputExample: "" };
                                  const keepExample = v.outputType !== "image";
                                  return {
                                    ...v,
                                    outputType: t,
                                    outputExample: keepExample ? v.outputExample : "",
                                  };
                                });
                                if (t === "image") {
                                  setNewOutputImageDataUrl((cur) => {
                                    if (cur) return cur;
                                    const ed = editingItemId
                                      ? library.items.find((x) => x.id === editingItemId)
                                      : undefined;
                                    return ed?.imageDataUrl ?? null;
                                  });
                                } else {
                                  setNewOutputImageDataUrl(null);
                                }
                              }}
                            >
                              <span className="prompt-create-modal__type-icon" aria-hidden>
                                <OutputTypeGlyph type={t} />
                              </span>
                              <span className="prompt-create-modal__type-label">{TYPE_META[t].label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="prompt-create-modal__rule" role="presentation" />

                    <label className="prompt-create-modal__field" htmlFor="pcm-prompt">
                      <span className="prompt-create-modal__label">Prompt</span>
                      <textarea
                        id="pcm-prompt"
                        className="prompt-create-modal__textarea prompt-create-modal__textarea--prompt"
                        rows={6}
                        value={newItem.prompt}
                        onChange={(e) => setNewItem((v) => ({ ...v, prompt: e.target.value }))}
                        placeholder="完整指令内容"
                        spellCheck={false}
                      />
                    </label>

                    <div className="prompt-create-modal__rule" role="presentation" />

                    {newItem.outputType === "image" ? (
                      <div className="prompt-create-modal__field">
                        <span className="prompt-create-modal__label" id="pcm-image-example-label">
                          输出示例（图片）
                        </span>
                        <div
                          className={`prompt-create-modal__paste-board${
                            newOutputImageDataUrl ? " has-preview" : ""
                          }`}
                        >
                          <textarea
                            className="prompt-create-modal__paste-target"
                            rows={2}
                            placeholder="聚焦后粘贴截图（⌘V / Ctrl+V）"
                            onPaste={(e) => void onPasteOutputExample(e)}
                            aria-labelledby="pcm-image-example-label"
                          />
                          {!newOutputImageDataUrl ? (
                            <p className="prompt-create-modal__paste-hint">
                              支持从浏览器或设计工具粘贴；体积过大会自动压缩。
                            </p>
                          ) : null}
                        </div>
                        {newOutputImageDataUrl ? (
                          <div className="prompt-create-modal__preview-wrap">
                            <img
                              src={newOutputImageDataUrl}
                              alt="已粘贴的输出示例预览"
                              className="prompt-create-modal__preview-img"
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <label className="prompt-create-modal__field" htmlFor="pcm-output-example">
                        <span className="prompt-create-modal__label">输出示例</span>
                        <textarea
                          id="pcm-output-example"
                          className="prompt-create-modal__textarea"
                          rows={4}
                          value={newItem.outputExample}
                          onChange={(e) => setNewItem((v) => ({ ...v, outputExample: e.target.value }))}
                          placeholder="一段代表性的文本、代码或文档片段"
                          spellCheck={false}
                        />
                      </label>
                    )}

                    <div className="prompt-create-modal__rule" role="presentation" />

                    <label className="prompt-create-modal__field" htmlFor="pcm-link">
                      <span className="prompt-create-modal__label">
                        相关链接 <span className="prompt-create-modal__label-optional">选填</span>
                      </span>
                      <input
                        id="pcm-link"
                        className="prompt-create-modal__input"
                        value={newItem.relatedLink}
                        onChange={(e) => setNewItem((v) => ({ ...v, relatedLink: e.target.value }))}
                        placeholder="https://"
                        inputMode="url"
                        autoComplete="off"
                      />
                    </label>
                  </div>

                  <footer className="prompt-create-modal__footer">
                    <span className="prompt-create-modal__kbd-hint">Esc 关闭</span>
                    <div className="prompt-create-modal__actions">
                      <button
                        type="button"
                        className="prompt-create-modal__cancel"
                        onClick={() => closeCreateModal()}
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
              aria-label="收藏操作"
            >
              <button
                type="button"
                role="menuitem"
                className="card-context-menu__item"
                disabled={saving}
                onClick={() => {
                  const item = cardContextMenu.item;
                  setCardContextMenu(null);
                  openEditModal(item);
                }}
              >
                编辑
              </button>
              <button
                type="button"
                role="menuitem"
                className="card-context-menu__item"
                disabled={saving}
                onClick={() => {
                  const item = cardContextMenu.item;
                  setCardContextMenu(null);
                  const p = item.prompt.trim();
                  if (item.type === "image" && !p && item.imageDataUrl) {
                    void copyImageDataUrl(item.imageDataUrl);
                    return;
                  }
                  void copyPrompt(item.prompt);
                }}
              >
                {cardContextMenu.item.type === "image" && !cardContextMenu.item.prompt.trim()
                  ? "复制图片"
                  : "复制 Prompt"}
              </button>
              {cardContextMenu.item.type !== "image" && cardContextMenu.item.outputExample?.trim() ? (
                <button
                  type="button"
                  role="menuitem"
                  className="card-context-menu__item"
                  disabled={saving}
                  onClick={() => {
                    const ex = cardContextMenu.item.outputExample ?? "";
                    setCardContextMenu(null);
                    void copyOutputExample(ex);
                  }}
                >
                  复制输出示例
                </button>
              ) : null}
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

function MasonryCardOutput({ item }: { item: PromptItem }) {
  if (item.type === "image") {
    return item.imageDataUrl ? (
      <img src={item.imageDataUrl} alt={item.title} className="prompt-lib__masonry-image" />
    ) : (
      <div className="prompt-lib__masonry-fallback">暂无图片</div>
    );
  }
  const raw = (item.outputExample ?? "").trim();
  if (!raw) {
    return <div className="prompt-lib__masonry-fallback">暂无输出示例</div>;
  }
  const kind = item.type === "code" ? "code" : item.type === "doc" ? "doc" : "text";
  return (
    <div className={`prompt-lib__masonry-output prompt-lib__masonry-output--${kind}`}>
      <pre className={`prompt-lib__masonry-text-pre prompt-lib__masonry-text-pre--${kind}`}>{raw}</pre>
    </div>
  );
}

function OutputTypeGlyph({ type }: { type: PromptType }) {
  const stroke = "currentColor" as const;
  const sw = 1.65;
  switch (type) {
    case "image":
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke={stroke} strokeWidth={sw} />
          <circle cx="8.5" cy="10" r="1.5" fill={stroke} />
          <path
            d="M3 17l5.5-5.5a1.5 1.5 0 012.1 0L15 16l2.5-2.5a1.5 1.5 0 012.1 0L21 15"
            fill="none"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "code":
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path
            d="M8 8l-3.5 4L8 16M16 8l3.5 4L16 16"
            fill="none"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "doc":
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path
            d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"
            fill="none"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinejoin="round"
          />
          <path d="M14 3v4h4M8 13h8M8 16.5h8M8 10h5" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        </svg>
      );
    case "text":
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path d="M6 6h12M6 10h12M6 14h9M6 18h11" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return new Blob([dataUrl], { type: "text/plain" });
  const mime = m[1] || "application/octet-stream";
  const b64 = m[2] || "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = dataUrl;
  });
}

async function compressDataUrlToMax(dataUrl: string, maxBytes: number): Promise<string> {
  const img = await dataUrlToImage(dataUrl);
  const canvas = document.createElement("canvas");
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let quality = 0.9;
  let out = canvas.toDataURL("image/webp", quality);
  while (quality > 0.4) {
    const idx = out.indexOf(",");
    const b64 = idx >= 0 ? out.slice(idx + 1) : "";
    const padding = (b64.match(/=*$/)?.[0].length ?? 0);
    const bytes = Math.max(0, (b64.length * 3) / 4 - padding);
    if (bytes <= maxBytes) return out;
    quality -= 0.1;
    out = canvas.toDataURL("image/webp", quality);
  }
  return out;
}
