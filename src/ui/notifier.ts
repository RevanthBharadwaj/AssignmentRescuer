import { isTauri } from '../db/open';

/** Reminder delivery. Both go through Rust; the browser preview can do neither. */
export async function sendSms(sid: string, from: string, to: string, body: string): Promise<void> {
  if (!isTauri()) throw new Error('Texts are sent by the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('send_sms', { sid, from, to, body });
}

export async function notifyDesktop(title: string, body: string): Promise<void> {
  if (!isTauri()) throw new Error('Notifications are shown by the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('notify_desktop', { title, body });
}
