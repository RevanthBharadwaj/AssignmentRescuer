import { byTime } from '../../core/finished';
import { useMemo, useState } from 'react';
import { Hint } from './Guide';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import type { AcademicDate, ConfirmedRecord } from '../../core/types';
import { addDays } from '../../core/extract/dates';
import { CourseDot, StatusButton, Urgency, courseColor, dueOf, statusOf } from '../ux';
import { formatDate } from '../format';
import { FeedCard } from './FeedCard';

/**
 * Semester calendar: month grid or week columns. Items are coloured by
 * course; breaks and the semester's first and last day are marked.
 * Availability dates and weekly modules are not deadlines and are left out.
 */

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

interface DayMark {
  label: string;
  kind: 'break' | 'semester';
}

export function Calendar({ embedded = false }: { embedded?: boolean } = {}) {
  const { service, version, today, go } = useApp();
  const [view, setView] = useState<'month' | 'week'>('month');
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState<string | null>(today);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const { data } = useAsync(async () => {
    const records = await service.repository.listRecords();
    const sem = (await service.onboarding()).currentSemester;
    const milestones = (await service.milestones()).filter((m) => m.kind === 'initial_post');
    return { records, sem, milestones };
  }, [version]);

  const byDay = useMemo(() => {
    const map = new Map<string, ConfirmedRecord[]>();
    for (const r of data?.records ?? []) {
      if (r.entityType !== 'assignment' && r.entityType !== 'timeline_event') continue;
      if (r.fields.kind === 'module' || r.fields.kind === 'availability') continue;
      const d = dueOf(r);
      if (!d?.iso) continue;
      if (hidden.has(String(r.fields.courseCode ?? ''))) continue;
      map.set(d.iso, [...(map.get(d.iso) ?? []), r]);
    }
    // The first post of a discussion is due earlier than its replies (for example Wednesday, not Saturday).
    for (const m of data?.milestones ?? []) {
      if (hidden.has(m.courseCode)) continue;
      const [year, month, day] = m.date.split('-').map(Number);
      const rec: ConfirmedRecord = {
        id: `milestone:${m.key}`, entityType: 'timeline_event', key: m.key, unknownFields: [], evidence: [], confirmedAt: '', updatedAt: '',
        fields: { title: `First post: ${m.title.replace(/^Unit \d+:\s*/i, '')}`, courseCode: m.courseCode, kind: 'milestone', date: { iso: m.date, year, month, day, yearSource: 'explicit', time: m.time, timeZone: m.timeZone, raw: m.date } },
      };
      map.set(m.date, [...(map.get(m.date) ?? []), rec]);
    }
    for (const list of map.values()) list.sort(byTime);
    return map;
  }, [data, hidden]);

  const marks = useMemo(() => {
    const m = new Map<string, DayMark[]>();
    const add = (iso: string, mark: DayMark) => m.set(iso, [...(m.get(iso) ?? []), mark]);
    for (const r of data?.records ?? []) {
      if (r.entityType !== 'academic_break') continue;
      const s = (r.fields.startDate as AcademicDate | null)?.iso;
      const e = (r.fields.endDate as AcademicDate | null)?.iso ?? s;
      if (!s || !e) continue;
      for (let d = s; d <= e; d = addDays(d, 1)) add(d, { label: String(r.fields.name ?? 'Break'), kind: 'break' });
    }
    const s = (data?.sem?.fields.startDate as AcademicDate | null)?.iso;
    const e = (data?.sem?.fields.endDate as AcademicDate | null)?.iso;
    if (s) add(s, { label: 'First day of the semester', kind: 'semester' });
    if (e) add(e, { label: 'Last day of the semester', kind: 'semester' });
    return m;
  }, [data]);

  if (!data) return <p className="muted">Loading…</p>;

  const courses = data.records.filter((r) => r.entityType === 'course').map((c) => String(c.fields.code));
  const y = Number(anchor.slice(0, 4));
  const mo = Number(anchor.slice(5, 7));
  const first = `${y}-${String(mo).padStart(2, '0')}-01`;
  const gridStart = view === 'month' ? mondayOf(first) : mondayOf(anchor);
  const days = Array.from({ length: view === 'month' ? 42 : 7 }, (_, i) => addDays(gridStart, i));
  const shift = (dir: number) => {
    if (view === 'week') setAnchor(addDays(anchor, dir * 7));
    else {
      const d = new Date(Date.UTC(y, mo - 1 + dir, 1));
      setAnchor(d.toISOString().slice(0, 10));
    }
  };
  const title = view === 'month' ? `${MONTHS[mo - 1]} ${y}` : `Week of ${formatDate({ iso: gridStart, year: Number(gridStart.slice(0, 4)), month: Number(gridStart.slice(5, 7)), day: Number(gridStart.slice(8)), yearSource: 'explicit', time: null, timeZone: null, raw: '' })}`;
  const selectedItems = selected ? byDay.get(selected) ?? [] : [];

  return (
    <section aria-labelledby="cal-title" className="calendar-page">
      <div className="page-head cal-head">
        <div>
          <span className="chip">calendar</span>
          {embedded ? <h2 id="cal-title">{title}</h2> : <h1 id="cal-title">{title}</h1>}
          {!embedded && <Hint id="calendar" />}
        </div>
        <div className="cal-controls">
          <div className="segmented" role="group" aria-label="Calendar view">
            <button type="button" className={view === 'month' ? 'on' : ''} aria-pressed={view === 'month'} onClick={() => setView('month')}>Month</button>
            <button type="button" className={view === 'week' ? 'on' : ''} aria-pressed={view === 'week'} onClick={() => setView('week')}>Week</button>
          </div>
          <button type="button" className="secondary" aria-label="Previous" onClick={() => shift(-1)}>←</button>
          <button type="button" className="secondary" onClick={() => { setAnchor(today); setSelected(today); }}>Today</button>
          <button type="button" className="secondary" aria-label="Next" onClick={() => shift(1)}>→</button>
        </div>
      </div>

      <FeedCard compact />

      {courses.length > 0 && (
        <div className="legend" aria-label="Show or hide courses">
          {courses.map((c) => (
            <button
              key={c}
              type="button"
              className={`legend-item ${hidden.has(c) ? 'off' : ''}`}
              aria-pressed={!hidden.has(c)}
              onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(c)) n.delete(c); else n.add(c); return n; })}
            >
              <CourseDot code={c} /> {c}
            </button>
          ))}
        </div>
      )}

      <div className={`cal-grid ${view}`} role="grid" aria-label={title}>
        {DOW.map((d) => <div key={d} className="dow" role="columnheader">{d}</div>)}
        {days.map((iso, i) => {
          const items = byDay.get(iso) ?? [];
          const dayMarks = marks.get(iso) ?? [];
          const outside = view === 'month' && Number(iso.slice(5, 7)) !== mo;
          const cls = ['day', outside && 'outside', iso === today && 'today', iso === selected && 'selected', iso < today && 'past', dayMarks.some((m) => m.kind === 'break') && 'break'].filter(Boolean).join(' ');
          return (
            <div
              key={iso}
              role="gridcell"
              tabIndex={0}
              aria-label={`${iso}: ${items.length} item${items.length === 1 ? '' : 's'}`}
              className={cls}
              style={{ ['--i' as string]: i }}
              onClick={() => setSelected(iso)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelected(iso); }}
            >
              <span className="num">{Number(iso.slice(8))}</span>
              {dayMarks.map((m) => <span key={m.label} className={`mark ${m.kind}`}>{m.label}</span>)}
              <div className="pills">
                {items.slice(0, view === 'month' ? 3 : 12).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`pill ${statusOf(r)}`}
                    style={{ ['--c' as string]: courseColor(r.fields.courseCode) }}
                    title={`${String(r.fields.courseCode ?? '')} ${String(r.fields.title)}`}
                    onClick={(e) => { e.stopPropagation(); if (r.entityType === 'assignment') go({ name: 'assignment', id: r.id }); else setSelected(iso); }}
                  >
                    {String(r.fields.title)}
                  </button>
                ))}
                {view === 'month' && items.length > 3 && <span className="more">+{items.length - 3} more</span>}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <div className="card day-panel" aria-live="polite">
          <h2>{formatDate({ iso: selected, year: Number(selected.slice(0, 4)), month: Number(selected.slice(5, 7)), day: Number(selected.slice(8)), yearSource: 'explicit', time: null, timeZone: null, raw: '' })}</h2>
          {(marks.get(selected) ?? []).map((m) => <p key={m.label} className="muted small">{m.label}</p>)}
          {selectedItems.length === 0 ? <p className="muted">Nothing due.</p> : (
            <ul className="deadlines">
              {selectedItems.map((r) => (
                <li key={r.id}>
                  <span className="date"><CourseDot code={r.fields.courseCode} /> {String(r.fields.courseCode ?? '')}</span>
                  <span className="title">
                    {r.entityType === 'assignment'
                      ? <button type="button" className="link plain" onClick={() => go({ name: 'assignment', id: r.id })}>{String(r.fields.title)}</button>
                      : String(r.fields.title)}
                  </span>
                  <span className="row-end">
                    <Urgency record={r} />
                    {r.entityType === 'assignment' && <StatusButton record={r} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
