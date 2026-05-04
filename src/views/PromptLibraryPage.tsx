import { useEffect, useMemo, useState } from "react";
import {
  getPromptLibrary,
  savePromptLibrary,
  type PromptItem,
  type PromptLibraryFile,
  type PromptType,
} from "../api/prompts";

const TYPE_META: Record<PromptType, { label: string; icon: string; rootName: string }> = {
  image: { label: "图片", icon: "🖼️", rootName: "图片" },
  code: { label: "代码", icon: "{ }", rootName: "代码" },
  doc: { label: "文档", icon: "📄", rootName: "文档" },
  text: { label: "纯文本", icon: "📝", rootName: "纯文本" },
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
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newItem, setNewItem] = useState({
    title: "",
    prompt: "",
    outputType: "image" as PromptType,
    outputExample: "",
    relatedLink: "",
  });
  const [newOutputImageDataUrl, setNewOutputImageDataUrl] = useState<string | null>(null);

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

  const selectedItem = useMemo(
    () => filteredItems.find((x) => x.id === selectedItemId) ?? filteredItems[0] ?? null,
    [filteredItems, selectedItemId],
  );
  const isImageTab = activeType === "image";
  const imageColumns = useMemo(() => {
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

  function openCreateModal() {
    setShowCreate(true);
    resetCreateState();
  }

  async function onCreateItem() {
    const title = newItem.title.trim();
    const prompt = newItem.prompt.trim();
    const outputType = newItem.outputType;
    const outputExample = newItem.outputExample.trim();
    const relatedLink = newItem.relatedLink.trim();
    if (!title || !prompt) {
      setToast({ kind: "error", message: "请填写标题和 Prompt" });
      return;
    }
    if (outputType === "image" && !newOutputImageDataUrl) {
      setToast({ kind: "error", message: "请先粘贴图片输出示例" });
      return;
    }
    if (outputType !== "image" && !outputExample) {
      setToast({ kind: "error", message: "请先粘贴输出示例内容" });
      return;
    }
    const now = Date.now();
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
    setShowCreate(false);
    setActiveType(outputType);
    setActiveFolderId(outputType);
    setSelectedItemId(item.id);
    resetCreateState();
    setToast({ kind: "success", message: "已创建收藏" });
  }

  async function onDeleteItem(id: string) {
    const next = { ...library, items: library.items.filter((x) => x.id !== id) };
    await persist(next);
    setSelectedItemId(null);
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

  function switchType(t: PromptType) {
    setActiveType(t);
    setActiveFolderId(t);
    setSelectedItemId(null);
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
            <span className="search__icon">🔎</span>
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
        {isImageTab ? (
          <section className="prompt-lib__image-only">
            {filteredItems.length === 0 ? (
              <p className="muted">当前分类暂无收藏</p>
            ) : (
              <div className="prompt-lib__masonry">
                {imageColumns.map((columnItems, columnIndex) => (
                  <div key={`col-${columnIndex}`} className="prompt-lib__masonry-col">
                    {columnItems.map((item) => (
                      <article
                        key={item.id}
                        className={`prompt-lib__masonry-card${selectedItem?.id === item.id ? " active" : ""}`}
                        onClick={() => setSelectedItemId(item.id)}
                      >
                        {item.imageDataUrl ? (
                          <img src={item.imageDataUrl} alt={item.title} className="prompt-lib__masonry-image" />
                        ) : (
                          <div className="prompt-lib__masonry-fallback">暂无图片</div>
                        )}
                        <div className="prompt-lib__masonry-body">
                          <h3 className="prompt-lib__masonry-title" title={item.title}>
                            {item.title}
                          </h3>
                          <button
                            className="prompt-lib__masonry-copy"
                            onClick={(e) => {
                              e.stopPropagation();
                              void copyPrompt(item.prompt);
                            }}
                          >
                            复制 Prompt
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : (
          <aside className="prompt-lib__detail">
            {!selectedItem ? (
              <p className="muted">当前分类暂无收藏</p>
            ) : (
              <>
                <h3>{selectedItem.title}</h3>
                <div className="muted">Prompt</div>
                <pre className="prompt-lib__prompt">{selectedItem.prompt}</pre>
                <div className="muted">
                  输出类型：{TYPE_META[selectedItem.outputType ?? selectedItem.type].label}
                </div>
                {selectedItem.imageDataUrl ? (
                  <img
                    src={selectedItem.imageDataUrl}
                    alt="输出示例"
                    className="prompt-lib__detail-image"
                  />
                ) : (
                  <pre className="prompt-lib__prompt">{selectedItem.outputExample ?? "（空）"}</pre>
                )}
                {selectedItem.relatedLink ? (
                  <a href={selectedItem.relatedLink} target="_blank" rel="noreferrer">
                    相关链接
                  </a>
                ) : (
                  <p className="muted">相关链接：无</p>
                )}
                <div className="row">
                  <button onClick={() => void copyPrompt(selectedItem.prompt)}>复制 Prompt</button>
                  <button className="subtle" onClick={() => void onDeleteItem(selectedItem.id)}>
                    删除
                  </button>
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      {showCreate ? (
        <div className="prompt-create-modal-root">
          <div className="prompt-create-modal-backdrop" onClick={() => setShowCreate(false)} />
          <div className="prompt-create-modal">
            <h3>新建收藏</h3>
            <label className="prompt-create-modal__field">
              <span>标题</span>
              <input
                value={newItem.title}
                onChange={(e) => setNewItem((v) => ({ ...v, title: e.target.value }))}
                placeholder="例如：人物写实海报"
              />
            </label>
            <label className="prompt-create-modal__field">
              <span>Prompt</span>
              <textarea
                rows={5}
                value={newItem.prompt}
                onChange={(e) => setNewItem((v) => ({ ...v, prompt: e.target.value }))}
              />
            </label>
            <label className="prompt-create-modal__field">
              <span>输出物类型</span>
              <select
                value={newItem.outputType}
                onChange={(e) => {
                  const type = e.target.value as PromptType;
                  setNewItem((v) => ({ ...v, outputType: type, outputExample: "" }));
                  setNewOutputImageDataUrl(null);
                }}
              >
                {(Object.keys(TYPE_META) as PromptType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_META[t].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="prompt-create-modal__field">
              <span>输出示例（先选类型再粘贴）</span>
              {newItem.outputType === "image" ? (
                <>
                  <textarea
                    rows={3}
                    placeholder="在这里粘贴截图（⌘V / Ctrl+V）"
                    onPaste={(e) => void onPasteOutputExample(e)}
                  />
                  {newOutputImageDataUrl ? (
                    <img src={newOutputImageDataUrl} alt="已粘贴输出示例" className="prompt-lib__detail-image" />
                  ) : null}
                </>
              ) : (
                <textarea
                  rows={5}
                  value={newItem.outputExample}
                  onChange={(e) => setNewItem((v) => ({ ...v, outputExample: e.target.value }))}
                  placeholder="粘贴文本 / 代码 / 文档内容"
                />
              )}
            </label>
            <label className="prompt-create-modal__field">
              <span>相关链接</span>
              <input
                value={newItem.relatedLink}
                onChange={(e) => setNewItem((v) => ({ ...v, relatedLink: e.target.value }))}
                placeholder="https://..."
              />
            </label>
            <div className="row">
              <button className="primary" onClick={() => void onCreateItem()} disabled={saving}>
                创建收藏
              </button>
              <button
                onClick={() => {
                  setShowCreate(false);
                  resetCreateState();
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
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
