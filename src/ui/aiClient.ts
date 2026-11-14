import { isTauri } from '../db/open';
import type { Completer } from '../core/ai';

/** AI requests go through the desktop app's Rust layer (keychain key, no CORS). */
export const completeAi: Completer = async (req) => {
  if (!isTauri()) throw new Error('The AI assistant works in the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('ai_complete', { provider: req.provider, model: req.model, system: req.system, prompt: req.prompt, baseUrl: req.baseUrl ?? null });
};

export async function setAnthropicKey(key: string | null): Promise<void> {
  if (!isTauri()) throw new Error('API keys are stored by the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('ai_set_key', { key });
}

export async function hasAnthropicKey(): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<boolean>('ai_has_key');
}
