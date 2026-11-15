import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import { DEFAULT_COUNTDOWN, clean, dayName, formatClock, formatRemaining, nextDeadline, type CountdownSettings } from '../../core/countdown';
import { dueDateOf } from '../../core/finished';
import { zoneLabel, zoneNow } from '../../core/timezone';

const KEY = 'countdown';

/** Sits in the top bar: time left until the next weekly deadline (Wednesday and Saturday at 11:59 PM unless changed). */
export function DeadlineTimer() {
  const { service, version, zone } = useApp();
  const { data } = useAsync(async () => ({
    settings: clean(await service.repository.getSetting<CountdownSettings>(KEY, DEFAULT_COUNTDOWN)),
    records: await service.repository.listRecords(),
  }), [version]);
  const [now, setNow] = useState(() => zoneNow(zone).wall);
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<CountdownSettings | null>(null);
  useEffect(() => {
    setNow(zoneNow(zone).wall);
    const t = setInterval(() => setNow(zoneNow(zone).wall), 1000);
    return () => clearInterval(t);
  }, [zone]);
  const settings = local ?? data?.settings ?? DEFAULT_COUNTDOWN;
  const save = async (next: CountdownSettings) => {
    const c = clean(next);
    setLocal(c);
    await service.repository.setSetting(KEY, c);
  };

  const target = nextDeadline(now, settings);
  const iso = target ? `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}` : null;
  const dueThen = iso && data ? data.records.filter((r) => (r.entityType === 'assignment') && r.fields.status !== 'submitted' && dueDateOf(r)?.iso === iso).length : 0;
  const left = target ? target.getTime() - now.getTime() : 0;
  const urgent = target !== null && left < 3 * 3_600_000;

  return (
    <div className="deadline-timer">
      <button type="button" className={`timer-btn ${urgent ? 'urgent' : ''}`} aria-expanded={open} aria-label="Deadline timer" onClick={() => setOpen((o) => !o)}>
        {target ? (
          <>
            <span className="timer-label">{dayName(target.getDay())} {formatClock(settings.time)} {zoneLabel(zone)}</span>
            <span className="timer-left" role="timer">{formatRemaining(left)}</span>
            {dueThen > 0 && <span className="timer-count">{dueThen} due</span>}
          </>
        ) : <span className="timer-label">Timer off</span>}
      </button>
      {open && (
        <div className="timer-pop" role="dialog" aria-label="Deadline timer settings">
          <label className="check"><input type="checkbox" checked={settings.enabled} onChange={(e) => void save({ ...settings, enabled: e.target.checked })} /> Show the timer</label>
          <div className="timer-days" role="group" aria-label="Days">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <label key={d} className="check">
                <input type="checkbox" checked={settings.days.includes(d)} onChange={(e) => void save({ ...settings, days: e.target.checked ? [...settings.days, d] : settings.days.filter((x) => x !== d) })} /> {dayName(d)}
              </label>
            ))}
          </div>
          <label>Time <input type="time" value={settings.time} onChange={(e) => e.target.value && void save({ ...settings, time: e.target.value })} /></label>
          <button type="button" className="link small" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}
