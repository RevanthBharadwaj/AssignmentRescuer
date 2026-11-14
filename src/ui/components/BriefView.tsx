import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import { briefToText } from '../../core/brief';

/** What the student needs before starting one assignment, in four blocks, each line with its source. */
export function BriefView({ id }: { id: string }) {
  const { service, version, go } = useApp();
  const { data: brief } = useAsync(() => service.briefFor(id), [version, id]);
  const [copied, setCopied] = useState(false);
  if (!brief) return <p className="muted">Loading…</p>;
  return (
    <div className="brief">
      <p className="muted">Everything the course says about this assignment, gathered once. Adding the same material again does not repeat anything here.</p>
      <div className="brief-grid">
        {brief.blocks.map((b, i) => (
          <section key={b.id} className={`card brief-block b-${b.id} stagger`} style={{ ['--i' as string]: i }} aria-label={b.title}>
            <h2>{b.title}</h2>
            {b.lines.length === 0 ? <p className="muted small">{b.empty}</p> : (
              <ul>
                {b.lines.map((l, j) => (
                  <li key={j}>
                    <span>{l.text}</span>
                    {l.source && <span className="muted small src">{l.source}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <div className="row">
        <button type="button" className="chat-btn" onClick={() => go({ name: 'chat', code: brief.courseCode, assignmentId: id })}>Work on this in Chat →</button>
        <button type="button" className="secondary" onClick={async () => {
          try { await navigator.clipboard.writeText(briefToText(brief)); setCopied(true); } catch { setCopied(false); }
        }}>{copied ? 'Copied' : 'Copy the brief'}</button>
      </div>
    </div>
  );
}
