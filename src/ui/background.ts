import { isTauri } from '../db/open';
import type { ScheduledEmail } from '../core/schedule';

/**
 * Reminders when the app is closed: the desktop app saves the coming emails and
 * installs a job the computer runs every 15 minutes (see src-tauri/src/reminders.rs).
 */
let active = false;

/** True once the job is installed, so the open app does not send the same emails twice. */
export const backgroundActive = (): boolean => active;

export async function syncBackground(gmail: string, to: string, hour: number, items: ScheduledEmail[]): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    await invoke('reminders_sync', { plan: { gmail, to, hour, items: items.map((i) => ({ id: i.id, send_on: i.sendOn, subject: i.subject, body: i.body })), sent: [] } });
    active = true;
  } catch (e) {
    active = false;
    throw e;
  }
}

export async function stopBackground(): Promise<void> {
  active = false;
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  if (await invoke<boolean>('reminders_installed')) await invoke('reminders_off');
}
