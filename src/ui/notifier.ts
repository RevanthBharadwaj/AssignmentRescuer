import { isTauri } from '../db/open';

/** Reminder delivery. Both go through Rust; the browser preview can do neither. */
export async function sendEmail(from: string, to: string, subject: string, body: string): Promise<void> {
  if (!isTauri()) throw new Error('Emails are sent by the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('send_email', { from, to, subject, body });
}

export async function notifyDesktop(title: string, body: string): Promise<void> {
  if (!isTauri()) throw new Error('Notifications are shown by the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('notify_desktop', { title, body });
}
