import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import { errorMessage } from '../format';
import { completeAi } from '../aiClient';
import type { Suggestion } from '../../core/review';

/** Mistakes and gaps found in the semester. Nothing changes until you press the button, and every change can be undone. */
export function Suggestions() {
  const { service, version, refresh, toast, go } = useApp();
  const { data } = useAsync(async () => ({ list: await service.suggestions(), undo: await service.undoList() }), [version]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const apply = async (s: Suggestion) => {
    try {
      const r = await service.applySuggestion(s);
      if (r.open) {
        if (r.open.target === 'assignment') go({ name: 'assignment', id: r.open.id, section: 'overview' });
        else if (r.open.target === 'course_add') go({ name: 'course', code: r.open.id, tab: 'add' });
        else go({ name: 'setup' });
        return;
      }
      refresh();
      const id = r.undoId;
      toast(s.fix.label, id ? async () => { await service.undo(id); refresh(); } : undefined);
    } catch (e) { setError(errorMessage(e)); }
  };

  const review = async () => {
    setBusy(true); setError(null); setNote(null);
    try {
      const r = await service.aiReview(completeAi);
      setNote(r.added ? `${r.added} new suggestion${r.added === 1 ? '' : 's'} added.` : 'The AI found nothing new.');
      refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  if (!data) return null;
  return (
    <section aria-labelledby="sugg-title" style={{ marginBottom: 32 }}>
      <h2 id="sugg-title">Suggestions</h2>
      <p className="muted">Checked on plain rules, free. Nothing changes until you approve it, and you can undo it.</p>
      <div className="row"><button type="button" className="btn" disabled={busy} onClick={review}>Ask AI to compare my course material</button></div>
      {busy && <p className="muted" role="status">Reading your course material…</p>}
      {note && <p role="status">{note}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {data.list.length === 0 ? <p>No suggestions. Everything looks consistent.</p> : (
        <ul className="plain">
          {data.list.map((s) => (
            <li key={s.id} className="card" style={{ marginBottom: 8 }}>
              <strong>{s.title}</strong> <span className="chip">{s.by === 'ai' ? 'AI' : 'rule'}</span>
              <p className="muted">{s.detail}</p>
              <div className="row">
                <button type="button" className="btn primary" onClick={() => apply(s)}>{s.fix.label}</button>
                <button type="button" className="btn" onClick={async () => { await service.dismissSuggestion(s.id); refresh(); }}>Dismiss</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data.undo.length > 0 && (
        <>
          <h3>Recent changes you can undo</h3>
          <ul className="plain">
            {[...data.undo].reverse().slice(0, 8).map((u) => (
              <li key={u.id}>{u.label} <button type="button" className="link" onClick={async () => { await service.undo(u.id); refresh(); toast(`Undone: ${u.label}`); }}>Undo</button></li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
