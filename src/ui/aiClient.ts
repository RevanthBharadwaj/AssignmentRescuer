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

/** Search by meaning with a local embedding model (Ollama on this computer). */
export async function embedAi(model: string, baseUrl: string, texts: string[]): Promise<number[][]> {
  if (!isTauri()) throw new Error('Search by meaning works in the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<number[][]>('ai_embed', { model, baseUrl, texts });
}

/** Read a screenshot or photo with a local vision model; the picture stays on this computer. */
export async function describeImage(model: string, baseUrl: string, bytes: Uint8Array, instruction: string): Promise<string> {
  if (!isTauri()) throw new Error('Reading images works in the desktop app.');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('ai_describe_image', { model, baseUrl, imageBase64: btoa(bin), instruction });
}
