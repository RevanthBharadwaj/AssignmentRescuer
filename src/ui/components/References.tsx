import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import { apaSegments, apaText, inText, type Work } from '../../core/scholar';

export function Reference({ w, assignmentId, saved, onSaved }: { w: Work; assignmentId: string; saved: boolean; onSaved: () => void }) {
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

/** Sources a chat tool found, as APA references the student can copy or keep with an assignment. */
export function FoundSources({ works, assignmentId }: { works: Work[]; assignmentId: string }) {
  const { service, version, refresh } = useApp();
  const { data: saved } = useAsync(async () => {
    const a = assignmentId ? (await service.repository.listRecords('assignment')).find((r) => r.id === assignmentId) : null;
    return a ? await service.referencesFor(a.key) : [];
  }, [assignmentId, version]);
  const savedKeys = new Set((saved ?? []).map((n) => String(n.fields.title)));
  return <ul className="works">{works.map((w) => <Reference key={w.doi ?? w.title} w={w} assignmentId={assignmentId} saved={savedKeys.has(w.title)} onSaved={refresh} />)}</ul>;
}

/** References already kept with the chosen assignment; the chat may cite only these. */
export function SavedSources({ assignmentId }: { assignmentId: string }) {
  const { service, version } = useApp();
  const { data: saved } = useAsync(async () => {
    const a = assignmentId ? (await service.repository.listRecords('assignment')).find((r) => r.id === assignmentId) : null;
    return a ? await service.referencesFor(a.key) : [];
  }, [assignmentId, version]);
  if (!saved || saved.length === 0) return null;
  return (
    <details className="saved-sources">
      <summary>Sources saved for this assignment ({saved.length})</summary>
      <ul className="works">{saved.map((n) => <li key={n.id} className="work"><p className="apa">{String(n.fields.summary)}</p><p className="muted small">In your text: <code>{(n.fields.actions as string[])[0]}</code></p></li>)}</ul>
    </details>
  );
}
