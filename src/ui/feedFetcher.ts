import { isTauri } from '../db/open';
import type { FeedFetcher } from '../core/service';

/** Calendar feeds are downloaded by the desktop app (a browser blocks cross-site requests). */
export const fetchFeed: FeedFetcher = async (url) => {
  if (!isTauri()) throw new Error('Syncing a calendar feed works in the desktop app. In the browser preview, download the .ics file and drop it on a course instead.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('fetch_calendar_feed', { url });
};
