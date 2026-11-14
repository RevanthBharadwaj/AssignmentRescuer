import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { HINTS, TOUR } from '../../core/guide';
import type { Route } from '../AppContext';

/** A short, dismissible tip at the top of a page. Dismissed tips stay dismissed. */
export function Hint({ id }: { id: string }) {
  const { service } = useApp();
  const [shown, setShown] = useState(false);
  const hint = HINTS[id];
  useEffect(() => {
    let live = true;
    void service.repository.getSetting<string[]>('hints.dismissed', []).then((d) => { if (live) setShown(!d.includes(id)); });
    return () => { live = false; };
  }, [service, id]);
  if (!hint || !shown) return null;
  return (
    <aside className="hint" role="note" aria-label={`Tip: ${hint.title}`}>
      <div><b>Tip: {hint.title}.</b> {hint.text}</div>
      <button type="button" className="link" onClick={async () => {
        const d = await service.repository.getSetting<string[]>('hints.dismissed', []);
        await service.repository.setSetting('hints.dismissed', [...d, id]);
        setShown(false);
      }}>Got it</button>
    </aside>
  );
}

/** First run walkthrough: one step at a time, each with a button that goes there. */
export function Tour({ onClose }: { onClose: () => void }) {
  const { go } = useApp();
  const [i, setI] = useState(0);
  const step = TOUR[i];
  const last = i === TOUR.length - 1;
  return (
    <aside className="tour" role="dialog" aria-label="Welcome tour">
      <p className="muted small">Step {i + 1} of {TOUR.length}</p>
      <h2>{step.title}</h2>
      <p>{step.body}</p>
      <div className="tour-dots" aria-hidden="true">{TOUR.map((t, n) => <i key={t.id} className={n === i ? 'on' : ''} />)}</div>
      <div className="row">
        <button type="button" onClick={() => go(step.route as Route)}>{step.action}</button>
        {!last ? <button type="button" className="secondary" onClick={() => setI(i + 1)}>Next</button> : <button type="button" className="secondary" onClick={onClose}>Finish</button>}
        {i > 0 && <button type="button" className="link" onClick={() => setI(i - 1)}>Back</button>}
        <button type="button" className="link" onClick={onClose}>Skip the tour</button>
      </div>
    </aside>
  );
}
