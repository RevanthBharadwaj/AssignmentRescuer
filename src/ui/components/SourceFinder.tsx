import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import { apaSegments, apaText, extractDoi, inText, searchWorks, verifyDoi, type Work } from '../../core/scholar';
import { scholarGet } from '../scholarClient';
import { errorMessage } from '../format';

function Reference({ w, assignmentId, saved, onSaved }: { w: Work; assignmentId: string; saved: boolean; onSaved: () => void }) {
  const { service, toast } = useApp();
  return (
    <li className="work">
      <p className="apa">{apaSegments(w).map((s, i) => (s.italic ? <i key={i}>{s.text}</i> : <span key={i}>{s.text}</span>))}</p>
      <p className="muted small">In your text: <code>{inText(w)}</code> · {w.doi ? `DOI found in ${w.from === 'crossref' ? 'Crossref' : 'OpenAlex'}` : 'no DOI; check the source before citing'}</p>
      <div className="row">
        <button type="button" className="secondary small" onClick={() => { void navigator.clipboard?.writeText(apaText(w)); toast('Reference copied'); }}>Copy reference</button>
        <button type="button" className="secondary small" onClick={() => { void navigator.clipboard?.writeText(inText(w)); toast('Citation copied'); }}>Copy citation</button>
        <button type="button" className="small" disabled={!assignmentId || saved} title={assignmentId ? '' : 'Choose an assignment above first'} onClick={async () => { await service.saveReference(assignmentId, w); onSaved(); toast('Saved with the assignment'); }}>{saved ? 'Saved' : 'Save with this assignment'}</button>
      </div>
    </li>
  );
}

/** Find real papers, check a DOI, and keep verified APA references with an assignment. */
export function SourceFinder({ assignmentId }: { assignmentId: string }) {
  const { service, version, refresh } = useApp();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [works, setWorks] = useState<Work[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { data: saved } = useAsync(async () => {
    const a = assignmentId ? (await service.repository.listRecords('assignment')).find((r) => r.id === assignmentId) : null;
    return a ? await service.referencesFor(a.key) : [];
  }, [assignmentId, version]);
  const savedKeys = new Set((saved ?? []).map((n) => String(n.fields.title)));

  const go = async () => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true); setNote(null); setWorks(null);
    try {
      const doi = extractDoi(text);
      if (doi) {
        const w = await verifyDoi(doi, scholarGet);
        if (!w) { setNote(`No record for ${doi} in Crossref. Check the DOI for typos; do not cite it until you find the real paper.`); setWorks([]); }
        else { setWorks([w]); setNote('This DOI is real. Check the details below against the paper.'); }
      } else {
        const r = await searchWorks(text, scholarGet);
        setWorks(r.works);
        setNote(r.works.length === 0 ? 'Nothing found. Try fewer or different keywords.' : r.notes.length ? r.notes.join(' · ') : null);
      }
    } catch (e) { setNote(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <details className="source-finder">
      <summary>Find real sources and APA references</summary>
      <p className="muted small">Searches Crossref and OpenAlex (free) with only the words you type. Paste a DOI to check it is real. Saved sources are the only ones the chat will cite.</p>
      <div className="row">
        <input aria-label="Search sources" value={q} placeholder="topic, title, author, or a DOI" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void go(); }} />
        <button type="button" disabled={busy || !q.trim()} onClick={() => void go()}>{busy ? 'Searching…' : 'Search'}</button>
      </div>
      {note && <p className="small" role="status">{note}</p>}
      {works && works.length > 0 && <ul className="works">{works.map((w) => <Reference key={w.doi ?? w.title} w={w} assignmentId={assignmentId} saved={savedKeys.has(w.title)} onSaved={refresh} />)}</ul>}
      {saved && saved.length > 0 && (
        <>
          <h3>Saved for this assignment</h3>
          <ul className="works">{saved.map((n) => <li key={n.id} className="work"><p className="apa">{String(n.fields.summary)}</p><p className="muted small">In your text: <code>{(n.fields.actions as string[])[0]}</code></p></li>)}</ul>
        </>
      )}
    </details>
  );
}
