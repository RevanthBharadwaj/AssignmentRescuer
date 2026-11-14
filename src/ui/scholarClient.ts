import { isTauri } from '../db/open';
import type { Fetcher } from '../core/scholar';

/** Scholarly catalogues are reached by the desktop app (a browser blocks cross-site requests). */
export const scholarGet: Fetcher = async (url) => {
  if (!isTauri()) throw new Error('Source lookup works in the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('scholar_get', { url });
};
