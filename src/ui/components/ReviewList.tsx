import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import type { ChangeProposal, ConfirmedRecord } from '../../core/types';
import { ENTITY_LABELS, FIELD_LABELS, FLAG_LABELS, dateFromInputs, errorMessage, formatDate, formatValue, isAcademicDate } from '../format';
import { SourceTrace } from './SourceTrace';

/**
 * Review of extracted items. New items are shown as a compact checklist
 * (approve many at once, fill in a missing date inline). Changes and
 * disagreements between sources get a full card with old and new values.
 */

const BLOCKING = new Set(['possible_prompt_injection', 'course_unassigned', 'course_mismatch']);
const HIDDEN = new Set(['instructions', 'assignmentKey', 'citationText']);

function titleOf(p: ChangeProposal): string {
  const f = p.candidate.fields;
  return String(f.title ?? f.name ?? f.criterion ?? f.code ?? p.key);
}

function whenOf(p: ChangeProposal): string {
  const f = p.candidate.fields;
  const d = f.dueDate ?? f.date ?? f.startDate ?? null;
  if (isAcademicDate(d)) return formatDate(d);
  if (typeof f.dueNote === 'string') return f.dueNote;
  return '';
}

function typeOf(p: ChangeProposal): string {
  const f = p.candidate.fields;
  if (p.entityType === 'course_material') return String(f.kind ?? 'material').replace('_', ' ');
  if (p.entityType === 'assignment') return String(f.type ?? 'assignment').replace('_', ' ');
  if (p.entityType === 'timeline_event') return String(f.kind ?? 'item');
  return ENTITY_LABELS[p.entityType]?.toLowerCase() ?? p.entityType;
}

export function ReviewList({ proposals, emptyText }: { proposals: ChangeProposal[]; emptyText?: string }) {
  const { service, refresh } = useApp();
  const simple = proposals.filter((p) => p.kind === 'create' || p.kind === 'duplicate');
  const complex = proposals.filter((p) => p.kind === 'update' || p.kind === 'conflict');

  const defaultChecked = useMemo(
    () => new Set(simple.filter((p) => !p.candidate.flags.some((f) => BLOCKING.has(f))).map((p) => p.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proposals],
  );
  const [checked, setChecked] = useState<Set<string>>(defaultChecked);
  useEffect(() => setChecked(defaultChecked), [defaultChecked]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (proposals.length === 0) return <p className="muted">{emptyText ?? 'Nothing waiting for review.'}</p>;

  const toggle = (id: string) => setChecked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const approveSelected = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const p of simple.filter((x) => checked.has(x.id))) {
        const rec: ConfirmedRecord = await service.approve(p.id);
        const typed = dates[p.id] ? dateFromInputs(dates[p.id], '', '') : null;
        if (typed) await service.repository.correctRecord(rec.id, p.entityType === 'assignment' ? { dueDate: typed } : { date: typed });
      }
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const rejectSelected = async () => {
    setBusy(true);
    for (const p of simple.filter((x) => checked.has(x.id))) await service.reject(p.id);
    setBusy(false);
    refresh();
  };

  // Dated items first in date order, then by unit and title.
  const order = (p: ChangeProposal) => {
    const f = p.candidate.fields;
    const d = f.dueDate ?? f.date ?? null;
    const iso = isAcademicDate(d) ? d.iso ?? `9998-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : '9999';
    const unit = String(Number(/(\d+)/.exec(String(f.unit ?? ''))?.[1] ?? 999)).padStart(4, '0');
    return `${iso}|${unit}|${titleOf(p)}`;
  };
  const byOrder = (a: ChangeProposal, b: ChangeProposal) => order(a).localeCompare(order(b), undefined, { numeric: true });

  const groups: { label: string; items: ChangeProposal[] }[] = [
    { label: 'Graded work and deadlines', items: simple.filter((p) => p.entityType === 'assignment' || p.entityType === 'timeline_event') },
    { label: 'Readings, lectures and files', items: simple.filter((p) => p.entityType === 'course_material' && p.candidate.fields.kind !== 'note') },
    { label: 'Notes from the course page', items: simple.filter((p) => p.entityType === 'course_material' && p.candidate.fields.kind === 'note') },
    { label: 'Course and semester details', items: simple.filter((p) => !['assignment', 'timeline_event', 'course_material'].includes(p.entityType)) },
  ].filter((g) => g.items.length > 0).map((g) => ({ ...g, items: [...g.items].sort(byOrder) }));

  return (
    <div className="review-list">
      {simple.length > 0 && (
        <>
          <div className="review-bar">
            <span className="muted">{checked.size} of {simple.length} selected</span>
            <button type="button" className="link" onClick={() => setChecked(new Set(simple.map((p) => p.id)))}>select all</button>
            <button type="button" className="link" onClick={() => setChecked(new Set())}>select none</button>
            <span className="spacer" />
            <button type="button" className="secondary" disabled={busy || checked.size === 0} onClick={rejectSelected}>Reject selected</button>
            <button type="button" disabled={busy || checked.size === 0} onClick={approveSelected}>
              {busy ? 'Saving…' : `Approve ${checked.size} selected`}
            </button>
          </div>
          {error && <p role="alert" className="error">{error}</p>}
          {groups.map((g) => (
            <div key={g.label} className="review-group">
              <h3>{g.label} <span className="muted small">{g.items.length}</span></h3>
              <table className="review-table">
                <tbody>
                  {g.items.map((p) => {
                    const f = p.candidate.fields;
                    const needsDate = (p.entityType === 'assignment' && !f.dueDate) || (p.entityType === 'timeline_event' && f.kind !== 'module' && !f.date);
                    return (
                      <tr key={p.id} className={checked.has(p.id) ? 'on' : ''}>
                        <td className="check"><input type="checkbox" aria-label={`Select ${titleOf(p)}`} checked={checked.has(p.id)} onChange={() => toggle(p.id)} /></td>
                        <td className="what">
                          <span className="row-title">{titleOf(p)}</span>
                          <span className="row-sub">
                            {typeOf(p)}
                            {f.unit ? ` · ${String(f.unit)}` : ''}
                            {f.courseCode ? ` · ${String(f.courseCode)}` : ''}
                            {p.kind === 'duplicate' ? ' · already saved' : ''}
                          </span>
                          {p.candidate.flags.length > 0 && (
                            <span className="row-flags">
                              {p.candidate.flags.map((fl) => fl === 'course_mismatch' && f.courseCode
                                ? `The text names ${String(f.courseCode)}; it will be filed there`
                                : FLAG_LABELS[fl] ?? fl).join(' · ')}
                            </span>
                          )}
                        </td>
                        <td className="when">
                          {needsDate ? (
                            <label className="inline-date">
                              <span>{typeof f.dueNote === 'string' ? f.dueNote : 'no date found'}</span>
                              <input type="date" aria-label={`Due date for ${titleOf(p)}`} value={dates[p.id] ?? ''} onChange={(e) => setDates({ ...dates, [p.id]: e.target.value })} />
                            </label>
                          ) : whenOf(p)}
                        </td>
                        <td className="pts">{typeof f.pointsPossible === 'number' ? `${f.pointsPossible} pts` : typeof f.maxPoints === 'number' ? `${f.maxPoints} pts` : ''}</td>
                        <td className="src"><SourceTrace provenance={[p.candidate.provenance, ...p.alternatives.map((a) => a.provenance)]} compact /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
      {complex.map((p) => <ChangeCard key={p.id} p={p} />)}
    </div>
  );
}

function ChangeCard({ p }: { p: ChangeProposal }) {
  const { service, refresh } = useApp();
  const [choice, setChoice] = useState<Record<string, 'old' | 'new'>>({});
  const [error, setError] = useState<string | null>(null);
  const changed = new Set(p.changes.map((c) => c.field));
  const fields = Object.entries(p.candidate.fields).filter(([k, v]) => !HIDDEN.has(k) && !changed.has(k) && v !== null);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <article className={`card proposal ${p.kind}`} aria-label={`${ENTITY_LABELS[p.entityType]}: ${titleOf(p)}`}>
      <header>
        <span className="tag">{ENTITY_LABELS[p.entityType]}</span>
        <span className={`tag kind-${p.kind}`}>{p.kind === 'conflict' ? 'Your sources disagree' : 'Changed since you last confirmed it'}</span>
        <h3>{titleOf(p)}</h3>
      </header>
      <table className="changes">
        <thead><tr><th>Field</th><th>{p.kind === 'conflict' ? 'First source' : 'Saved value'}</th><th>{p.kind === 'conflict' ? 'Second source' : 'New value'}</th></tr></thead>
        <tbody>
          {p.changes.map((c, i) => (
            <tr key={`${c.field}-${i}`}>
              <th scope="row">{FIELD_LABELS[c.field] ?? c.field}</th>
              <td><label><input type="radio" name={`${p.id}-${c.field}`} checked={(choice[c.field] ?? 'new') === 'old'} onChange={() => setChoice({ ...choice, [c.field]: 'old' })} /> {formatValue(c.oldValue)}</label></td>
              <td><label><input type="radio" name={`${p.id}-${c.field}`} checked={(choice[c.field] ?? 'new') === 'new'} onChange={() => setChoice({ ...choice, [c.field]: 'new' })} /> {formatValue(c.newValue)}</label></td>
            </tr>
          ))}
        </tbody>
      </table>
      {fields.length > 0 && (
        <dl className="fields">{fields.map(([k, v]) => <div key={k}><dt>{FIELD_LABELS[k] ?? k}</dt><dd>{formatValue(v)}</dd></div>)}</dl>
      )}
      <SourceTrace provenance={[p.candidate.provenance, ...p.alternatives.map((a) => a.provenance)]} />
      <div className="row">
        <button type="button" onClick={() => act(() => service.approve(p.id, choice))}>Approve</button>
        <button type="button" className="secondary" onClick={() => act(() => service.reject(p.id))}>Reject</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </article>
  );
}
