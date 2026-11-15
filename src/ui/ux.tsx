import { useEffect, useRef, useState } from 'react';
import type { AcademicDate, ConfirmedRecord } from '../core/types';
import { useApp } from './AppContext';

/* ---------- course colours ---------- */

const PALETTE = ['#d6f1a7', '#b9d4fa', '#ffc7b0', '#dcd2ff', '#a8e6d8', '#f7d98b', '#f5b8d0', '#c9d6f5'];

/** Stable colour per course code, so a course looks the same everywhere. */
export function courseColor(code: unknown): string {
  const s = String(code ?? '');
  if (!s) return '#7b7d84';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function CourseDot({ code }: { code: unknown }) {
  return <span className="course-dot" style={{ background: courseColor(code) }} aria-hidden="true" />;
}

/* ---------- dates and urgency ---------- */

export function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000);
}

export function dueOf(r: ConfirmedRecord): AcademicDate | null {
  return ((r.fields.dueDate ?? r.fields.date ?? null) as AcademicDate | null) ?? null;
}

export type Status = 'todo' | 'in_progress' | 'submitted';
export const statusOf = (r: ConfirmedRecord): Status => (r.fields.status as Status | undefined) ?? 'todo';

export function Urgency({ record }: { record: ConfirmedRecord }) {
  const { today } = useApp();
  const d = dueOf(record);
  if (statusOf(record) === 'submitted') return <span className="urgency done">submitted</span>;
  if (!d?.iso) return null;
  const n = daysUntil(d.iso, today);
  const label = n < 0 ? `${-n} day${n === -1 ? '' : 's'} overdue` : n === 0 ? 'due today' : n === 1 ? 'tomorrow' : `in ${n} days`;
  const tone = n < 0 ? 'overdue' : n <= 1 ? 'hot' : n <= 3 ? 'warm' : 'calm';
  return <span className={`urgency ${tone}`}>{label}</span>;
}

/* ---------- status control ---------- */

const NEXT: Record<Status, Status> = { todo: 'in_progress', in_progress: 'submitted', submitted: 'todo' };
const LABEL: Record<Status, string> = { todo: 'To do', in_progress: 'In progress', submitted: 'Submitted' };

export function StatusButton({ record, compact = false }: { record: ConfirmedRecord; compact?: boolean }) {
  const { service, refresh, toast, markDone } = useApp();
  const status = statusOf(record);
  const set = async (to: Status) => {
    await service.repository.correctRecord(record.id, { status: to });
    refresh();
  };
  return (
    <button
      type="button"
      className={`status ${status} ${compact ? 'compact' : ''}`}
      aria-label={`${String(record.fields.title)}: ${LABEL[status]}. Change status`}
      title="Click to change status"
      onClick={async (e) => {
        e.stopPropagation();
        const to = NEXT[status];
        // Finishing asks first, then celebrates. Going back or to "in progress" is immediate.
        if (to === 'submitted') { markDone(record); return; }
        await set(to);
        toast(`“${String(record.fields.title)}”: ${LABEL[to].toLowerCase()}`, () => set(status));
      }}
    >
      <span className="status-icon" aria-hidden="true">{status === 'submitted' ? '✓' : status === 'in_progress' ? '◐' : ''}</span>
      {!compact && LABEL[status]}
    </button>
  );
}

/* ---------- progress ---------- */

export function courseProgress(items: ConfirmedRecord[]): { done: number; total: number; pct: number } {
  const graded = items.filter((r) => r.entityType === 'assignment');
  const weight = (r: ConfirmedRecord) => (typeof r.fields.pointsPossible === 'number' && r.fields.pointsPossible > 0 ? r.fields.pointsPossible : 1);
  const total = graded.reduce((s, r) => s + weight(r), 0);
  const done = graded.filter((r) => statusOf(r) === 'submitted').reduce((s, r) => s + weight(r), 0);
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function ProgressBar({ pct, color, label }: { pct: number; color?: string; label: string }) {
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ---------- motion ---------- */

/** Animate a number from 0 when it first appears (respects reduced motion). */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof requestAnimationFrame === 'undefined') {
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(a + (value - a) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown}</>;
}

/* ---------- toasts ---------- */

export interface Toast {
  id: number;
  text: string;
  undo?: () => void | Promise<void>;
}

export function Toasts({ items, dismiss }: { items: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.text}</span>
          {t.undo && (
            <button type="button" className="link" onClick={async () => { await t.undo?.(); dismiss(t.id); }}>Undo</button>
          )}
          <button type="button" className="link muted-link" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
