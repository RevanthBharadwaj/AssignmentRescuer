import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import { FEATURES, type FeatureStatus } from '../../core/features';

export function Sources() {
  const { service, version, refresh } = useApp();
  const { data: sources } = useAsync(() => service.repository.listSources(), [version]);
  const [confirming, setConfirming] = useState<string | null>(null);
  if (!sources) return <p>Loading…</p>;

  return (
    <section aria-labelledby="sources-title">
      <div className="page-head">
        <span className="chip">trace it</span>
        <h1 id="sources-title">Imported material</h1>
        <p>Everything stays on this computer. Deleting a source also removes records that came only from it.</p>
      </div>
      {sources.length === 0 && <p className="muted">Nothing imported yet.</p>}
      {sources.map((s) => (
        <div key={s.id} className="card compact">
          <strong>{s.originalName}</strong>
          <span className="muted small"> · {s.format} · {new Date(s.importedAt).toLocaleString()} · {s.classifications.map((c) => c.label.replace(/_/g, ' ')).slice(0, 3).join(', ')}</span>
          {s.securityFlags.some((f) => f.kind === 'prompt_injection_pattern') && <span className="tag kind-conflict">Suspicious text</span>}
          <details><summary>View text</summary><pre className="instructions">{s.text}</pre></details>
          {confirming === s.id ? (
            <span className="row">
              <button type="button" className="danger" onClick={async () => { await service.repository.deleteSource(s.id); setConfirming(null); refresh(); }}>Delete permanently</button>
              <button type="button" className="secondary" onClick={() => setConfirming(null)}>Cancel</button>
            </span>
          ) : (
            <button type="button" className="link" onClick={() => setConfirming(s.id)}>Delete</button>
          )}
        </div>
      ))}
    </section>
  );
}

const STATUS_TEXT: Record<FeatureStatus, string> = { implemented: 'Available', experimental: 'Experimental', unavailable: 'Not available yet' };

export function Features() {
  const groups: FeatureStatus[] = ['implemented', 'experimental', 'unavailable'];
  return (
    <section aria-labelledby="features-title">
      <div className="page-head">
        <span className="chip">status</span>
        <h1 id="features-title">What this version can do</h1>
        <p>Every feature is listed honestly as available, experimental or not available yet.</p>
      </div>
      {groups.map((g) => (
        <div key={g} className="card">
          <h2>{STATUS_TEXT[g]}</h2>
          <ul className="features">
            {FEATURES.filter((f) => f.status === g).map((f) => <li key={f.id}><strong>{f.name}</strong> <span className="muted small">{f.note}</span></li>)}
          </ul>
        </div>
      ))}
    </section>
  );
}
