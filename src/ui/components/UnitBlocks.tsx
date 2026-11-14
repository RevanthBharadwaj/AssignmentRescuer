import { useApp } from '../AppContext';
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

/** One block per unit, like the Unit 1 to Unit 7 buttons on the Canvas home page. Opens that unit in Modules. */
export function UnitBlocks({ code }: { code: string }) {
  const { service, version, go, today } = useApp();
  const { data } = useAsync(() => service.units(code, today), [version, code, today]);
  if (!data || data.length === 0) return null;
  return (
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
            onClick={() => go({ name: 'course', code, tab: 'modules', unit: u.number ?? 0 })}
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
  );
}
