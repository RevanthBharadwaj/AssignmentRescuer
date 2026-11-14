import { useState } from 'react';
import { useApp } from '../AppContext';
import { errorMessage } from '../format';
import { completeAi } from '../aiClient';
import type { DraftCheck, DraftGap } from '../../core/draftCheck';

type Result = DraftCheck & { ai: { gaps: DraftGap[]; strengths: string[]; model: string } | null };

/** Paste a draft; see what the brief and rubric ask for that is not there yet. It points things out and never rewrites. */
export function DraftCheckView({ id }: { id: string }) {
  const { service } = useApp();
  const [text, setText] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (withAi: boolean) => {
    setBusy(true); setError(null);
    try { setRes(await service.checkMyDraft(id, text, withAi ? completeAi : null)); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="draft-title">
      <h2 id="draft-title">Check my draft</h2>
      <p className="muted">Paste your draft. This compares it with the brief, the rubric and what earlier similar work in the course asked for. It points things out and leaves the writing to you.</p>
      <label htmlFor="draft-text" className="muted">Your draft</label>
      <textarea id="draft-text" rows={10} value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%' }} />
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={() => run(false)}>Check with rules (free)</button>
        <button type="button" className="btn" disabled={busy || !text.trim()} onClick={() => run(true)}>Also ask Claude what is missing</button>
      </div>
      {busy && <p className="muted" role="status">Checking…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {res && (
        <div aria-live="polite" style={{ marginTop: 16 }}>
          <h3>Length</h3>
          <p>
            {res.words} words.{' '}
            {res.length === 'unknown' ? 'No word limit is saved for this assignment, and earlier similar work gave none.' : res.length === 'ok' ? `Within the limit (${res.limit.min ?? 0} to ${res.limit.max ?? 'no maximum'}, from ${res.limit.from}).` : res.notes[0]}
          </p>
          <h3>Citations</h3>
          <p>{res.citations.required ? `In text citations found: ${res.citations.inText}. References section: ${res.citations.hasReferences ? 'yes' : 'no'}.` : 'No citations are required here.'}</p>
          {res.citations.notes.length > 0 && <ul>{res.citations.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          {res.rubric.length > 0 && (
            <>
              <h3>Rubric</h3>
              <ul>{res.rubric.map((r) => <li key={r.criterion}>{r.criterion}{r.maxPoints !== null ? ` (${r.maxPoints} pts)` : ''}: {r.covered === 'likely' ? 'looks covered' : 'not clearly covered yet'}</li>)}</ul>
              <p className="muted">This is a keyword match, not a grade.</p>
            </>
          )}
          {res.ai && (
            <>
              <h3>What Claude noticed ({res.ai.model})</h3>
              {res.ai.gaps.length === 0 ? <p>No gaps found.</p> : <ul>{res.ai.gaps.map((g, i) => <li key={i}><strong>{g.criterion || 'Requirement'}:</strong> {g.point}</li>)}</ul>}
              {res.ai.strengths.length > 0 && <ul>{res.ai.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
