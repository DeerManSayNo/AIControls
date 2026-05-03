import { useSyncExternalStore } from "react";

const STORAGE_KEY = "aicontrols:projectPaths";
const LEGACY_KEY = "aicontrols:lastProjectPath";
const CHANGE_EVENT = "aicontrols:project-paths-changed";

let migrated = false;

/** 空列表单例，避免 useSyncExternalStore 每次得到新 [] 导致无限重渲 */
const EMPTY_PATHS: string[] = [];

/** 与 sessionStorage 内容同步的缓存，保证 getSnapshot 在数据未变时返回同一引用 */
let cachedStorageRaw: string | null = null;
let cachedPaths: string[] = EMPTY_PATHS;

export function normalizeProjectPath(p: string): string {
  return p.trim().replace(/[/\\]+$/, "");
}

function migrateLegacyOnce(): void {
  if (migrated || typeof sessionStorage === "undefined") return;
  migrated = true;
  try {
    if (sessionStorage.getItem(STORAGE_KEY)) return;
    const legacy = sessionStorage.getItem(LEGACY_KEY);
    if (legacy) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify([legacy]));
      sessionStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function readProjectPaths(): string[] {
  migrateLegacyOnce();
  if (typeof sessionStorage === "undefined") return EMPTY_PATHS;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY) ?? "";
    if (raw === cachedStorageRaw) {
      return cachedPaths;
    }
    cachedStorageRaw = raw;
    if (!raw) {
      cachedPaths = EMPTY_PATHS;
      return cachedPaths;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      cachedPaths = EMPTY_PATHS;
      return cachedPaths;
    }
    const next = parsed.filter(
      (x): x is string => typeof x === "string" && x.length > 0,
    );
    cachedPaths = next.length === 0 ? EMPTY_PATHS : next;
    return cachedPaths;
  } catch {
    cachedStorageRaw = null;
    cachedPaths = EMPTY_PATHS;
    return cachedPaths;
  }
}

export function pathsReferToSameDir(a: string, b: string): boolean {
  return normalizeProjectPath(a) === normalizeProjectPath(b);
}

/** 追加项目路径；若已存在（路径等价）则不变。返回当前完整列表。 */
export function appendProjectPath(path: string): string[] {
  migrateLegacyOnce();
  const trimmed = path.trim();
  if (!trimmed || typeof sessionStorage === "undefined") return readProjectPaths();

  const paths = readProjectPaths();
  const n = normalizeProjectPath(trimmed);
  if (paths.some((p) => pathsReferToSameDir(p, trimmed))) {
    return paths;
  }

  const next = [...paths, trimmed];
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return paths;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return next;
}

function subscribe(onChange: () => void): () => void {
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function useProjectPaths(): string[] {
  return useSyncExternalStore(subscribe, readProjectPaths, readProjectPaths);
}
