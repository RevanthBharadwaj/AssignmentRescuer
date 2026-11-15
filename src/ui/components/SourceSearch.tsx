import { useMemo, useState } from 'react';
import type { CourseSource } from '../../core/courseContent';
import { searchSources } from '../../core/search';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function Marked({ text, terms }: { text: string; terms: string[] }) {
  const re = new RegExp(`(${terms.map(esc).join('|')})`, 'ig');
  return <>{text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part))}</>;
}

/** Search the words inside everything imported, PDFs included. */
export function SourceSearch({ sources }: { sources: CourseSource[] }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => searchSources(sources, q), [sources, q]);
  return (
    <div className="card compact" role="search" aria-label="Search imported material">
      <label htmlFor="src-search" className="label">Search inside your files</label>
      <input id="src-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="a word from a PDF, or “an exact phrase”" style={{ width: '100%' }} />
      {q.trim() && (
        hits.length === 0 ? <p className="muted">Nothing matches. Scanned PDFs have no text to search; photos and scans are not readable yet.</p> : (
          <ul className="plain" aria-label="Search results">
            {hits.map((h) => (
              <li key={h.sourceId} style={{ marginTop: 10 }}>
                <strong>{h.name}</strong>
                <span className="muted small"> · {h.course ?? 'no course'}{h.page ? ` · page ${h.page}` : ''}</span>
                <div className="small"><Marked text={h.snippet} terms={h.terms} /></div>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
