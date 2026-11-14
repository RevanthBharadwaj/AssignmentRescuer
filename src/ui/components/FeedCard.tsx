import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import { errorMessage } from '../format';
import { fetchFeed } from '../feedFetcher';

/** Show a feed link without exposing the private token in it. */
export function maskFeedUrl(url: string): string {
  try {
    const u = new URL(url);
    const file = u.pathname.split('/').pop() ?? '';
    return `${u.host}/…${file.slice(-8)}`;
  } catch {
    return '…';
  }
}

export function FeedCard({ compact = false }: { compact?: boolean }) {
  const { service, version, refresh, toast, go } = useApp();
  const { data: feed } = useAsync(() => service.calendarFeed(), [version]);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sync = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await service.syncCalendarFeed(fetchFeed);
      refresh();
      toast(`Calendar synced: ${r.newItems} new, ${r.changedItems} changed, ${r.unchanged} already saved`);
      if (r.newItems + r.changedItems > 0) go({ name: 'review' });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (feed === undefined) return null;
  const showForm = !feed || editing;

  if (compact) {
    return feed ? (
      <div className="feed-compact">
        <span className="muted small">{feed.lastSyncedAt ? `Feed synced ${new Date(feed.lastSyncedAt).toLocaleString()}` : 'Feed not synced yet'}</span>
        <button type="button" className="secondary" disabled={busy} onClick={sync}>{busy ? 'Syncing…' : 'Sync calendar feed'}</button>
        {error && <span role="alert" className="error small">{error}</span>}
      </div>
    ) : (
      <button type="button" className="link" onClick={() => go({ name: 'setup' })}>connect your Canvas calendar feed →</button>
    );
  }

  return (
    <>
      {feed && !showForm ? (
        <>
          <dl className="saved-values">
            <div><dt>Feed</dt><dd className="mono small">{maskFeedUrl(feed.url)}</dd></div>
            <div><dt>Last sync</dt><dd className={feed.lastSyncedAt ? '' : 'none'}>{feed.lastSyncedAt ? new Date(feed.lastSyncedAt).toLocaleString() : 'Not synced yet'}</dd></div>
            <div><dt>Result</dt><dd className={feed.lastResult ? '' : 'none'}>{feed.lastResult ?? '—'}</dd></div>
          </dl>
          <div className="row">
            <button type="button" disabled={busy} onClick={sync}>{busy ? 'Syncing…' : 'Sync now'}</button>
            <button type="button" className="modify" onClick={() => { setUrl(''); setEditing(true); }}>Modify</button>
            <button type="button" className="link muted-link" onClick={async () => { await service.saveCalendarFeed(null); refresh(); }}>remove</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">In Canvas, open <strong>Calendar</strong>, click <strong>Calendar Feed</strong> at the bottom right, and copy the link. It is private: it stays on this computer and is only used when you press Sync.</p>
          <label>Calendar feed link
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://school.instructure.com/feeds/calendars/user_….ics" autoComplete="off" spellCheck={false} />
          </label>
          <div className="row">
            <button type="button" disabled={!/^https:\/\/\S+\.\S+/.test(url.trim())} onClick={async () => {
              await service.saveCalendarFeed(url);
              setEditing(false);
              refresh();
              await sync();
            }}>Save and sync</button>
            {editing && <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>}
          </div>
        </>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </>
  );
}
