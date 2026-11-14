import { isTauri } from '../db/open';

/** Saves a Word file: into Downloads in the desktop app, as a normal download in the browser preview. */
export async function saveDocx(name: string, bytes: Uint8Array): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('save_download', { name, bytes: Array.from(bytes) });
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return `Downloads/${name}`;
}
