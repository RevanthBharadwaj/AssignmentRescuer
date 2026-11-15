import { useState } from 'react';
import { useApp } from '../AppContext';
import { unitFinished } from '../../core/finished';
import { useAsync } from '../useAsync';
import { ProgressBar, courseColor } from '../ux';
import { prettyDate } from '../../core/schedule';
import type { UnitSummary } from '../../core/units';

const STATE_LABEL: Record<UnitSummary['state'], string> = {
  current: 'This week',
  done: 'Done',
  overdue: 'Overdue work',
  upcoming: 'Coming up',
  empty: 'Nothing yet',
};

/** One block per unit, like the Unit 1 to Unit 7 buttons on the Canvas home page. Opens that unit right here on the course home. */
export function UnitBlocks({ code, onOpen }: { code: string; onOpen: (unit: number | null) => void }) {
  const { service, version, today } = useApp();
  const { data: all } = useAsync(() => service.units(code, today), [version, code, today]);
  const [showFinished, setShowFinished] = useState(false);
  if (!all || all.length === 0) return null;
  // A unit is finished when all its graded work is submitted or past its due date. Dates decide, never the unit's name or number.
  const finished = all.filter((u) => unitFinished(u, today));
  const data = showFinished ? all : all.filter((u) => !unitFinished(u, today));
  return (
    <>
    <section className="unit-grid" aria-label="Units">
      {data.map((u, i) => {
        const pct = u.graded.length ? Math.round((u.submitted / u.graded.length) * 100) : 0;
        const name = u.number === null ? 'Course resources' : `Unit ${u.number}`;
        return (
          <button
            key={u.label}
            type="button"
            className={`unit-block ${u.state} stagger ${u.number === null ? 'resources' : ''}`}
            style={{ ['--i' as string]: i }}
            aria-label={`Open ${name}`}
            onClick={() => onOpen(u.number)}
          >
            <span className="unit-top">
              <span className="unit-num">{u.number === null ? 'RESOURCES' : `UNIT ${u.number}`}</span>
              <span className="unit-state">{STATE_LABEL[u.state]}</span>
            </span>
            <span className="unit-meta">
              {u.graded.length ? `${u.graded.length} graded · ${u.points} pts` : `${u.materials.length} reading${u.materials.length === 1 ? '' : 's'} and files`}
            </span>
            <span className="unit-next">
              {u.nextDue ? <>Next: {u.nextDueTitle?.replace(/^Unit \d+:\s*/i, '')} <b>{prettyDate(u.nextDue)}</b></> : u.state === 'done' ? 'All submitted' : u.graded.length ? 'No dates yet' : ' '}
            </span>
            {u.graded.length > 0 && <ProgressBar pct={pct} color={courseColor(code)} label={`${name} progress`} />}
          </button>
        );
      })}
    </section>
    {finished.length > 0 && (
      <button type="button" className="link muted-link small" aria-pressed={showFinished} onClick={() => setShowFinished((v) => !v)}>
        {showFinished ? 'Hide finished units' : `Show finished units (${finished.length})`}
      </button>
    )}
    </>
  );
}
