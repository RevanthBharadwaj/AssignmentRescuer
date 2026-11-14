import { isTauri } from '../db/open';
import type { Completer } from '../core/ai';

/** AI requests go through the desktop app's Rust layer (keychain key, no CORS). */
export const completeAi: Completer = async (req) => {
  if (!isTauri()) throw new Error('The AI assistant works in the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('ai_complete', {
    provider: req.provider, model: req.model, system: req.system, prompt: req.prompt,
    baseUrl: req.baseUrl ?? null, history: req.history ?? null, jsonMode: req.json ?? true,
  });
};

export type KeyKind = 'anthropic' | 'openai' | 'twilio';

export async function setSecret(kind: KeyKind, key: string | null): Promise<void> {
  if (!isTauri()) throw new Error('Keys are stored by the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('ai_set_key', { provider: kind, key });
}

export async function hasSecret(kind: KeyKind): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<boolean>('ai_has_key', { provider: kind });
}

/** Kept for the AI settings card. */
export const setAnthropicKey = (key: string | null) => setSecret('anthropic', key);
export const hasAnthropicKey = () => hasSecret('anthropic');
