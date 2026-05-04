import { invoke } from "@tauri-apps/api/core";

export type PromptType = "image" | "code" | "doc" | "text";

export type PromptFolder = {
  id: string;
  name: string;
  parentId: string | null;
};

export type PromptItem = {
  id: string;
  type: PromptType;
  title: string;
  prompt: string;
  outputType?: PromptType;
  outputExample?: string;
  relatedLink?: string | null;
  imageDataUrl?: string | null;
  tags: string[];
  note?: string;
  folderId: string;
  createdAt: number;
  updatedAt: number;
};

export type PromptLibraryFile = {
  version: number;
  folders: PromptFolder[];
  items: PromptItem[];
};

export async function getPromptLibrary(): Promise<PromptLibraryFile> {
  return invoke<PromptLibraryFile>("get_prompt_library");
}

export async function savePromptLibrary(library: PromptLibraryFile): Promise<void> {
  await invoke("save_prompt_library", { library });
}
