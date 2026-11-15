import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';

/** The bell in the top bar: what is overdue, due today or soon, and what waits for your review. */
export function Notifications() {
  const { service, version, today, go, refresh } = useApp();
  const { data } = useAsync(() => service.notices(today), [version, today]);
  const [open, setOpen] = useState(false);
  const list = data ?? [];
  return (
    <div className="notif">
      <button type="button" className="notif-btn" aria-label={`Notifications${list.length ? `, ${list.length} new` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">🔔</span>
        {list.length > 0 && <span className="notif-badge">{list.length > 9 ? '9+' : list.length}</span>}
      </button>
      {open && (
        <div className="notif-pop" role="dialog" aria-label="Notifications">
          {list.length === 0 ? <p className="muted small">You are all caught up.</p> : (
            <>
              <ul>
                {list.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={async () => { await service.markNoticesRead([n.id]); setOpen(false); refresh(); go(n.route); }}>
                      <span className={`notif-dot ${n.tone}`} aria-hidden="true" />
                      <span>{n.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="link small" onClick={async () => { await service.markNoticesRead(list.map((n) => n.id)); refresh(); }}>Mark all as read</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
