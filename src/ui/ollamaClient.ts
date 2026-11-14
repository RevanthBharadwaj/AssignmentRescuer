import { isTauri } from '../db/open';

/** Downloading free models through the Ollama app on this computer (see src-tauri/src/ollama.rs). */
export const canDownload = (): boolean => isTauri();

export interface PullProgress { model: string; status: string; completed: number; total: number }

/** Models already on this computer, or null when Ollama is not reachable (or this is the browser preview). */
export async function installedModels(baseUrl: string): Promise<string[] | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string[]>('ollama_list', { baseUrl });
  } catch {
    return null;
  }
}

/** Download one model. Resolves when it is on this computer; rejects with a plain message. */
export async function pullModel(baseUrl: string, model: string, onProgress: (p: PullProgress) => void): Promise<void> {
  if (!isTauri()) throw new Error('Downloads are done by the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const off = await listen<PullProgress>('ollama-pull', (e) => { if (e.payload.model === model) onProgress(e.payload); });
  try {
    await invoke('ollama_pull', { baseUrl, model });
  } finally {
    off();
  }
}
