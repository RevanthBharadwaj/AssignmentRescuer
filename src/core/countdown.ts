/** A countdown to the next weekly deadline, for example Wednesday and Saturday at 11:59 PM. */

export interface CountdownSettings {
  enabled: boolean;
  /** 0 = Sunday ... 6 = Saturday. */
  days: number[];
  /** HH:MM, 24 hour. */
  time: string;
}

export const DEFAULT_COUNTDOWN: CountdownSettings = { enabled: true, days: [3, 6], time: '23:59' };

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function dayName(d: number): string { return DAY_NAMES[d] ?? ''; }

export function clean(s: Partial<CountdownSettings> | null | undefined): CountdownSettings {
  const days = Array.isArray(s?.days) ? [...new Set(s.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : DEFAULT_COUNTDOWN.days;
  const time = typeof s?.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) ? s.time : DEFAULT_COUNTDOWN.time;
  return { enabled: s?.enabled ?? DEFAULT_COUNTDOWN.enabled, days: days.length ? days : DEFAULT_COUNTDOWN.days, time };
}

/** The next deadline at or after `now` (local time), or null when none is chosen. */
export function nextDeadline(now: Date, s: CountdownSettings): Date | null {
  if (!s.enabled || !s.days.length) return null;
  const [h, m] = s.time.split(':').map(Number);
  for (let i = 0; i <= 7; i++) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m, 0, 0);
    if (s.days.includes(t.getDay()) && t.getTime() >= now.getTime()) return t;
  }
  return null;
}

/** "1d 4h 12m" for far away, "4h 12m 09s" within a day, "12m 09s" within an hour. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${h}h ${two(m)}m`;
  if (h > 0) return `${h}h ${two(m)}m ${two(sec)}s`;
  return `${m}m ${two(sec)}s`;
}

export function formatClock(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
