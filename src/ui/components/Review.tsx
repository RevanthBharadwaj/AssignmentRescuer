import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import type { ChangeProposal } from '../../core/types';
import { ENTITY_LABELS, FIELD_LABELS, FLAG_LABELS, errorMessage, formatValue } from '../format';
import { SourceTrace } from './SourceTrace';

const KIND_TEXT: Record<ChangeProposal['kind'], string> = {
  create: 'New',
  update: 'Changed since you last confirmed it',
  duplicate: 'Already saved (adds this source as evidence)',
  conflict: 'Your sources disagree',
};

const HIDDEN = new Set(['instructions', 'assignmentKey', 'citationText']);

export function Review() {
  const { service, version, refresh } = useApp();
  const { data: proposals, loading } = useAsync(() => service.repository.listProposals('pending'), [version]);
  const [busy, setBusy] = useState(false);

  if (loading && !proposals) return <p>Loading…</p>;
  const list = proposals ?? [];

  const approveSimple = async () => {
    setBusy(true);
    for (const p of list.filter((x) => (x.kind === 'create' || x.kind === 'duplicate') && x.candidate.flags.length === 0)) await service.approve(p.id);
    setBusy(false);
    refresh();
  };

  return (
    <section aria-labelledby="review-title">
      <h1 id="review-title">Review extracted information</h1>
      {list.length === 0 ? (
        <p className="muted">Nothing waiting for review.</p>
      ) : (
        <>
          <p className="muted">{list.length} item{list.length === 1 ? '' : 's'} waiting. Changes and conflicts always need your decision.</p>
          <button type="button" className="secondary" onClick={approveSimple} disabled={busy}>Approve all new items with no warnings</button>
          {list.map((p) => <ProposalCard key={p.id} p={p} />)}
        </>
      )}
    </section>
  );
}

function ProposalCard({ p }: { p: ChangeProposal }) {
  const { service, refresh } = useApp();
  const [choice, setChoice] = useState<Record<string, 'old' | 'new'>>({});
  const [error, setError] = useState<string | null>(null);
  const changed = new Set(p.changes.map((c) => c.field));
  const fields = Object.entries(p.candidate.fields).filter(([k]) => !HIDDEN.has(k) && !changed.has(k));

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const title = String(p.candidate.fields.title ?? p.candidate.fields.name ?? p.candidate.fields.criterion ?? p.candidate.fields.code ?? p.key);
  return (
    <article className={`card proposal ${p.kind}`} aria-label={`${ENTITY_LABELS[p.entityType]}: ${title}`}>
      <header>
        <span className="tag">{ENTITY_LABELS[p.entityType]}</span>
        <span className={`tag kind-${p.kind}`}>{KIND_TEXT[p.kind]}</span>
        <h3>{title}</h3>
      </header>

      {p.candidate.flags.length > 0 && (
        <ul className="flags">{p.candidate.flags.map((f) => <li key={f}>{FLAG_LABELS[f] ?? f}</li>)}</ul>
      )}

      {p.changes.length > 0 && (
        <table className="changes">
          <thead><tr><th>Field</th><th>{p.kind === 'conflict' ? 'First source' : 'Saved value'}</th><th>{p.kind === 'conflict' ? 'Second source' : 'New value'}</th></tr></thead>
          <tbody>
            {p.changes.map((c) => (
              <tr key={c.field}>
                <th scope="row">{FIELD_LABELS[c.field] ?? c.field}</th>
                <td><label><input type="radio" name={`${p.id}-${c.field}`} checked={(choice[c.field] ?? 'new') === 'old'} onChange={() => setChoice({ ...choice, [c.field]: 'old' })} /> {formatValue(c.oldValue)}</label></td>
                <td><label><input type="radio" name={`${p.id}-${c.field}`} checked={(choice[c.field] ?? 'new') === 'new'} onChange={() => setChoice({ ...choice, [c.field]: 'new' })} /> {formatValue(c.newValue)}</label></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <dl className="fields">
        {fields.map(([k, v]) => (
          <div key={k} className={v === null ? 'unknown' : ''}><dt>{FIELD_LABELS[k] ?? k}</dt><dd>{formatValue(v)}</dd></div>
        ))}
      </dl>

      <SourceTrace provenance={[p.candidate.provenance, ...p.alternatives.map((a) => a.provenance)]} />

      <div className="row">
        <button type="button" onClick={() => act(() => service.approve(p.id, choice))}>{p.kind === 'duplicate' ? 'Confirm' : 'Approve'}</button>
        <button type="button" className="secondary" onClick={() => act(() => service.reject(p.id))}>Reject</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </article>
  );
}
