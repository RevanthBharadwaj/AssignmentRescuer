import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import type { Sticky } from '../../core/service';

const COLORS: Sticky['color'][] = ['yellow', 'green', 'blue', 'pink', 'orange'];

/** Sticky notes. Everything on Home; on a course or an assignment page only the notes for it (and new ones attach to it). */
export function Stickies({ courseCode = null, assignmentId = null, title = 'Sticky notes' }: { courseCode?: string | null; assignmentId?: string | null; title?: string }) {
  const { service, version, refresh, toast } = useApp();
  const { data } = useAsync(async () => ({ notes: await service.stickies(), courses: await service.repository.listRecords('course') }), [version]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!data) return null;
  const shown = data.notes.filter((n) => assignmentId ? n.assignmentId === assignmentId : courseCode ? n.courseCode === courseCode : true);
  const add = async () => { await service.saveSticky({ courseCode, assignmentId }); refresh(); };

  return (
    <section aria-labelledby={`stk-${assignmentId ?? courseCode ?? 'all'}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id={`stk-${assignmentId ?? courseCode ?? 'all'}`}>{title}</h2>
        <button type="button" className="secondary" onClick={add}>+ New note</button>
      </div>
      {shown.length === 0 ? <p className="muted small">Jot down anything: a thought for a paper, a question for the professor, a reminder to yourself.</p> : (
        <div className="stickies">
          {shown.map((n) => (
            <div key={n.id} className={`sticky ${n.color}`}>
              <textarea
                aria-label="Sticky note text"
                value={draft[n.id] ?? n.text}
                placeholder="Write here…"
                onChange={(e) => setDraft({ ...draft, [n.id]: e.target.value })}
                onBlur={async () => { if (draft[n.id] !== undefined && draft[n.id] !== n.text) { await service.saveSticky({ id: n.id, text: draft[n.id] }); refresh(); } }}
              />
              <div className="sticky-tools">
                {COLORS.map((c) => <button key={c} type="button" className={`sw sticky ${c}`} style={{ boxShadow: 'none', transform: 'none', padding: 0, minHeight: 0 }} aria-label={`Make this note ${c}`} onClick={async () => { await service.saveSticky({ id: n.id, color: c }); refresh(); }} />)}
                {!assignmentId && (
                  <select aria-label="Attach this note to a course" value={n.courseCode ?? ''} onChange={async (e) => { await service.saveSticky({ id: n.id, courseCode: e.target.value || null }); refresh(); }}>
                    <option value="">No course</option>
                    {data.courses.map((c) => <option key={c.id} value={String(c.fields.code)}>{String(c.fields.code)}</option>)}
                  </select>
                )}
                <button type="button" className="link" aria-label="Delete this note" onClick={async () => { const before = await service.deleteSticky(n.id); refresh(); toast('Note deleted', async () => { await service.restoreStickies(before); refresh(); }); }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
